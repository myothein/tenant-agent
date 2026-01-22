-- migrations/008_rename_tenant_id.sql

ALTER TABLE outbox RENAME COLUMN tenant_id TO tenantId;
