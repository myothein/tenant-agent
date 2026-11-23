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
        assert.throws(
            () => local!.addToOutbox({ ...event, payload: {name:'Altered-Event-Body'} }),
            /Local outbox event ID collision/,
            'Same ID with different content must not silently acknowledge source'
        );
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


test('Windows SQLite: canonical sync scheduler avoids overlaps and shuts down cleanly', async () => {
    const originalDirectory=process.cwd();
    const directory=mkdtempSync(path.join(tmpdir(),'agent-scheduler-ci-'));
    let local:LocalEventsSyncService | undefined;
    try {
        process.chdir(directory);
        local=new LocalEventsSyncService('tenant_ci_qa');
        let active=0;
        let maxActive=0;
        let pollCount=0;
        local.pollLocalEvents=async()=>{
            active++;
            maxActive=Math.max(active,maxActive);
            await new Promise<void>(resolve=>setTimeout(resolve,60));
            active--;
            pollCount++;
            return 0;
        };
        local.flushOutbox=async()=>{
            active++;
            maxActive=Math.max(active,maxActive);
            await new Promise<void>(resolve=>setTimeout(resolve,20));
            active--;
            return 0;
        };
        local.start(25);
        await new Promise<void>(resolve=>setTimeout(resolve,250));
        await local.stop();
        assert.ok(pollCount>=2,'Scheduler should run repeatedly');
        assert.equal(maxActive,1,'Only one poll/flush may be active');
        const stoppedCount=pollCount;
        await new Promise<void>(resolve=>setTimeout(resolve,70));
        assert.equal(pollCount,stoppedCount,'No timer may run after stop');
        assert.equal(local.cleanSentEvents(0),0);
        const snapshot=path.join(directory,'scheduler-snapshot.db');
        await local.backupTo(snapshot);
        const restored=new Database(snapshot,{readonly:true});
        try {
            const result=restored.prepare('SELECT count(*) AS n FROM outbox').get() as {n:number};
            assert.equal(result.n,0);
        } finally {restored.close();}
        local.close();
        local=undefined;
    } finally {
        if(local){
            await local.stop();
            local.close();
        }
        process.chdir(originalDirectory);
        rmSync(directory,{recursive:true,force:true});
    }
});


test('Windows SQLite: foreign-tenant rows remain quarantined while own events still deliver', async () => {
    const previousCwd = process.cwd();
    const directory = mkdtempSync(path.join(tmpdir(), 'agent-foreign-outbox-'));
    const envBefore = {
        tenant: process.env.TENANT_ID,
        url: process.env.SYSTEM_API_URL,
        key: process.env.CENTRAL_AGENT_API_KEY
    };
    const originalFetch = globalThis.fetch;
    let local: LocalEventsSyncService | undefined;
    const posted: Array<{ id:string; tenantId:string }> = [];
    try {
        process.chdir(directory);
        process.env.TENANT_ID = 'university-ci-a';
        process.env.SYSTEM_API_URL = 'http://127.0.0.1:5000';
        process.env.CENTRAL_AGENT_API_KEY = 'ci-only-tenant-a-credential-longer-than-32-bytes';
        local = new LocalEventsSyncService('university-ci-a');

        const ownId = randomUUID();
        const foreignId = randomUUID();
        const source = (id:string) => ({
            id, tenant_code:'university-ci-a', agent_id:'tenant-service',
            aggregate_type:'Subject', aggregate_id:'101',
            event_type:'subject.created', payload:{id:101,name:'Synthetic-Subject'},
            created_at:'2026-01-01T10:00:00.000Z',
            occurred_at:'2026-01-01T10:00:00.000Z'
        });
        local.addToOutbox(source(ownId));
        local.addToOutbox(source(foreignId));
        // Simulate a pre-existing corrupted/misrouted SQLite row. The normal
        // tenant-scoped source API cannot create this row.
        const dbPath = path.join(directory,'data/outbox.db');
        const db = new Database(dbPath);
        try {
            db.prepare('UPDATE outbox SET tenantId = ? WHERE id = ?')
                .run('university-ci-b',foreignId);
        } finally { db.close(); }

        globalThis.fetch = async (_url,options) => {
            const body = JSON.parse(String(options?.body)) as {id:string;tenantId:string};
            posted.push({id:body.id,tenantId:body.tenantId});
            return new Response(JSON.stringify({
                success:true,status:'accepted',eventId:body.id
            }),{status:201,headers:{'content-type':'application/json'}});
        };
        await assert.rejects(() => local!.flushOutbox(0), /Invalid outbox batch size/);
        await assert.rejects(() => local!.flushOutbox(-1), /Invalid outbox batch size/);
        assert.equal(await local.flushOutbox(),1);
        assert.deepEqual(posted,[{id:ownId,tenantId:'university-ci-a'}]);
        const rows = new Database(dbPath,{readonly:true});
        try {
            const foreign = rows.prepare('SELECT sent,status,retry_count FROM outbox WHERE id=?')
                .get(foreignId) as {sent:number;status:string;retry_count:number};
            const own = rows.prepare('SELECT sent,status FROM outbox WHERE id=?')
                .get(ownId) as {sent:number;status:string};
            assert.deepEqual(foreign,{sent:0,status:'pending',retry_count:0});
            assert.deepEqual(own,{sent:1,status:'sent'});
        } finally {rows.close();}
    } finally {
        globalThis.fetch=originalFetch;
        if (envBefore.tenant === undefined) delete process.env.TENANT_ID;
        else process.env.TENANT_ID=envBefore.tenant;
        if (envBefore.url === undefined) delete process.env.SYSTEM_API_URL;
        else process.env.SYSTEM_API_URL=envBefore.url;
        if (envBefore.key === undefined) delete process.env.CENTRAL_AGENT_API_KEY;
        else process.env.CENTRAL_AGENT_API_KEY=envBefore.key;
        local?.close();
        process.chdir(previousCwd);
        rmSync(directory,{recursive:true,force:true});
    }
});

