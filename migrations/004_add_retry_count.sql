ALTER TABLE outbox ADD COLUMN retry_count INTEGER;

UPDATE outbox
SET retry_count = 0
WHERE retry_count IS NULL;

CREATE INDEX IF NOT EXISTS idx_outbox_retry
    ON outbox(retry_count);
