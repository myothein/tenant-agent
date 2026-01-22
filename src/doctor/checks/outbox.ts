// src/doctor/checks/outbox.ts
import Database from "better-sqlite3";
import { loadConfig } from "../../config/load-config.js";
import { DoctorCheckResult } from "../run-doctor.js";

export async function checkOutbox(): Promise<DoctorCheckResult> {
    const config = loadConfig();
    const dbPath = config.outboxDbPath;

    try {
        const db = new Database(dbPath, { readonly: true });

        // Check if the table exists
        const tableExists = db
            .prepare(
                `SELECT name FROM sqlite_master WHERE type='table' AND name='outbox'`
            )
            .get();

        if (!tableExists) {
            return {
                name: "Outbox",
                status: "fail",
                message: "Outbox table does not exist",
            };
        }

        // Check required columns: id, type, payload, createdAt, sent
        const columns: string[] = db
            .prepare(`PRAGMA table_info(outbox)`)
            .all()
            .map((col: any) => col.name);

        const requiredColumns = ["id", "event_type", "payload", "createdAt", "sent"];
        const missing = requiredColumns.filter(col => !columns.includes(col));

        if (missing.length) {
            return {
                name: "Outbox",
                status: "fail",
                message: `Missing columns: ${missing.join(", ")}`,
                meta: { columns },
            };
        }

        // Count number of events safely
        const row = db.prepare(`SELECT COUNT(*) as count FROM outbox`).get() as { count: number };
        const count = row.count;

        db.close();

        return {
            name: "Outbox",
            status: "pass",
            message: `Outbox table exists with ${count} events`,
            meta: { count },
        };
    } catch (err: any) {
        return {
            name: "Outbox",
            status: "fail",
            message: `Failed to access outbox DB: ${err.message}`,
        };
    }
}
