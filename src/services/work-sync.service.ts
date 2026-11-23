import Database from "better-sqlite3";
import axios from "axios";
import { config } from "../config/tenant-agent.config.js";
import { v4 as uuid } from "uuid";
import { systemApi } from "../system-api/client.js"; // adjust path


export interface OutboxEvent {
    id?: string;
    tenantId: string;
    agentId: string;
    aggregate_type: string;
    aggregate_id: string;
    event_type: string;
    payload: any;
    createdAt?: string;
    occurredAt?: string;
    sent?: number; // 0 = not sent, 1 = sent
    status?: string; // 'pending', 'sent', 'failed'
    retry_count?: number;
    event_version?: number;
    headers?: string;
}


export class SyncService {
    private db: Database.Database;

    constructor() {
        // Open or create SQLite DB
        this.db = new Database("data/outbox.db");

        // Create table if it does not exist (match latest migration schema)
        this.db
            .prepare(
                `CREATE TABLE IF NOT EXISTS outbox (
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
                 )`
            )
            .run();
    }

    /**
     * Add a new event to outbox
     */
    addEvent(event: OutboxEvent) {
        const stmt = this.db.prepare(`
            INSERT INTO outbox (
                id, tenantId, agentId, event_type, payload,
                createdAt, occurredAt, aggregate_type, aggregate_id,
                sent, status, retry_count, event_version, headers
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)

        stmt.run(
            event.id,
            event.tenantId,
            event.agentId || "agent-1",
            event.event_type,
            JSON.stringify(event.payload),
            event.createdAt,
            event.occurredAt,
            event.aggregate_type,
            event.aggregate_id,
            event.sent ?? 0,
            event.status ?? "pending",
            event.retry_count ?? 0,
            event.event_version ?? 1,
            event.headers ?? "{}"
        );

        console.log(`[Sync] Event added to outbox: ${event.event_type}`);
    }

    /**
     * Send all unsent events to central system
     */
    /**
     * Flush unsent events to system API
     */
    async flushOutbox(batchSize = 5): Promise<number> {
        // Fetch all unsent events
        const unsent: any[] = this.db
            .prepare("SELECT * FROM outbox WHERE sent = 0")
            .all()
            .map((row: any) => ({
                ...row,
                payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload
            }));

        if (!unsent.length) return 0;

        console.log(`[Sync] Flushing ${unsent.length} event(s) to system API in batches of ${batchSize}...`);

        let flushedCount = 0;

        // Split events into batches
        for (let i = 0; i < unsent.length; i += batchSize) {
            const batch = unsent.slice(i, i + batchSize);

            // Send all events in the batch in parallel
            const results = await Promise.allSettled(
                batch.map(async (event) => {
                    if (!event.tenantId || !event.event_type || !event.payload) {
                        console.warn(`[Sync] Skipping event ${event.id} — missing tenantId, event_type, or payload`);
                        return false;
                    }

                    // Merge aggregate_type / aggregate_id into payload if present
                    const payloadWithAggregate = {
                        ...event.payload,
                        ...(event.aggregate_type ? { aggregate_type: event.aggregate_type } : {}),
                        ...(event.aggregate_id ? { aggregate_id: event.aggregate_id } : {})
                    };

                    const body = {
                        id: event.id!,
                        tenantId: event.tenantId,              // <-- must exist in outbox
                        agentId: event.agentId || "agent-1",
                        event_type: event.type || event.event_type,
                        aggregate_type: event.aggregate_type,
                        aggregate_id: event.aggregate_id,
                        payload: event.payload,
                        createdAt: event.createdAt ? new Date(event.createdAt).toISOString() : new Date().toISOString(),
                        occurredAt: event.occurredAt ? new Date(event.occurredAt).toISOString() : new Date().toISOString()
                    };

                    try {
                        await systemApi.sendEvent(body);

                        // Mark as sent in DB
                        this.db
                            .prepare("UPDATE outbox SET sent = 1, status = 'sent' WHERE id = ?")
                            .run(event.id);

                        console.log(`[Sync] Event ${event.id} sent`);
                        return true;
                    } catch (err: any) {
                        console.error(`[Sync] Failed to send event ${event.id}:`, err.message);

                        // Increment retry_count & mark as failed
                        this.db
                            .prepare(
                                "UPDATE outbox SET status = 'failed', retry_count = COALESCE(retry_count,0) + 1 WHERE id = ?"
                            )
                            .run(event.id);

                        return false;
                    }
                })
            );

            // Count successful events in this batch
            flushedCount += results.filter(r => r.status === "fulfilled" && r.value === true).length;
        }

        console.log(`[Sync] Finished flushing. Total sent: ${flushedCount}`);
        return flushedCount;
    }




    /**
     * Periodically flush outbox
     */
    start(intervalMs: number = config.syncIntervalMs) {
        this.flushOutbox();
        setInterval(() => this.flushOutbox(), intervalMs);
    }

    /**
     * List all events in outbox
     */
    listEvents() {
        const rows = this.db.prepare("SELECT * FROM outbox").all();
        return rows.map((row: any) => ({
            id: row.id,
            tenantId: row.tenantId,
            event_type: row.event_type,
            payload: JSON.parse(row.payload),
            createdAt: row.createdAt,
            sent: row.sent === 1,
            status: row.status,
        }));
    }

    /**
     * Delete old sent events older than retentionMs
     */
    cleanOldEvents(retentionMs: number = 1000 * 60 * 60 * 24) {
        const cutoff = new Date(Date.now() - retentionMs).toISOString();
        const result = this.db
            .prepare("DELETE FROM outbox WHERE sent = 1 AND createdAt < ?")
            .run(cutoff);
        if (result.changes > 0) {
            console.log(`[Clean] Removed ${result.changes} old sent events older than ${cutoff}`);
        }
    }

    /**
     * Close DB connection
     */
    close() {
        this.db.close();
    }
}