test('Windows SQLite: legacy SyncService also refuses foreign-tenant replay', async () => {
    const previousCwd=process.cwd();
    const directory=mkdtempSync(path.join(tmpdir(),'agent-legacy-isolation-'));
    const envBefore={
        tenant:process.env.TENANT_ID,url:process.env.SYSTEM_API_URL,
        key:process.env.CENTRAL_AGENT_API_KEY
    };
    const previousFetch=globalThis.fetch;
    let sync:SyncService|undefined;
    let networkCalls=0;
    try {
        process.chdir(directory);
        process.env.TENANT_ID='university-ci-a';
        process.env.SYSTEM_API_URL='http://127.0.0.1:5000';
        process.env.CENTRAL_AGENT_API_KEY='ci-only-tenant-a-credential-longer-than-32-bytes';
        sync=new SyncService();
        const wrongId=randomUUID();
        sync.addEvent({
            id:wrongId,tenantId:'university-ci-b',agentId:'tenant-agent',
            aggregate_type:'Subject',aggregate_id:'12',event_type:'subject.created',
            payload:{name:'Wrong-Tenant'},occurredAt:'2026-01-01T00:00:00.000Z'
        });
        globalThis.fetch=async()=>{networkCalls++;throw Error('No foreign event delivery allowed');};
        await assert.rejects(()=>sync!.flushOutbox(0),/Invalid outbox batch size/);
        assert.equal(await sync.flushOutbox(),0);
        assert.equal(networkCalls,0);
        const row=sync.listEvents().find(x=>x.id===wrongId);
        assert.ok(row);
        assert.equal(row.sent,false);
        assert.equal(row.retry_count,0);
    } finally {
        globalThis.fetch=previousFetch;
        if(envBefore.tenant===undefined)delete process.env.TENANT_ID;
        else process.env.TENANT_ID=envBefore.tenant;
        if(envBefore.url===undefined)delete process.env.SYSTEM_API_URL;
        else process.env.SYSTEM_API_URL=envBefore.url;
        if(envBefore.key===undefined)delete process.env.CENTRAL_AGENT_API_KEY;
        else process.env.CENTRAL_AGENT_API_KEY=envBefore.key;
        sync?.close();
        process.chdir(previousCwd);
        rmSync(directory,{recursive:true,force:true});
    }
});


