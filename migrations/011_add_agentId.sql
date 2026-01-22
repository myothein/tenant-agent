-- Add agentId column to outbox table if it doesn't exist
ALTER TABLE outbox ADD COLUMN agentId TEXT;
