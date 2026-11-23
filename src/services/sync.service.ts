// packages/tenant-agent/src/services/sync.service.ts
import Database from "better-sqlite3";
import fs from "node:fs";
import { v4 as uuid } from "uuid";
import { config } from "../config/tenant-agent.config.js";
import { systemApi } from "../system-api/client.js";
import { Logger } from "../utils/logger.js";
import { createVerifiedOutboxBackup } from './sqlite-verified-backup.js';

export interface OutboxEvent {
    id?: string;
    tenantId: string;
    agentId?: string;
    aggregate_type: string;
    aggregate_id: string;
    event_type: string;
    payload: any;
    createdAt?: string;
    occurredAt?: string;
    sent?: number;
    status?: string;
    retry_count?: number;
    event_version?: number;
    headers?: string;
}

export class SyncService {
    private db: Database.Database;
    private MAX_RETRY = 5;

    constructor() {
        // Create a local directory before opening the durable outbox.
        fs.mkdirSync("data", { recursive: true });
        this.db = new Database("data/outbox.db");

        // The manual CLI shares the durable outbox with the canonical agent.
        // Apply the same per-connection FULL-synchronous WAL policy; reject
        // filesystems that cannot meet the expected persistence guarantees.
        const journal = this.db.pragma('journal_mode = WAL', { simple: true });
        this.db.pragma('synchronous = FULL');
        this.db.pragma('busy_timeout = 5000');
        if (String(journal).toLowerCase() !== 'wal' ||
            this.db.pragma('synchronous', { simple: true }) !== 2) {
            this.db.close();
            throw new Error('Durable SQLite outbox mode is unavailable');
        }

        // Create table if it does not exist
        this.db.prepare(`
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY,
        tenantId TEXT NOT NULL,
        agentId TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        occurredAt TEXT NOT NULL,
        sent INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        retry_count INTEGER NOT NULL DEFAULT 0,
        event_version INTEGER NOT NULL DEFAULT 1,
        headers TEXT DEFAULT '{}'
      )
    `).run();
    }

