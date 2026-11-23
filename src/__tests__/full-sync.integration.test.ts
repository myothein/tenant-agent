import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID, generateKeyPairSync, sign as rsaSign, type KeyObject } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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

const execFileAsync = promisify(execFile);
const cliEntry = path.join(root,'integration/central-cli/dist/index.js');

function signOperatorJwt(privateKey:KeyObject, issuer:string, audience:string, roles:string[]):string {
    const encodedHeader=Buffer.from(JSON.stringify({
        alg:'RS256',typ:'JWT',kid:'integrated-cli-ci'
    })).toString('base64url');
    const now=Math.floor(Date.now()/1000);
    const encodedPayload=Buffer.from(JSON.stringify({
        iss:issuer,aud:audience,sub:'synthetic-central-operator',
        iat:now,exp:now+300,realm_access:{roles}
    })).toString('base64url');
    const unsigned=encodedHeader+'.'+encodedPayload;
    return unsigned+'.'+rsaSign('RSA-SHA256',Buffer.from(unsigned),privateKey)
        .toString('base64url');
}

async function runCentralCli(baseUrl:string, token:string) {
    return execFileAsync(process.execPath,[cliEntry,'tenant','list'],{
        cwd:root,
        timeout:15_000,
        env:{
            ...process.env,
            CENTRAL_API_URL:baseUrl+'/api/v1',
            CENTRAL_AUTH_MODE:'oidc',
            CENTRAL_OIDC_ACCESS_TOKEN:token,
            CENTRAL_API_KEY:'',
            CENTRAL_ALLOW_DEV_API_KEY:'false'
        }
    });
}


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
        TENANT_API_URL:process.env.TENANT_API_URL,CENTRAL_AGENT_API_KEY:process.env.CENTRAL_AGENT_API_KEY,
        CENTRAL_OIDC_ISSUER:process.env.CENTRAL_OIDC_ISSUER,
        CENTRAL_OIDC_JWKS_URL:process.env.CENTRAL_OIDC_JWKS_URL,
        CENTRAL_OIDC_AUDIENCE:process.env.CENTRAL_OIDC_AUDIENCE,
        CENTRAL_OIDC_REQUIRED_ROLE:process.env.CENTRAL_OIDC_REQUIRED_ROLE,
        CENTRAL_ADMIN_AUTH_MODE:process.env.CENTRAL_ADMIN_AUTH_MODE,
        CENTRAL_ADMIN_API_KEY:process.env.CENTRAL_ADMIN_API_KEY};
    let local:LocalEventsSyncService | undefined;
    let centralServer:Server | undefined;
    let tenantServer:Server | undefined;
    let jwksServer:Server | undefined;
    try {
        process.env.TENANT_ID=tenantId;
        process.env.CENTRAL_AGENT_API_KEY=centralKey;

        // Ephemeral mock identity issuer: actual Central JWT verification is
        // exercised against the real Central Service, not bypassed in mocks.
        const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
        const publicJwk=publicKey.export({format:'jwk'});
        jwksServer=createServer((req,res)=>{
            if(req.url!=='/realms/gtsp/protocol/openid-connect/certs'){
                res.writeHead(404).end();
                return;
            }
            res.setHeader('content-type','application/json');
            res.end(JSON.stringify({keys:[{
                ...publicJwk,kid:'integrated-cli-ci',alg:'RS256',use:'sig'
            }]}));
        });
        jwksServer.listen(0,'127.0.0.1');
        await once(jwksServer,'listening');
        const identityAddress=jwksServer.address();
        if(!identityAddress || typeof identityAddress==='string'){
            throw Error('Ephemeral OIDC issuer did not bind');
        }
        const issuer='http://127.0.0.1:'+identityAddress.port+'/realms/gtsp';
        const audience='gtsp-central-integration-ci';
        process.env.CENTRAL_ADMIN_AUTH_MODE='oidc';
        process.env.CENTRAL_OIDC_ISSUER=issuer;
        process.env.CENTRAL_OIDC_JWKS_URL=issuer+'/protocol/openid-connect/certs';
        process.env.CENTRAL_OIDC_AUDIENCE=audience;
        process.env.CENTRAL_OIDC_REQUIRED_ROLE='CENTRAL_ADMIN';
        delete process.env.CENTRAL_ADMIN_API_KEY;
        const validOperatorToken=signOperatorJwt(privateKey,issuer,audience,['CENTRAL_ADMIN']);
        const forbiddenOperatorToken=signOperatorJwt(privateKey,issuer,audience,['TENANT_ADMIN']);

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
        // A real Central CLI subprocess should administer the same synthetic
        // tenant created for this event pipeline, with OIDC/JWKS verified by
        // Central Service. No legacy Central Admin API key is used.
        const listed=await runCentralCli(centralHttp.url,validOperatorToken);
        assert.match(listed.stdout,/tenant_ci_qa/,
            'Central CLI must list the tenant persisted in this PostgreSQL DB');
        assert.doesNotMatch(listed.stdout+listed.stderr,/eyJ[A-Za-z0-9_-]{10,}/,
            'Central operator JWT must not appear in normal CLI output');
        await assert.rejects(
            ()=>runCentralCli(centralHttp.url,forbiddenOperatorToken),
            (error:unknown)=>{
                const e=error as Error & {code?:number;stderr?:string;stdout?:string};
                assert.equal(e.code,1,'Wrong realm role must fail the CLI process');
                assert.match(e.stderr||'',/HTTP 403/);
                assert.doesNotMatch((e.stdout||'')+(e.stderr||''),/eyJ[A-Za-z0-9_-]{10,}/);
                return true;
            }
        );

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

        // Negative authorization contract against the ACTUAL pinned services:
        // A Central tenant-specific machine key must not export another tenant's
        // event or grant access to tenant-service administrator actions.
        const foreignEventId=randomUUID();
        const foreignResponse=await fetch(centralHttp.url+'/api/v1/events',{
            method:'POST',
            headers:{authorization:'Bearer '+centralKey,'content-type':'application/json'},
            body:JSON.stringify({
                id:foreignEventId,tenantId:'another_university',
                agentId:'tenant-agent',event_type:'subject.created',
                aggregate_type:'Subject',aggregate_id:'991',
                payload:{id:991,name:'Foreign Synthetic Subject'},
                occurredAt:'2026-01-01T00:00:00.000Z'
            })
        });
        assert.equal(foreignResponse.status,401,
            'A tenant A machine credential may not write Central events for tenant B');
        assert.equal((await cp.query('SELECT id FROM events WHERE id=$1',[foreignEventId])).rowCount,0);

        const tenantAdminDenied=await fetch(tenantHttp.url+'/subjects',{
            method:'POST',
            headers:{authorization:'Bearer '+centralKey,'content-type':'application/json'},
            body:JSON.stringify({name:'Unauthorized Synthetic Subject'})
        });
        assert.equal(tenantAdminDenied.status,401,
            'Central agent credential cannot become tenant administrator');

        const tenantHeaderDenied=await fetch(tenantHttp.url+'/subjects',{
            method:'POST',
            headers:{
                authorization:'Bearer '+adminKey,'content-type':'application/json',
                'x-tenant-id':'another_university'
            },
            body:JSON.stringify({name:'Injected Synthetic Subject'})
        });
        assert.equal(tenantHeaderDenied.status,403,
            'Tenant-service must reject client-provided tenant switching headers');

        // A malicious replay using an existing UUID but mutated contents may not
        // be acknowledged as a benign duplicate; the original persisted row
        // must remain intact and should not be overwritten.
        const payloadBefore=centralRow.rows[0].payload;
        const collisionResponse=await fetch(centralHttp.url+'/api/v1/events',{
            method:'POST',
            headers:{authorization:'Bearer '+centralKey,'content-type':'application/json'},
            body:JSON.stringify({
                id:originalId,tenantId,agentId:'tenant-service',
                event_type:'subject.created',aggregate_type:'Subject',
                aggregate_id:String(first.id),
                payload:{id:first.id,name:'Malicious changed payload in replay'},
                occurredAt:'2026-01-01T00:00:00.000Z'
            })
        });
        assert.equal(collisionResponse.status,409,
            'Same UUID with altered payload must not be treated as duplicate success');
        const unchanged=await cp.query('SELECT payload FROM events WHERE id=$1',[originalId]);
        assert.equal(unchanged.rowCount,1);
        assert.deepEqual(unchanged.rows[0].payload,payloadBefore,
            'Central must never overwrite original event on collision');

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
        await Promise.allSettled([stop(tenantServer),stop(centralServer),stop(jwksServer),
            centralDb.closeSystemPool(),tenantDb.closeAllTenantPools()]);
        rmSync(temp,{recursive:true,force:true});
        for(const [key,value] of Object.entries(previous)){
            if(value===undefined)delete process.env[key];
            else process.env[key]=value;
        }
    }
});
