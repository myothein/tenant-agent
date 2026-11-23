import test from 'node:test';
import assert from 'node:assert/strict';
import { tenantAgentAuthHeaders, toOutboxRecord, TenantLocalEvent } from '../services/event-sync-contract.js';

const source: TenantLocalEvent = {
    id: '22e842cf-a1ab-4d6a-ae07-d5e6a2ec3621',
    tenant_code: 'school-qa',
    agent_id: 'tenant-service',
    aggregate_type: 'Subject',
    aggregate_id: '101',
    event_type: 'subject.created',
    payload: { id: 101, name: 'Math' },
    created_at: '2026-01-01T00:00:00.000Z',
    occurred_at: '2026-01-01T00:00:00.000Z'
};
test('outbox retains the original source UUID for idempotent retries', () => {
    const first = toOutboxRecord(source, 'school-qa');
    const second = toOutboxRecord(source, 'school-qa');
    assert.equal(first.id, source.id);
    assert.equal(first.id, second.id);
    assert.equal(first.tenantId, 'school-qa');
    assert.deepEqual(JSON.parse(first.payload), { id: 101, name: 'Math' });
});
test('source from different tenant is rejected', () => {
    assert.throws(() => toOutboxRecord(source, 'other-school'), /Cross-tenant/);
});
test('invalid source event UUID is rejected', () => {
    assert.throws(() => toOutboxRecord({ ...source, id: 'bad' }, 'school-qa'), /Invalid source/);
});
test('invalid retry metadata is rejected', () => {
    assert.throws(() => toOutboxRecord({ ...source, retry_count: -1 }, 'school-qa'), /Invalid source/);
});
test('agent API key must be configured before reading or acknowledging local events', () => {
    const prior = process.env.TENANT_AGENT_API_KEY;
    delete process.env.TENANT_AGENT_API_KEY;
    try { assert.throws(tenantAgentAuthHeaders, /must be configured/); }
    finally {
        if (prior === undefined) delete process.env.TENANT_AGENT_API_KEY;
        else process.env.TENANT_AGENT_API_KEY = prior;
    }
});
test('configured agent API key is conveyed as a bearer credential', () => {
    const prior = process.env.TENANT_AGENT_API_KEY;
    process.env.TENANT_AGENT_API_KEY = 'agent-integration-test-key-longer-than-32-bytes';
    try {
        const headers = tenantAgentAuthHeaders();
        assert.ok(headers.authorization.startsWith('Bearer '));
    } finally {
        if (prior === undefined) delete process.env.TENANT_AGENT_API_KEY;
        else process.env.TENANT_AGENT_API_KEY = prior;
    }
});
