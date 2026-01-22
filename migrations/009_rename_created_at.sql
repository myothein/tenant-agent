-- migrations/009_rename_created_at.sql

ALTER TABLE outbox RENAME COLUMN created_at TO createdAt;
