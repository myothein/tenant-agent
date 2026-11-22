import test from 'node:test';
import assert from 'node:assert/strict';
import { SystemApiClient, CentralEventEnvelope } from '../system-api/client.js';

const event: CentralEventEnvelope = {
    id: '123e4567-e89b-42d3-a456-426614174002', tenantId:'university-ci-a',
    agentId:'tenant-agent', event_type:'subject.created',
    aggregate_type:'Subject', aggregate_id:'101',
    payload:{name:'Physics'}, createdAt:'2026-01-01T12:34:57.000Z',
    occurredAt:'2026-01-01T12:34:56.123Z'
};
const key='ci-only-tenant-a-credential-longer-than-32-bytes';

async function fakeSend(status: number, responseBody: object, token?: string) {
    const previousFetch=globalThis.fetch;
    const priorKey=process.env.CENTRAL_AGENT_API_KEY;
    const priorUrl=process.env.SYSTEM_API_URL;
    const priorTenant=process.env.TENANT_ID;
    const captured: {url?:string; authorization?:string; body?:unknown} = {};
    process.env.CENTRAL_AGENT_API_KEY=token ?? key;
    process.env.SYSTEM_API_URL='http://127.0.0.1:5000';
    process.env.TENANT_ID='university-ci-a';
    globalThis.fetch=async (url,opts)=>{
        captured.url=String(url);
        captured.authorization=new Headers(opts?.headers).get('authorization') ?? undefined;
        captured.body=opts?.body ? JSON.parse(String(opts.body)) : undefined;
        return new Response(JSON.stringify(responseBody),{
            status,headers:{'content-type':'application/json'}
        });
    };
    try {
        const client=new SystemApiClient();
        await client.sendEvent(event);
        return captured;
    } finally {
        globalThis.fetch=previousFetch;
        if(priorKey===undefined)delete process.env.CENTRAL_AGENT_API_KEY;
        else process.env.CENTRAL_AGENT_API_KEY=priorKey;
        if(priorUrl===undefined)delete process.env.SYSTEM_API_URL;
        else process.env.SYSTEM_API_URL=priorUrl;
        if(priorTenant===undefined)delete process.env.TENANT_ID;
        else process.env.TENANT_ID=priorTenant;
    }
}

test('Central v1 contract posts original event id and aggregate fields with scoped bearer token', async () => {
    const sent=await fakeSend(201,{success:true,status:'accepted',eventId:event.id});
    assert.equal(sent.url,'http://127.0.0.1:5000/api/v1/events');
    assert.equal(sent.authorization,'Bearer '+key);
    assert.deepEqual(sent.body,event);
});
test('Central duplicate response is a valid durable acknowledgment', async () => {
    await fakeSend(200,{success:true,status:'duplicate',eventId:event.id});
});
test('wrong event ID in 201 response must never be acknowledged', async () => {
    await assert.rejects(()=>fakeSend(201,{success:true,status:'accepted',eventId:'wrong'}),/did not match event identity/);
});
test('Central 501 unsupported ingestion must remain pending in SQLite', async () => {
    await assert.rejects(()=>fakeSend(501,{success:false,code:'NOT_IMPLEMENTED'}),/HTTP 501/);
});
test('Central 202 is not a durable event acknowledgment', async () => {
    await assert.rejects(()=>fakeSend(202,{success:true,status:'accepted',eventId:event.id}),/durable acknowledgment/);
});
test('Missing central scoped key fails closed before any event delivery', async () => {
    const priorKey=process.env.CENTRAL_AGENT_API_KEY;
    const priorUrl=process.env.SYSTEM_API_URL;
    const priorTenant=process.env.TENANT_ID;
    const priorFetch=globalThis.fetch;
    let called=false;
    process.env.SYSTEM_API_URL='http://127.0.0.1:5000';
    process.env.TENANT_ID='university-ci-a';
    delete process.env.CENTRAL_AGENT_API_KEY;
    globalThis.fetch=async()=>{called=true;throw Error('Should not call fetch');};
    try {await assert.rejects(()=>new SystemApiClient().sendEvent(event),/CENTRAL_AGENT_API_KEY must be configured/);
        assert.equal(called,false);}
    finally {
        globalThis.fetch=priorFetch;
        if(priorKey===undefined)delete process.env.CENTRAL_AGENT_API_KEY;
        else process.env.CENTRAL_AGENT_API_KEY=priorKey;
        if(priorUrl===undefined)delete process.env.SYSTEM_API_URL;
        else process.env.SYSTEM_API_URL=priorUrl;
        if(priorTenant===undefined)delete process.env.TENANT_ID;
        else process.env.TENANT_ID=priorTenant;
    }
});
