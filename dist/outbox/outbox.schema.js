export function ensureOutboxSchema(db) {
    // Base table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS outbox (
            id TEXT PRIMARY KEY,
            tenantId TEXT NOT NULL,
            type TEXT NOT NULL,
            payload TEXT NOT NULL,
            createdAt TEXT NOT NULL,
            sent INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending',
            error TEXT
        )
    `).run();
    // Indexes (important for scale)
    db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_outbox_sent
        ON outbox(sent)
    `).run();
    db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_outbox_type
        ON outbox(type)
    `).run();
}
