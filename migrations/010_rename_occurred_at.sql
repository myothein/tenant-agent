-- migrations/010_rename_occurredd_at.sql

ALTER TABLE outbox RENAME COLUMN occurred_at TO occurredAt;
