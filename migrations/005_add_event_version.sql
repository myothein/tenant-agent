ALTER TABLE outbox ADD COLUMN event_version INTEGER;

UPDATE outbox
SET event_version = 1
WHERE event_version IS NULL;
