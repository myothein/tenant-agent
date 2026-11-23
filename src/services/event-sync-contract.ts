/** Pure conversion of an original PostgreSQL local_event to a stable SQLite outbox record. */
export interface TenantLocalEvent {
    id: string;
    tenant_code: string;
    agent_id?: string;
    aggregate_type: string;
    aggregate_id: string;
    event_type: string;
    payload: unknown;
    created_at?: string;
    occurred_at?: string;
    retry_count?: number;
    event_version?: number;
    headers?: unknown;
}

export function tenantAgentAuthHeaders(): { authorization: string } {
    const token = process.env.TENANT_AGENT_API_KEY;
    if (!token || Buffer.byteLength(token, 'utf8') < 32) {
        throw new Error('TENANT_AGENT_API_KEY must be configured');
    }
    return { authorization: 'Bearer ' + token };
}

export function toOutboxRecord(event: TenantLocalEvent, tenantId: string) {
    if (event.tenant_code !== tenantId || !/^[A-Za-z0-9_-]{1,64}$/.test(tenantId)) {
        throw new Error('Cross-tenant event rejected');
    }
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(event.id)) {
        throw new Error('Invalid source event ID');
    }
    if (!event.event_type || !event.aggregate_type || !event.aggregate_id) {
        throw new Error('Invalid source event fields');
    }
    const retry_count = event.retry_count ?? 0;
    const event_version = event.event_version ?? 1;
    if (!Number.isSafeInteger(retry_count) || retry_count < 0 ||
        !Number.isSafeInteger(event_version) || event_version < 1) {
        throw new Error('Invalid source event metadata');
    }
    return {
        id: event.id, // preserve across restarts / retries / downstream idempotency
        tenantId, agentId: event.agent_id || 'tenant-service',
        aggregate_type: event.aggregate_type, aggregate_id: event.aggregate_id,
        event_type: event.event_type,
        payload: JSON.stringify(event.payload ?? {}),
        createdAt: event.created_at ?? new Date().toISOString(),
        occurredAt: event.occurred_at ?? new Date().toISOString(),
        retry_count, event_version, headers: JSON.stringify(event.headers ?? {})
    };
}
