import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import type { Server } from 'node:http';
import { LocalEventsSyncService } from '../services/sync-local-events.service.js';
import { systemApi } from '../system-api/client.js';

const root = process.cwd();
const load = createRequire(import.meta.url);
const central = load(path.join(root,'integration/central-service/dist/server.js'));
const centralDb = load(path.join(root,'integration/central-service/dist/infrastructure/db/system-pool.js'));
const tenant = load(path.join(root,'integration/tenant-service/dist/server.js'));
const tenantDb = load(path.join(root,'integration/tenant-service/dist/lib/db.js'));
const tenantId = 'tenant_ci_qa';
const adminKey = 'ci-only-admin-credential-longer-than-32-bytes';
const centralKey = 'ci-only-central-agent-credential-longer-than-32-bytes';

async function listen(app: {listen:(port:number,host:string)=>Server}) {
    const server = app.listen(0,'127.0.0.1');
    await once(server,'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('No test listener');
    return {server,url:'http://127.0.0.1:'+address.port};
}
async function stop(server:Server | undefined) {
    if (server) await new Promise<void>((resolve,reject)=>
        server.close(e=>e ? reject(e) : resolve()));
}
async function createSubject(url:string) {
    const response = await fetch(url+'/subjects',{
        method:'POST',
        headers:{authorization:'Bearer '+adminKey,'content-type':'application/json'},
        body:JSON.stringify({name:'E2E-'+randomUUID()})
    });
    const body = await response.json() as {id:number;tenant_code:string};
    assert.equal(response.status,201);
    assert.equal(body.tenant_code,tenantId);
    return body;
}

test('full three-service PostgreSQL to SQLite to PostgreSQL event sync, replay and recovery',{
    skip:process.env.RUN_FULL_SYNC_E2E!=='1'
},async()=>{
    const originalCwd=process.cwd();
    const temp=mkdtempSync(path.join(tmpdir(),'agent-e2e-'));
    const previous={TENANT_ID:process.env.TENANT_ID,SYSTEM_API_URL:process.env.SYSTEM_API_URL,
        TENANT_API_URL:process.env.TENANT_API_URL,CENTRAL_AGENT_API_KEY:process.env.CENTRAL_AGENT_API_KEY};
    let local:LocalEventsSyncService | undefined;
    let centralServer:Server | undefined;
    let tenantServer:Server | undefined;
    try {
        process.env.TENANT_ID=tenantId;
        process.env.CENTRAL_AGENT_API_KEY=centralKey;
        const centralHttp=await listen(central.app);
        centralServer=centralHttp.server;
        const tenantHttp=await listen(tenant.createApp(tenantId));
        tenantServer=tenantHttp.server;
        process.env.SYSTEM_API_URL=centralHttp.url;
        process.env.TENANT_API_URL=tenantHttp.url;
        const cp=centralDb.getSystemPool();
        const tp=tenantDb.getTenantPool(tenantId);
        await cp.query('INSERT INTO "tenants" ("id","name","databaseUrl") VALUES ($1,$2,$3)',
            [tenantId,'Synthetic CI tenant','nonsecret-config-placeholder']);
        process.chdir(temp);
        local=new LocalEventsSyncService(tenantId,tenantHttp.url);

        const first=await createSubject(tenantHttp.url);
        const source=await tp.query(
            'SELECT id,sent FROM local_events WHERE tenant_code=$1 AND aggregate_id=$2',
            [tenantId,String(first.id)]);
        assert.equal(source.rowCount,1);
        const originalId=String(source.rows[0].id);
        assert.equal(await local.pollLocalEvents(),1);
        const db1=new Database(path.join(temp,'data/outbox.db'),{readonly:true});
        try {
            const row=db1.prepare('SELECT id,tenantId,sent FROM outbox WHERE id=?')
                .get(originalId) as {id:string;tenantId:string;sent:number};
            assert.equal(row.id,originalId);
            assert.equal(row.tenantId,tenantId);
            assert.equal(row.sent,0);
        } finally {db1.close();}
        const marked=await tp.query('SELECT sent FROM local_events WHERE id=$1',[originalId]);
        assert.equal(marked.rows[0].sent,1);
        assert.equal(await local.flushOutbox(),1);
        const centralRow=await cp.query(
            'SELECT id,"tenantId",payload FROM events WHERE id=$1',[originalId]);
        assert.equal(centralRow.rowCount,1);
        assert.equal(centralRow.rows[0].tenantId,tenantId);
        assert.equal(centralRow.rows[0].payload.data.id,first.id);

        // Crash window: central wrote event, local sent flag was not committed.
        const replay=new Database(path.join(temp,'data/outbox.db'));
        try { replay.prepare("UPDATE outbox SET sent=0,status='pending' WHERE id=?").run(originalId); }
        finally { replay.close(); }
        assert.equal(await local.flushOutbox(),1);
        const single=await cp.query('SELECT count(*)::int AS n FROM events WHERE id=$1',[originalId]);
        assert.equal(single.rows[0].n,1,'Retries may not duplicate central events');

        const second=await createSubject(tenantHttp.url);
        const next=await tp.query(
            'SELECT id FROM local_events WHERE tenant_code=$1 AND aggregate_id=$2',
            [tenantId,String(second.id)]);
        assert.equal(next.rowCount,1);
        const secondId=String(next.rows[0].id);
        assert.equal(await local.pollLocalEvents(),1);
        delete process.env.CENTRAL_AGENT_API_KEY;
        assert.equal(await local.flushOutbox(),0);
        const pending=new Database(path.join(temp,'data/outbox.db'),{readonly:true});
        try {
            const row=pending.prepare('SELECT sent,retry_count FROM outbox WHERE id=?')
                .get(secondId) as {sent:number;retry_count:number};
            assert.equal(row.sent,0,'Failed central call must not lose event');
            assert.equal(row.retry_count,1);
        } finally {pending.close();}
        assert.equal((await cp.query('SELECT id FROM events WHERE id=$1',[secondId])).rowCount,0);
        process.env.CENTRAL_AGENT_API_KEY=centralKey;
        assert.equal(await local.flushOutbox(),1);
        assert.equal((await cp.query('SELECT id FROM events WHERE id=$1',[secondId])).rowCount,1);

        await systemApi.sendHeartbeat({tenantId,sentAt:1});
        const heartbeat=await cp.query('SELECT "lastHeartbeat" FROM tenants WHERE id=$1',[tenantId]);
        assert.ok(heartbeat.rows[0].lastHeartbeat);
        assert.ok(Math.abs(Date.now()-new Date(heartbeat.rows[0].lastHeartbeat).getTime())<60000);
        assert.equal(await local.pollLocalEvents(),0);
        assert.equal(await local.flushOutbox(),0);
        console.log('PASS E2E: subject -> tenant PG -> SQLite -> central PG, idempotence/recovery/heartbeat');
    } finally {
        local?.close();
        process.chdir(originalCwd);
        await Promise.allSettled([stop(tenantServer),stop(centralServer),
            centralDb.closeSystemPool(),tenantDb.closeAllTenantPools()]);
        rmSync(temp,{recursive:true,force:true});
        for(const [key,value] of Object.entries(previous)){
            if(value===undefined)delete process.env[key];
            else process.env[key]=value;
        }
    }
});
