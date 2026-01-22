// services/export.service.ts
import Database from "better-sqlite3";
import fs from "fs-extra";
import path from "path";
import { loadConfig } from "../config/load-config.js";

export type OutboxEvent = {
    id: string;
    tenantId: string;
    event_type: string;
    payload: any;
    createdAt: string;
    sent: boolean;
    status?: string;
};

export class ExportService {
    private dbPath: string;
    private allowedEventTypes: string[];

    constructor(allowedEventTypes: string[] = ["student.created", "student.updated", "student.deleted"]) {
        const config = loadConfig();
        this.dbPath = path.resolve(config.outboxDbPath);
        this.allowedEventTypes = allowedEventTypes;
    }

    private openDb(readonly = true): Database.Database {
        return new Database(this.dbPath, { readonly });
    }

    /** =========================
     * Export events to JSON file
     * ========================= */
    async exportEvents(options?: {
        outFile?: string;
        onlyUnsent?: boolean;
        onlySent?: boolean;
        tenantId?: string;
    }): Promise<string> {
        const db = this.openDb();
        const outFile = path.resolve(options?.outFile ?? "outbox-events.json");

        try {
            const where: string[] = [];
            const params: any[] = [];

            if (options?.onlyUnsent) where.push("sent = 0");
            if (options?.onlySent) where.push("sent = 1");
            if (options?.tenantId) {
                where.push("tenantId = ?");
                params.push(options.tenantId);
            }

            const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

            const rows = db.prepare(`SELECT * FROM outbox ${whereClause} ORDER BY createdAt ASC`).all(...params)
                .map((row: any) => ({ ...row, sent: row.sent === 1, payload: JSON.parse(row.payload) }));

            const exportData = {
                meta: {
                    tenantId: options?.tenantId ?? "all",
                    exportedAt: new Date().toISOString(),
                    count: rows.length,
                },
                events: rows,
            };

            await fs.ensureDir(path.dirname(outFile));
            await fs.writeJSON(outFile, exportData, { spaces: 2 });

            return outFile;
        } finally {
            db.close();
        }
    }

    /** =========================
     * Import events from JSON file
     * ========================= */
    async importEvents(filePath: string, options?: { skipDuplicates?: boolean }): Promise<number> {
        if (!(await fs.pathExists(filePath))) throw new Error(`File not found: ${filePath}`);

        const raw = await fs.readJSON(filePath);
        if (!raw.events || !Array.isArray(raw.events)) throw new Error("Invalid events file");

        const db = this.openDb(false);
        let imported = 0;

        try {
            const stmt = db.prepare(
                `INSERT OR IGNORE INTO outbox (id, tenantId, type, payload, createdAt, sent, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
            );

            for (const evt of raw.events) {
                if (options?.skipDuplicates) {
                    const exists = db.prepare("SELECT 1 FROM outbox WHERE id = ?").get(evt.id);
                    if (exists) continue;
                }

                stmt.run(evt.id, evt.tenantId, evt.type, JSON.stringify(evt.payload), evt.createdAt, evt.sent ? 1 : 0, evt.status ?? "pending");
                imported++;
            }
        } finally {
            db.close();
        }

        return imported;
    }

    /** =========================
     * Validate events in local outbox
     * ========================= */
    async validateEvents(options?: { tenantId?: string; type?: string }): Promise<{ valid: OutboxEvent[]; invalid: (OutboxEvent & { errors: string[] })[] }> {
        const db = this.openDb();
        const where: string[] = [];
        const params: any[] = [];

        if (options?.tenantId) { where.push("tenantId = ?"); params.push(options.tenantId); }
        if (options?.type) { where.push("type = ?"); params.push(options.type); }

        const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

        const rows = db.prepare(`SELECT * FROM outbox ${whereClause}`).all(...params)
            .map((row: any) => ({ ...row, sent: row.sent === 1, payload: JSON.parse(row.payload) }));

        const valid: OutboxEvent[] = [];
        const invalid: (OutboxEvent & { errors: string[] })[] = [];

        for (const row of rows) {
            const errors: string[] = [];
            if (!row.id) errors.push("Missing id");
            if (!row.tenantId) errors.push("Missing tenantId");
            if (!row.type) errors.push("Missing type");
            if (!row.createdAt) errors.push("Missing createdAt");
            if (!["boolean"].includes(typeof row.sent)) errors.push("Invalid sent value");
            try { JSON.parse(JSON.stringify(row.payload)); } catch { errors.push("Invalid JSON payload"); }
            if (!this.allowedEventTypes.includes(row.type)) errors.push(`Unknown event type: ${row.type}`);

            if (errors.length) invalid.push({ ...row, errors });
            else valid.push(row);
        }

        db.close();
        return { valid, invalid };
    }
}
