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

        // 🔒 Guard rail (debug lifesaver)
        if (values.some(v => v === undefined)) {
            Logger.error("[Outbox] Undefined value detected", values);
            throw new Error("Undefined value in outbox insert");
        }

        stmt.run(values);

        Logger.info(
            `[Tenant-Agent] Local event queued: ${event.event_type}`
        );
    }

    /* ============================
       Flush outbox → central API
    ============================ */

    async flushOutbox(batchSize = 5): Promise<number> {
        const rows = this.outboxDb
            .prepare(`
                SELECT *
                FROM outbox
                WHERE sent = 0
                ORDER BY createdAt ASC
            `)
            .all();

        if (rows.length === 0) return 0;

        console.log(`[Sync] Flushing ${rows.length} event(s)...`);

        let flushedCount = 0;

        for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize);

            const results = await Promise.allSettled(
                batch.map(async (row: any) => {
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
       Start loop (CLI)
    ============================ */

    start(intervalMs = config.syncIntervalMs) {
        Logger.info(
            `[Tenant-Agent] Sync loop started for tenant ${this.tenantId}`
        );

        const run = async () => {
            try {
                const polled = await this.pollLocalEvents();
                if (polled > 0) {
                    Logger.info(`[Tenant-Agent] Polled ${polled} local events`);
                }

                const flushed = await this.flushOutbox();
                if (flushed > 0) {
                    Logger.info(`[Tenant-Agent] Flushed ${flushed} events`);
                }
            } catch (err: any) {
                Logger.error(`[Sync] Error during sync: ${err.message}`);
            }
        };

        run();
        setInterval(run, intervalMs);
    }
}