    /**
     * Add a new event to outbox
     */
    addEvent(event: OutboxEvent) {
        const now = new Date().toISOString();
        const id = event.id ?? uuid();
        const createdAt = event.createdAt ?? now;
        const occurredAt = event.occurredAt ?? now;

        const stmt = this.db.prepare(`
      INSERT INTO outbox (
        id, tenantId, agentId, aggregate_type, aggregate_id,
        event_type, payload, createdAt, occurredAt,
        sent, status, retry_count, event_version, headers
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

        stmt.run(
            id,
            event.tenantId,
            event.agentId ?? "agent-1",
            event.aggregate_type,
            event.aggregate_id,
            event.event_type,
            JSON.stringify(event.payload),
            createdAt,
            occurredAt,
            event.sent ?? 0,
            event.status ?? "pending",
            event.retry_count ?? 0,
            event.event_version ?? 1,
            event.headers ?? "{}"
        );

        Logger.info(`[Sync] Event added to outbox: ${event.event_type} (ID: ${id})`);
    }

    /**
     * Flush unsent events to central system
     */
    async flushOutbox(batchSize = 5): Promise<number> {
        if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100) {
            throw new Error('Invalid outbox batch size');
        }
        // The manual CLI uses the same bounded, stable SQLite snapshot rule
        // as the daemon: scan a finite high-water mark, not an unbounded .all().
        const highWater = this.db.prepare(
            'SELECT MAX(rowid) AS lastRowId FROM outbox WHERE sent=0'
        ).get() as { lastRowId: number | null };
        if (highWater.lastRowId === null) return 0;
        const page = this.db.prepare(
            'SELECT rowid AS scanRowId, * FROM outbox ' +
            'WHERE sent=0 AND rowid>? AND rowid<=? ORDER BY rowid ASC LIMIT ?'
        );
        let cursor = 0;
        let flushedCount = 0;

        while (cursor < highWater.lastRowId) {
            const batch = page.all(cursor, highWater.lastRowId, batchSize) as
                Array<{ scanRowId: number; id: string; tenantId: string; agentId: string;
                    aggregate_type: string; aggregate_id: string; event_type: string;
                    payload: string; createdAt: string; occurredAt: string;
                    retry_count: number }>;
            if (batch.length === 0) break;
            cursor = batch[batch.length - 1].scanRowId;
            const results = await Promise.allSettled(
                batch.map(async row => {
                    let parsed: unknown;
                    try { parsed = JSON.parse(row.payload); }
                    catch {
                        // Preserve a corrupt source event for authorized recovery.
                        // Never print the event payload or the JSON parser error.
                        Logger.error('[Sync] Invalid SQLite event JSON; record retained for review');
                        return false;
                    }
                    const event = { ...row, payload: parsed };

                    if (!process.env.TENANT_ID ||
                        event.tenantId !== process.env.TENANT_ID) {
                        Logger.error('[Sync] Cross-tenant outbox event blocked before network delivery');
                        return false;
                    }
                    if (!event.tenantId || !event.event_type || !event.payload) {
                        Logger.warn(`[Sync] Skipping event ${event.id} — missing required fields`);
                        return false;
                    }

                    if (event.retry_count >= this.MAX_RETRY) {
                        Logger.warn(`[Sync] Event ${event.id} exceeded max retries. Marking as failed.`);
                        this.db.prepare("UPDATE outbox SET status='failed' WHERE id=?").run(event.id);
                        return false;
                    }

                    const body = {
                        id: event.id,
                        tenantId: event.tenantId,
                        agentId: event.agentId ?? "agent-1",
                        event_type: event.event_type,
                        aggregate_type: event.aggregate_type,
                        aggregate_id: event.aggregate_id,
                        payload: event.payload,
                        createdAt: new Date(event.createdAt).toISOString(),
                        occurredAt: new Date(event.occurredAt).toISOString(),
                    };

                    try {
                        await systemApi.sendEvent(body);

                        this.db.prepare("UPDATE outbox SET sent=1, status='sent' WHERE id=?").run(event.id);
                        Logger.info(`[Sync] Event ${event.id} sent successfully`);
                        return true;
                    } catch {
                        // Network errors can contain private headers and event URLs.
                        Logger.error('[Sync] Central event delivery failed; event remains queued');

                        this.db.prepare(`
              UPDATE outbox
              SET status='failed', retry_count = COALESCE(retry_count,0)+1
              WHERE id=?
            `).run(event.id);

                        return false;
                    }
                })
            );

            flushedCount += results.filter(r => r.status === "fulfilled" && r.value === true).length;
        }

        Logger.info(`[Sync] Finished flushing. Total sent: ${flushedCount}`);
        return flushedCount;
    }

    /**
     * Start periodic sync
     */
    start(intervalMs: number = config.syncIntervalMs) {
        this.flushOutbox();
        setInterval(() => this.flushOutbox(), intervalMs);
        setInterval(() => this.cleanOldEvents(), config.cleanupIntervalMs ?? 3600_000);
        Logger.info(`[Sync] Tenant Agent SyncService started (interval: ${intervalMs}ms)`);
    }

    /**
     * List all events in outbox
     */
    listEvents() {
        return this.db.prepare("SELECT * FROM outbox").all().map((row: any) => ({
            id: row.id,
            tenantId: row.tenantId,
            agentId: row.agentId,
            aggregate_type: row.aggregate_type,
            aggregate_id: row.aggregate_id,
            event_type: row.event_type,
            payload: JSON.parse(row.payload),
            createdAt: row.createdAt,
            occurredAt: row.occurredAt,
            sent: row.sent === 1,
            status: row.status,
            retry_count: row.retry_count,
        }));
    }

    /**
     * Clean old sent events
     */
    cleanOldEvents(retentionMs: number = 24 * 60 * 60 * 1000) {
        const cutoff = new Date(Date.now() - retentionMs).toISOString();
        const result = this.db.prepare("DELETE FROM outbox WHERE sent=1 AND createdAt < ?").run(cutoff);
        if (result.changes > 0) {
            Logger.info(`[Clean] Removed ${result.changes} old sent events older than ${cutoff}`);
        }
    }

    /** Stage, validate, and atomically publish a native SQLite backup. */
    async backupTo(destination: string): Promise<void> {
        await createVerifiedOutboxBackup(this.db, destination);
    }

    /**
     * Close DB connection
     */
    close() {
        this.db.close();
        Logger.info("[Sync] Outbox DB connection closed");
    }
}
