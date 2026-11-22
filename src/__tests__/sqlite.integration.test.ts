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