test('Windows SQLite: bounded outbox flush defers events added after its high-water mark', async () => {
    const previousCwd = process.cwd();
    const directory = mkdtempSync(path.join(tmpdir(), 'agent-bounded-outbox-'));
    const previous = {
        tenant: process.env.TENANT_ID,
        url: process.env.SYSTEM_API_URL,
        key: process.env.CENTRAL_AGENT_API_KEY
    };
    const priorFetch = globalThis.fetch;
    let local: LocalEventsSyncService | undefined;
    try {
        process.chdir(directory);
        process.env.TENANT_ID = 'ci-bounded-tenant';
        process.env.SYSTEM_API_URL = 'http://127.0.0.1:5000';
        process.env.CENTRAL_AGENT_API_KEY = 'ci-only-bounded-outbox-credential-longer-than-32-bytes';
        local = new LocalEventsSyncService('ci-bounded-tenant');
        const makeEvent = (id: string) => ({
            id, tenant_code: 'ci-bounded-tenant', agent_id: 'tenant-service',
            aggregate_type: 'Subject', aggregate_id: '42', event_type: 'subject.created',
            payload: { id: 42, name: 'Synthetic only' },
            created_at: '2026-01-01T00:00:00.000Z',
            occurred_at: '2026-01-01T00:00:00.000Z'
        });
        const oldIds = Array.from({ length: 35 }, () => randomUUID());
        const addedDuringDelivery = randomUUID();
        const posted: string[] = [];
        let injected = false;
        for (const id of oldIds) local.addToOutbox(makeEvent(id));
        globalThis.fetch = async (_url, options) => {
            const event = JSON.parse(String(options?.body)) as { id: string };
            posted.push(event.id);
            if (!injected) {
                injected = true;
                local!.addToOutbox(makeEvent(addedDuringDelivery));
            }
            return new Response(JSON.stringify({
                success: true, status: 'accepted', eventId: event.id
            }), { status: 201, headers: { 'content-type': 'application/json' } });
        };
        assert.equal(await local.flushOutbox(7), oldIds.length);
        assert.equal(posted.length, oldIds.length,
            'A flush must read a bounded snapshot, not newly appended events');
        assert.equal(posted.includes(addedDuringDelivery), false);
        const view = new Database(path.join(directory, 'data/outbox.db'), { readonly: true });
        try {
            const item = view.prepare('SELECT sent, status FROM outbox WHERE id=?')
                .get(addedDuringDelivery) as { sent: number; status: string };
            assert.deepEqual(item, { sent: 0, status: 'pending' });
            const sentCount = view.prepare('SELECT COUNT(*) AS n FROM outbox WHERE sent=1')
                .get() as { n: number };
            assert.equal(sentCount.n, oldIds.length);
        } finally { view.close(); }
        assert.equal(await local.flushOutbox(7), 1);
        assert.equal(posted.at(-1), addedDuringDelivery);
    } finally {
        globalThis.fetch = priorFetch;
        if (previous.tenant === undefined) delete process.env.TENANT_ID;
        else process.env.TENANT_ID = previous.tenant;
        if (previous.url === undefined) delete process.env.SYSTEM_API_URL;
        else process.env.SYSTEM_API_URL = previous.url;
        if (previous.key === undefined) delete process.env.CENTRAL_AGENT_API_KEY;
        else process.env.CENTRAL_AGENT_API_KEY = previous.key;
        local?.close();
        process.chdir(previousCwd);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('Windows SQLite: invalid outbox source never prints private event payload', () => {
    const previousCwd = process.cwd();
    const directory = mkdtempSync(path.join(tmpdir(), 'agent-private-log-'));
    const priorError = console.error;
    let local: LocalEventsSyncService | undefined;
    const log: string[] = [];
    try {
        process.chdir(directory);
        local = new LocalEventsSyncService('tenant_ci_qa');
        const secretSentinel = 'PRIVATE_EVENT_PAYLOAD_MUST_NOT_APPEAR_IN_LOG';
        const event = {
            id: randomUUID(), tenant_code: 'tenant_ci_qa',
            agent_id: 'tenant-service', aggregate_type: 'Subject',
            aggregate_id: '42', event_type: 'subject.created',
            payload: { privateValue: secretSentinel },
            created_at: '2026-01-01T00:00:00.000Z',
            occurred_at: '2026-01-01T00:00:00.000Z',
            // Functions cannot be serialized as JSON; trigger the invalid
            // record guard without introducing a real credential.
            headers: (() => 'invalid fixture') as unknown as string
        };
        console.error = (...parts: unknown[]) => { log.push(parts.map(String).join(' ')); };
        assert.throws(() => local!.addToOutbox(event), /Invalid outbox record/);
        assert.equal(log.length, 1, 'Invalid event should produce one sanitized diagnostic');
        assert.ok(!log.join(' ').includes(secretSentinel));
        assert.ok(!log.join(' ').includes('privateValue'));
    } finally {
        console.error = priorError;
        local?.close();
        process.chdir(previousCwd);
        rmSync(directory, { recursive: true, force: true });
    }
});


test('Windows SQLite: manual sync bounds memory and isolates malformed JSON', async () => {
    const cwd = process.cwd();
    const dir = mkdtempSync(path.join(tmpdir(), 'agent-cli-bounded-'));
    const previous = {
        tenant: process.env.TENANT_ID, url: process.env.SYSTEM_API_URL,
        key: process.env.CENTRAL_AGENT_API_KEY
    };
    const fetchBefore = globalThis.fetch;
    const errorBefore = console.error;
    const errors: string[] = [];
    const delivered: string[] = [];
    let sync: SyncService | undefined;
    try {
        process.chdir(dir);
        process.env.TENANT_ID = 'ci-manual-tenant';
        process.env.SYSTEM_API_URL = 'http://127.0.0.1:5000';
        process.env.CENTRAL_AGENT_API_KEY = 'ci-manual-agent-key-more-than-32-bytes';
        sync = new SyncService();
        const ids = Array.from({ length: 14 }, () => randomUUID());
        const badId = randomUUID();
        const injectedId = randomUUID();
        const makeEvent = (id: string) => ({
            id, tenantId: 'ci-manual-tenant', agentId: 'tenant-agent',
            aggregate_type: 'Subject', aggregate_id: '2',
            event_type: 'subject.created', payload: { id: 2, name: 'QA Synthetic' },
            createdAt: '2026-01-01T00:00:00.000Z',
            occurredAt: '2026-01-01T00:00:00.000Z'
        });
        for (const id of ids) sync.addEvent(makeEvent(id));
        sync.addEvent(makeEvent(badId));
        const dbPath = path.join(dir, 'data/outbox.db');
        const sqlite = new Database(dbPath);
        try {
            sqlite.prepare('UPDATE outbox SET payload=? WHERE id=?').run(
                '{"sensitive":"PRIVATE_INVALID_JSON_SENTINEL"', badId
            );
        } finally { sqlite.close(); }

        let appended = false;
        globalThis.fetch = async (_url, options) => {
            const event = JSON.parse(String(options?.body)) as { id: string };
            delivered.push(event.id);
            if (!appended) {
                appended = true;
                sync!.addEvent(makeEvent(injectedId));
            }
            return new Response(JSON.stringify({
                success: true, status: 'accepted', eventId: event.id
            }), { status: 201, headers: { 'content-type': 'application/json' } });
        };
        console.error = (...values: unknown[]) => {
            errors.push(values.map(String).join(' '));
        };
        assert.equal(await sync.flushOutbox(3), ids.length);
        assert.equal(delivered.includes(injectedId), false,
            'An event appended during the current flush is deferred');
        assert.equal(delivered.includes(badId), false, 'Malformed JSON is never transmitted');
        assert.equal(delivered.length, ids.length);
        assert.ok(errors.some(message => message.includes('Invalid SQLite event JSON')));
        assert.ok(!errors.join(' ').includes('PRIVATE_INVALID_JSON_SENTINEL'),
            'Raw corrupt event payload must never appear in logs');

        const snapshot = new Database(dbPath, { readonly: true });
        try {
            const malformed = snapshot.prepare('SELECT sent, status, retry_count FROM outbox WHERE id=?')
                .get(badId) as { sent: number; status: string; retry_count: number };
            assert.deepEqual(malformed, { sent: 0, status: 'pending', retry_count: 0 });
        } finally { snapshot.close(); }
        assert.equal(await sync.flushOutbox(3), 1);
        assert.equal(delivered.at(-1), injectedId);
    } finally {
        console.error = errorBefore;
        globalThis.fetch = fetchBefore;
        if (previous.tenant === undefined) delete process.env.TENANT_ID;
        else process.env.TENANT_ID = previous.tenant;
        if (previous.url === undefined) delete process.env.SYSTEM_API_URL;
        else process.env.SYSTEM_API_URL = previous.url;
        if (previous.key === undefined) delete process.env.CENTRAL_AGENT_API_KEY;
        else process.env.CENTRAL_AGENT_API_KEY = previous.key;
        sync?.close();
        process.chdir(cwd);
        rmSync(dir, { recursive: true, force: true });
    }
});


test('Windows SQLite: WAL FULL durability survives close/reopen and native backup', async () => {
    const cwd = process.cwd();
    const temp = mkdtempSync(path.join(tmpdir(), 'agent-full-sync-'));
    let local: LocalEventsSyncService | undefined;
    let legacy: SyncService | undefined;
    try {
        process.chdir(temp);
        local = new LocalEventsSyncService('tenant_ci_qa');
        const live = (local as unknown as { outboxDb: Database.Database }).outboxDb;
        assert.equal(live.pragma('journal_mode', { simple: true }), 'wal');
        assert.equal(live.pragma('synchronous', { simple: true }), 2,
            'Source acknowledgements require SQLite synchronous FULL');
        assert.ok(Number(live.pragma('busy_timeout', { simple: true })) >= 5000);

        const id = randomUUID();
        local.addToOutbox({
            id, tenant_code: 'tenant_ci_qa', agent_id: 'tenant-service',
            aggregate_type: 'Subject', aggregate_id: '9001',
            event_type: 'subject.created', payload: { value: 'synthetic-only' },
            created_at: '2020-01-01T00:00:00.000Z',
            occurred_at: '2020-01-01T00:00:00.000Z'
        });
        const snapshotPath = path.join(temp, 'verified-durable-outbox.db');
        await local.backupTo(snapshotPath);
        local.close();
        local = undefined;

        // A new process must be able to reopen a previously acknowledged
        // source event without changing its original UUID or pending state.
        local = new LocalEventsSyncService('tenant_ci_qa');
        const reopened = (local as unknown as { outboxDb: Database.Database }).outboxDb;
        assert.equal(reopened.pragma('journal_mode', { simple: true }), 'wal');
        assert.equal(reopened.pragma('synchronous', { simple: true }), 2);
        const persisted = reopened.prepare(
            'SELECT id,tenantId,sent,status,payload FROM outbox WHERE id=?'
        ).get(id) as {
            id: string; tenantId: string; sent: number; status: string; payload: string
        };
        assert.equal(persisted.id, id);
        assert.equal(persisted.tenantId, 'tenant_ci_qa');
        assert.equal(persisted.sent, 0);
        assert.equal(persisted.status, 'pending');
        assert.deepEqual(JSON.parse(persisted.payload), { value: 'synthetic-only' });
        local.close();
        local = undefined;

        // Legacy/manual commands use the same durable file and FULL-sync
        // connection policy: switching entrypoints must not lower durability.
        legacy = new SyncService();
        const manual = (legacy as unknown as { db: Database.Database }).db;
        assert.equal(manual.pragma('journal_mode', { simple: true }), 'wal');
        assert.equal(manual.pragma('synchronous', { simple: true }), 2);
        legacy.close();
        legacy = undefined;

        const backup = new Database(snapshotPath, { readonly: true });
        try {
            assert.equal(backup.pragma('integrity_check', { simple: true }), 'ok');
            const row = backup.prepare('SELECT id,sent FROM outbox WHERE id=?')
                .get(id) as { id: string; sent: number };
            assert.equal(row.id, id);
            assert.equal(row.sent, 0);
        } finally { backup.close(); }
    } finally {
        local?.close();
        legacy?.close();
        process.chdir(cwd);
        rmSync(temp, { recursive: true, force: true });
    }
});
