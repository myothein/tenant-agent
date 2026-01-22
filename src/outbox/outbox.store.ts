// src/outbox/outbox.store.ts
import Database from "better-sqlite3";
import path from "path";
import { loadConfig } from "../config/load-config.js";
import { ensureOutboxSchema } from "./outbox.schema.js";
import { OutboxEvent } from "./outbox.types.js";

export class OutboxStore {
    private db: Database.Database;

    constructor(readonlyMode = false) {
        const config = loadConfig();

        this.db = new Database(config.outboxDbPath, {
            readonly: readonlyMode,
        });

        if (!readonlyMode) {
            ensureOutboxSchema(this.db);
        }
    }

    add(event: Omit<OutboxEvent, "sent" | "status" | "error">) {
        this.db.prepare(`
            INSERT INTO outbox (
                id, tenantId, type, payload, createdAt, sent, status
            )
            VALUES (?, ?, ?, ?, ?, 0, 'pending')
        `).run(
            event.id,
            event.tenantId,
            event.type,
            JSON.stringify(event.payload),
            event.createdAt
        );
    }

    listAll(): OutboxEvent[] {
        return this.db.prepare(`SELECT * FROM outbox`)
            .all()
            .map(this.mapRow);
    }

    listUnsent(): OutboxEvent[] {
        return this.db.prepare(`SELECT * FROM outbox WHERE sent = 0`)
            .all()
            .map(this.mapRow);
    }

    markSent(id: string) {
        this.db.prepare(`
            UPDATE outbox
            SET sent = 1, status = 'sent', error = NULL
            WHERE id = ?
        `).run(id);
    }

    markFailed(id: string, error: string) {
        this.db.prepare(`
            UPDATE outbox
            SET status = 'failed', error = ?
            WHERE id = ?
        `).run(error, id);
    }

    count(): number {
        const row = this.db
            .prepare(`SELECT COUNT(*) as count FROM outbox`)
            .get() as { count: number };

        return row.count;
    }

    close() {
        this.db.close();
    }

    // -------------------
    // Internal
    // -------------------
    private mapRow(row: any): OutboxEvent {
        return {
            ...row,
            payload: JSON.parse(row.payload),
        };
    }
}
