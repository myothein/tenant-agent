// src/outbox/outbox.store.ts
import Database from "better-sqlite3";
import { loadConfig } from "../config/load-config.js";
import { ensureOutboxSchema } from "./outbox.schema.js";
export class OutboxStore {
    db;
    constructor(readonlyMode = false) {
        const config = loadConfig();
        this.db = new Database(config.outboxDbPath, {
            readonly: readonlyMode,
        });
        if (!readonlyMode) {
            ensureOutboxSchema(this.db);
        }
    }
    add(event) {
        this.db.prepare(`
            INSERT INTO outbox (
                id, tenantId, type, payload, createdAt, sent, status
            )
            VALUES (?, ?, ?, ?, ?, 0, 'pending')
        `).run(event.id, event.tenantId, event.type, JSON.stringify(event.payload), event.createdAt);
    }
    listAll() {
        return this.db.prepare(`SELECT * FROM outbox`)
            .all()
            .map(this.mapRow);
    }
    listUnsent() {
        return this.db.prepare(`SELECT * FROM outbox WHERE sent = 0`)
            .all()
            .map(this.mapRow);
    }
    markSent(id) {
        this.db.prepare(`
            UPDATE outbox
            SET sent = 1, status = 'sent', error = NULL
            WHERE id = ?
        `).run(id);
    }
    markFailed(id, error) {
        this.db.prepare(`
            UPDATE outbox
            SET status = 'failed', error = ?
            WHERE id = ?
        `).run(error, id);
    }
    count() {
        const row = this.db
            .prepare(`SELECT COUNT(*) as count FROM outbox`)
            .get();
        return row.count;
    }
    close() {
        this.db.close();
    }
    // -------------------
    // Internal
    // -------------------
    mapRow(row) {
        return {
            ...row,
            payload: JSON.parse(row.payload),
        };
    }
}
