import Database from "better-sqlite3";
import axios from "axios";
import fs from "node:fs";
import { config } from "../config/tenant-agent.config.js";
import { Logger } from "../utils/logger.js";
import { tenantAgentAuthHeaders, toOutboxRecord } from "./event-sync-contract.js";
import { systemApi } from "../system-api/client.js"; // adjust path

/* ============================
   Types
============================ */

export interface LocalEvent {
    id: string;
    tenant_code: string;
    agent_id: string;
    aggregate_type: string;
    aggregate_id: string;
    event_type: string;
    payload: Record<string, unknown>;
    created_at: string;
    occurred_at: string;
    sent?: number;
    status?: string;
    retry_count?: number;
    event_version?: number;
    headers?: string;
}

/* ============================
   Service
============================ */

export class LocalEventsSyncService {
    private outboxDb: Database.Database;
    private tenantServiceUrl: string;
    private tenantId: string;
    private syncTimer: NodeJS.Timeout | null = null;
    private inFlight: Promise<void> | null = null;

    constructor(
        tenantId: string,
        tenantServiceUrl: string = config.tenantServiceUrl
    ) {
        this.tenantId = tenantId;
        this.tenantServiceUrl = tenantServiceUrl;

        fs.mkdirSync("data", { recursive: true });
        this.outboxDb = new Database("data/outbox.db");

        this.outboxDb.prepare(`
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

    /** Stop timers and drain in-flight events before closing the durable outbox. */
    close() {
        if (this.syncTimer || this.inFlight) {
            throw new Error('Stop sync operations before closing the SQLite outbox');
        }
        this.outboxDb.close();
    }

    /** SQLite native backup is WAL-aware; never copy a live database file directly. */
    async backupTo(destination: string): Promise<void> {
        await this.outboxDb.backup(destination);
    }

    /** Never delete an event that has not been acknowledged by the central server. */
    cleanSentEvents(retentionMs: number): number {
        if (!Number.isSafeInteger(retentionMs) || retentionMs < 0) {
            throw new Error('Invalid event retention');
        }
        const cutoff = new Date(Date.now() - retentionMs).toISOString();
        return this.outboxDb.prepare(
            'DELETE FROM outbox WHERE sent=1 AND createdAt < ?'
        ).run(cutoff).changes;
    }

    /* ============================
       Helpers
    ============================ */

    private normalizePayload(payload: unknown): Record<string, unknown> {
        if (typeof payload === "object" && payload !== null) {
            return payload as Record<string, unknown>;
        }
        return {};
    }

    /* ============================
       Fetch from tenant-service
    ============================ */

    async fetchPendingEvents(): Promise<LocalEvent[]> {
        try {
            const res = await axios.get(
                `${this.tenantServiceUrl}/local-events/pending`,
                { headers: tenantAgentAuthHeaders(), timeout: 10_000 }
            );
            if (!Array.isArray(res.data?.data)) {
                throw new Error('Invalid pending events response');
            }
            return res.data.data as LocalEvent[];
        } catch (err: any) {
            Logger.error(
                `[Tenant-Agent] Failed to fetch local_events: ${err.message}`
            );
            throw err;
        }
    }

    /* ============================
       Move local_event → outbox
    ============================ */

    async pollLocalEvents() {
        Logger.info("[Tenant-Agent] pollLocalEvents() start");

        const events = await this.fetchPendingEvents();

        Logger.info(`[Tenant-Agent] fetchPendingEvents returned ${events.length}`);

        if (!events.length) return 0;

        for (const event of events) {
            Logger.info(`[Tenant-Agent] Processing event ${event.id}`);

            this.addToOutbox(event);

            Logger.info(`[Tenant-Agent] Event added to outbox: ${event.id}`);

            try {
                await axios.patch(
                    `${this.tenantServiceUrl}/local-events/${event.id}/mark-sent`,
                    null,
                    { headers: tenantAgentAuthHeaders(), timeout: 10_000 }
                );
                Logger.info(`[Tenant-Agent] Marked sent: ${event.id}`);
            } catch (err: any) {
                Logger.warn(
                    `[Tenant-Agent] Failed to mark event sent: ${event.id} - ${err.message}`
                );
            }
        }

        Logger.info(`[Tenant-Agent] pollLocalEvents() done`);
        return events.length;
    }


    /* ============================
       Insert into outbox.db
    ============================ */


    addToOutbox(event: LocalEvent) {
        const record = toOutboxRecord(event, this.tenantId);
        const stmt = this.outboxDb.prepare(`
        INSERT OR IGNORE INTO outbox (
            id,
            tenantId,
            agentId,
            aggregate_type,
            aggregate_id,
            event_type,
            payload,
            createdAt,
            occurredAt,
            sent,
            status,
            retry_count,
            event_version,
            headers
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

        const values = [
            record.id, record.tenantId, record.agentId,
            record.aggregate_type, record.aggregate_id, record.event_type,
            record.payload, record.createdAt, record.occurredAt,
            0, 'pending', record.retry_count, record.event_version, record.headers
        ];

        // Never print the values array: it contains private event payloads
        // and may contain authentication or student identity metadata.
        if (values.some(v => v === undefined)) {
            Logger.error("[Outbox] Source event cannot be persisted (invalid field)");
            throw new Error("Invalid outbox record; source was not acknowledged");
        }

        stmt.run(values);

        // INSERT OR IGNORE is safe only for a genuine replay of the SAME event.
        // Never silently acknowledge a source record with a reused ID and altered payload.
        const persisted = this.outboxDb.prepare(
            'SELECT tenantId,agentId,aggregate_type,aggregate_id,event_type,' +
            'payload,createdAt,occurredAt,event_version,headers FROM outbox WHERE id=?'
        ).get(record.id) as Record<string, unknown> | undefined;
        if (!persisted || [
            'tenantId','agentId','aggregate_type','aggregate_id','event_type',
            'payload','createdAt','occurredAt','event_version','headers'
        ].some(key => persisted[key] !== (record as unknown as Record<string,unknown>)[key])) {
            throw new Error('Local outbox event ID collision; source event not acknowledged');
        }

        Logger.info(
            `[Tenant-Agent] Local event queued: ${event.event_type}`
        );
    }

    /* ============================
       Flush outbox → central API
    ============================ */

    async flushOutbox(batchSize = 5): Promise<number> {
        if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100) {
            throw new Error('Invalid outbox batch size');
        }
        // A stable rowid high-water mark bounds each flush attempt, even if
        // new records arrive while the network is slow. No unbounded .all().
        const highWater = this.outboxDb.prepare(
            'SELECT MAX(rowid) AS maxRowId FROM outbox WHERE sent = 0'
        ).get() as { maxRowId: number | null };
        if (highWater.maxRowId === null) return 0;

        const page = this.outboxDb.prepare(
            'SELECT rowid AS outboxRowId, id, tenantId, agentId, aggregate_type, aggregate_id, ' +
            'event_type, payload, createdAt, occurredAt FROM outbox ' +
            'WHERE sent = 0 AND rowid > ? AND rowid <= ? ORDER BY rowid ASC LIMIT ?'
        );
        let cursor = 0;
        let flushedCount = 0;

        while (cursor < highWater.maxRowId) {
            const batch = page.all(cursor, highWater.maxRowId, batchSize) as
                Array<{ outboxRowId: number; id: string; tenantId: string;
                    agentId: string; aggregate_type: string; aggregate_id: string;
                    event_type: string; payload: string; createdAt: string;
                    occurredAt: string }>;
            if (batch.length === 0) break;
            cursor = batch[batch.length - 1].outboxRowId;

            const results = await Promise.allSettled(
                batch.map(async (row) => {
                    // A foreign-tenant row must stay safely queued for quarantine /
                    // recovery, never leave the local host under this agent identity.
                    if (row.tenantId !== this.tenantId ||
                        process.env.TENANT_ID !== this.tenantId) {
                        Logger.error('[Sync] Cross-tenant outbox event blocked before network delivery');
                        return false;
                    }
                    // ---------- SAFELY PARSE PAYLOAD ----------
                    let payload: Record<string, any> = {};
                    try {
                        payload =
                            typeof row.payload === "string"
                                ? JSON.parse(row.payload)
                                : (row.payload ?? {});
                    } catch {
                        console.error(`[Sync] Invalid payload JSON for event ${row.id}`);
                        return false;
                    }

                    // ---------- BASIC VALIDATION ----------
                    if (!row.tenantId || !row.event_type) {
                        console.warn(`[Sync] Skipping invalid event ${row.id}`);
                        return false;
                    }

                    const body = {
                        id: row.id,
                        tenantId: row.tenantId,
                        agentId: row.agentId,
                        event_type: row.event_type,
                        aggregate_type: row.aggregate_type,
                        aggregate_id: row.aggregate_id,
                        payload,
                        createdAt: new Date(row.createdAt).toISOString(),
                        occurredAt: new Date(row.occurredAt).toISOString(),
                    };

                    try {
                        await systemApi.sendEvent(body);

                        this.outboxDb
                            .prepare(`
                            UPDATE outbox
                            SET sent = 1, status = 'sent'
                            WHERE id = ?
                        `)
                            .run(row.id);

                        console.log(`[Sync] Event sent: ${row.id}`);
                        return true;
                    } catch (err: any) {
                        console.error(`[Sync] Failed to send ${row.id}: ${err.message}`);

                        this.outboxDb
                            .prepare(`
                            UPDATE outbox
                            SET status = 'failed',
                                retry_count = retry_count + 1
                            WHERE id = ?
                        `)
                            .run(row.id);

                        return false;
                    }
                })
            );

            flushedCount += results.filter(
                r => r.status === "fulfilled" && r.value === true
            ).length;
        }

        console.log(`[Sync] Finished flushing. Total sent: ${flushedCount}`);
        return flushedCount;
    }


    /* ============================
       Controlled background synchronization
    ============================ */

    start(intervalMs: number = config.syncIntervalMs): void {
        if (this.syncTimer) return;
        if (!Number.isSafeInteger(intervalMs) || intervalMs < 25) {
            throw new Error('Sync interval must be at least 25 milliseconds');
        }
        const tick = () => {
            if (this.inFlight) return; // prevent concurrent polling or duplicate deliveries
            this.inFlight = (async () => {
                try {
                    await this.pollLocalEvents();
                } catch (error) {
                    Logger.error('[Sync] Local polling failed; durable pending events remain queued');
                }
                try {
                    await this.flushOutbox();
                } catch (error) {
                    Logger.error('[Sync] Central flush failed; durable events remain queued');
                }
            })().finally(() => { this.inFlight = null; });
        };
        tick();
        this.syncTimer = setInterval(tick, intervalMs);
        Logger.info('[Tenant-Agent] Controlled local-event sync loop started');
    }

    async stop(): Promise<void> {
        if (this.syncTimer) clearInterval(this.syncTimer);
        this.syncTimer = null;
        if (this.inFlight) await this.inFlight;
    }
}
