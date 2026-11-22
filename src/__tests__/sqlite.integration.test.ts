import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { LocalEventsSyncService } from '../services/sync-local-events.service.js';
import { SyncService } from '../services/sync.service.js';

test('Windows SQLite: preserves event identity, deduplicates, backs up live outbox', async () => {
    const originalWorkingDirectory = process.cwd();
    const directory = mkdtempSync(path.join(tmpdir(), 'agent-sqlite-ci-'));
    let local: LocalEventsSyncService | undefined;
    let sync: SyncService | undefined;
    try {
        process.chdir(directory);
        local = new LocalEventsSyncService('tenant_ci_qa');
        const id = randomUUID();
        const event = {
            id, tenant_code: 'tenant_ci_qa', agent_id: 'tenant-service',
            aggregate_type: 'Subject', aggregate_id: '4',
            event_type: 'subject.created', payload: { name: 'CI-Subject' },
            created_at: new Date().toISOString(), occurred_at: new Date().toISOString()
        };
        local.addToOutbox(event);
        local.addToOutbox(event);
        const live = new Database(path.join(directory, 'data', 'outbox.db'), { readonly: true });
        try {
            const count = live.prepare('SELECT COUNT(*) AS n FROM outbox WHERE id=?').get(id) as { n: number };
            assert.equal(count.n, 1);
        } finally { live.close(); }
        local.close();
        local = undefined;

        sync = new SyncService();
        const backupPath = path.join(directory, 'outbox-snapshot.db');
        await sync.backupTo(backupPath);
        sync.close();
        sync = undefined;

        const backup = new Database(backupPath, { readonly: true });
        try {
            const row = backup.prepare('SELECT id, tenantId, event_type FROM outbox WHERE id=?').get(id) as
                { id: string; tenantId: string; event_type: string };
            assert.equal(row.id, id);
            assert.equal(row.tenantId, 'tenant_ci_qa');
            assert.equal(row.event_type, 'subject.created');
        } finally { backup.close(); }
    } finally {
        local?.close();
        sync?.close();
        process.chdir(originalWorkingDirectory);
        rmSync(directory, { recursive: true, force: true });
    }
});


test('Windows SQLite: central 501 leaves event queued; matching 201 acknowledgment marks it sent', async () => {
    const originalWorkingDirectory = process.cwd();
    const directory = mkdtempSync(path.join(tmpdir(), 'agent-delivery-ci-'));
    const priorKey = process.env.CENTRAL_AGENT_API_KEY;
    const priorUrl = process.env.SYSTEM_API_URL;
    const priorTenant = process.env.TENANT_ID;
    const originalFetch = globalThis.fetch;
    let sync: SyncService | undefined;
    const eventId = randomUUID();
    const sentBodies: unknown[] = [];
    try {
        process.chdir(directory);
        process.env.TENANT_ID = 'university-ci-a';
        process.env.SYSTEM_API_URL = 'http://127.0.0.1:5000';
        process.env.CENTRAL_AGENT_API_KEY = 'ci-only-tenant-a-credential-longer-than-32-bytes';
        sync = new SyncService();
        sync.addEvent({
            id: eventId, tenantId: 'university-ci-a', agentId: 'tenant-agent',
            aggregate_type: 'Subject', aggregate_id: '55',
            event_type: 'subject.created', payload: { id: 55, name: 'CI-Subject' },
            createdAt: '2026-01-01T12:34:57.000Z',
            occurredAt: '2026-01-01T12:34:56.123Z'
        });
        let fail = true;
        globalThis.fetch = async (_url, options) => {
            sentBodies.push(options?.body ? JSON.parse(String(options.body)) : null);
            if (fail) return new Response(
                JSON.stringify({ success: false, code: 'NOT_IMPLEMENTED' }),
                { status: 501, headers: { 'content-type': 'application/json' } });
            return new Response(
                JSON.stringify({ success: true, status: 'accepted', eventId }),
                { status: 201, headers: { 'content-type': 'application/json' } });
        };
        assert.equal(await sync.flushOutbox(), 0);
        let row = sync.listEvents().find(x => x.id === eventId);
        assert.ok(row);
        assert.equal(row.sent, false, 'Failure must not acknowledge the SQLite record');
        assert.equal(row.status, 'failed');
        assert.equal(row.retry_count, 1);
        fail = false;
        assert.equal(await sync.flushOutbox(), 1);
        row = sync.listEvents().find(x => x.id === eventId);
        assert.ok(row);
        assert.equal(row.sent, true);
        assert.equal(row.status, 'sent');
        assert.equal(sentBodies.length, 2);
        for (const body of sentBodies) {
            assert.deepEqual(body, {
                id: eventId, tenantId: 'university-ci-a', agentId: 'tenant-agent',
                event_type: 'subject.created', aggregate_type: 'Subject',
                aggregate_id: '55', payload: { id: 55, name: 'CI-Subject' },
                createdAt: '2026-01-01T12:34:57.000Z',
                occurredAt: '2026-01-01T12:34:56.123Z'
            });
        }
    } finally {
        globalThis.fetch = originalFetch;
        if (priorKey === undefined) delete process.env.CENTRAL_AGENT_API_KEY;
        else process.env.CENTRAL_AGENT_API_KEY = priorKey;
        if (priorUrl === undefined) delete process.env.SYSTEM_API_URL;
        else process.env.SYSTEM_API_URL = priorUrl;
        if (priorTenant === undefined) delete process.env.TENANT_ID;
        else process.env.TENANT_ID = priorTenant;
        sync?.close();
        process.chdir(originalWorkingDirectory);
        rmSync(directory, { recursive: true, force: true });
    }
});
