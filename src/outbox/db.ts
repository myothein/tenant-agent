import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { loadConfig } from "../config/load-config.js";

/**
 * Outbox event status
 */
export type OutboxStatus = "pending" | "sent" | "failed";

export interface OutboxEvent {
    id: string;
    type: string;
    payload: unknown;
    status: OutboxStatus;
    attempts: number;
    createdAt: number;
    lastError?: string;
}

let db: Database.Database | null = null;

/* =======================
   Public API
   ======================= */

export function getOutboxDb(): Database.Database {
    if (db) return db;

    const { outboxDbPath } = loadConfig();

    ensureDirectory(path.dirname(outboxDbPath));

    db = new Database(outboxDbPath);
    db.pragma("journal_mode = WAL");

    migrate(db);

    return db;
}

export async function countUnsent(): Promise<number> {
    const row = getOutboxDb()
        .prepare(
            `SELECT COUNT(*) as count FROM outbox WHERE status != 'sent'`
        )
        .get() as { count: number } | undefined;

    return row?.count ?? 0;
}



export async function listEvents(limit = 100): Promise<OutboxEvent[]> {
    return getOutboxDb()
        .prepare(
            `SELECT * FROM outbox ORDER BY createdAt ASC LIMIT ?`
        )
        .all(limit) as OutboxEvent[];
}

export async function insertEvent(
    type: string,
    payload: unknown
): Promise<void> {
    getOutboxDb()
        .prepare(
            `
      INSERT INTO outbox (
        id, type, payload, status, attempts, createdAt
      )
      VALUES (
        ?, ?, ?, 'pending', 0, ?
      )
    `
        )
        .run(
            crypto.randomUUID(),
            type,
            JSON.stringify(payload),
            Date.now()
        );
}

export async function markSent(id: string): Promise<void> {
    getOutboxDb()
        .prepare(
            `UPDATE outbox SET status = 'sent' WHERE id = ?`
        )
        .run(id);
}

export async function markFailed(
    id: string,
    error: string
): Promise<void> {
    getOutboxDb()
        .prepare(
            `
      UPDATE outbox
      SET status = 'failed',
          attempts = attempts + 1,
          lastError = ?
      WHERE id = ?
    `
        )
        .run(error, id);
}

export async function retryFailed(): Promise<number> {
    const result = getOutboxDb()
        .prepare(
            `
      UPDATE outbox
      SET status = 'pending'
      WHERE status = 'failed'
    `
        )
        .run();

    return result.changes;
}

/* =======================
   Migration
   ======================= */

function migrate(db: Database.Database) {
    db.prepare(
        `
    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      lastError TEXT,
      createdAt INTEGER NOT NULL
    )
  `
    ).run();

    db.prepare(
        `CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status)`
    ).run();
}

/* =======================
   Utilities
   ======================= */

function ensureDirectory(dir: string) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
