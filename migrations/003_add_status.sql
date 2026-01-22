ALTER TABLE outbox ADD COLUMN status TEXT;

UPDATE outbox
SET status = 'pending'
WHERE status IS NULL;

CREATE INDEX IF NOT EXISTS idx_outbox_status
    ON outbox(status);
