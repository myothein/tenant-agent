ALTER TABLE outbox ADD COLUMN created_at TEXT;

UPDATE outbox
SET created_at = datetime('now')
WHERE created_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_outbox_created_at
    ON outbox(created_at);
