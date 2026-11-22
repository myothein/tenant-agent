# Tenant-Agent ↔ Central-Service event transport contract (draft)

- Central API root config: SYSTEM_API_URL=https://your-central-host (also tolerates /api/v1 suffix).
- POST /api/v1/events with id, tenantId, agentId, event_type, aggregate_type, aggregate_id, payload, createdAt and occurredAt.
- Inject CENTRAL_AGENT_API_KEY as a distinct per-tenant scoped 32+ byte secret. The corresponding entry in Central Service's CENTRAL_AGENT_KEYS_JSON must match tenantId. No plaintext token-file fallback for sending events. Only loopback HTTP permitted.
- Only HTTP 201 {success:true,status:'accepted',eventId:<id>} or HTTP 200 {success:true,status:'duplicate',eventId:<id>} constitutes a durable acknowledgment. Wrong IDs, 202, malformed confirmations and all non-2xx responses MUST keep SQLite events unsent.
- Current Central heartbeat endpoint returns 501 and must be implemented/tested before production.
- Other legacy sync commands may need unification and migration before production. Windows service lifecycle, secret store, event replay and disaster recovery remain NO-GO.
