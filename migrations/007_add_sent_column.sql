-- migrations/007_add_sent_column.sql
ALTER TABLE outbox ADD COLUMN sent INTEGER;

UPDATE outbox
SET sent = 0
WHERE sent IS NULL;

CREATE INDEX IF NOT EXISTS idx_outbox_sent
    ON outbox(sent);
