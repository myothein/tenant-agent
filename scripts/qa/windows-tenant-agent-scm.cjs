#!/usr/bin/env node
'use strict';
// Only a disposable GitHub-hosted Windows runner. No user machine/service is targeted.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const child = require('node:child_process');
const http = require('node:http');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

assert(process.platform === 'win32' && process.env.CI === 'true' &&
  process.env.RUNNER_OS === 'Windows' && process.env.RUNNER_ENVIRONMENT === 'github-hosted',
  'Real service QA must run only on disposable GitHub-hosted Windows runners');
assert(process.env.GITHUB_HEAD_REF === 'hardening/release-security-baseline-20261122',
  'Only the approved draft PR can run Windows service QA');
assert(/^[0-9]{5,16}$/.test(process.env.GITHUB_RUN_ID || ''), 'Missing CI run id');

const runId = process.env.GITHUB_RUN_ID;
const name = 'GTSPTenantAgentQA_' + runId;
const dir = path.join(process.env.ProgramData || 'C:\\ProgramData', name);
const dbPath = path.join(dir, 'data', 'outbox.db');
const snapshot = path.join(dir, 'qa-snapshot.db');
const restored = path.join(dir, 'qa-restored.db');
const agentEntry = path.resolve('dist/index.js');
const tokenTenant = 'local-qa-agent-token-longer-than-32-characters';
const tokenCentral = 'central-qa-agent-token-longer-than-32-characters';
const tenant = 'tenant_ci_qa';
const eventId = crypto.randomUUID();
const now = new Date().toISOString();
const event = {
  id:eventId, tenant_code:tenant, agent_id:'tenant-service',
  aggregate_type:'Subject',aggregate_id:'101',event_type:'subject.created',
  payload:{id:101,name:'Synthetic local Windows QA subject'},
  created_at:now, occurred_at:now, retry_count:0, event_version:1
};
const nssm = process.env.NSSM_EXE;
let serviceCreated = false, dirCreated = false;
let tenantApi, centralApi;
let markedSource = false, centralAvailable = false, duplicateReceipts = 0;
const accepted = new Map();
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));

function command(exe,args,timeout=30000) {
  const result = child.spawnSync(exe,args,{
    encoding:'utf8',windowsHide:true,timeout,stdio:['ignore','pipe','pipe']
  });
  if (result.error || result.status!==0) {
    throw Error('Windows QA command '+path.basename(exe)+' failed with exit '+
      (result.status ?? (result.error && result.error.code) ?? '?'));
  }
  return result.stdout;
}
function state() {
  const result = child.spawnSync('sc.exe',['query',name],{
    encoding:'utf8',windowsHide:true,timeout:12000
  });
  if (result.status!==0) return null;
  const match = /STATE\s*:\s*\d+\s+([A-Z_]+)/.exec(result.stdout);
  if (!match) throw Error('Windows SCM returned an unknown state');
  return match[1];
}
async function waitState(expected,ms=30000) {
  const until=Date.now()+ms;
  while (Date.now()<until) {
    if(state()===expected) return;
    await delay(250);
  }
  throw Error('QA service did not reach state '+String(expected));
}
async function waitFor(fn,label,ms=20000) {
  const until=Date.now()+ms;
  while (Date.now()<until) {
    try { if (await fn()) return; } catch(e) {}
    await delay(250);
  }
  throw Error('Timed out verifying '+label);
}
function json(res,status,value) {
  res.writeHead(status,{'content-type':'application/json'});
  res.end(JSON.stringify(value));
}
async function body(req) {
  let data='';
  for await (const chunk of req) {
    data+=chunk.toString('utf8');
    if(data.length>65536) throw Error('Oversize CI request');
  }
  return data?JSON.parse(data):{};
}
async function bindServer(server) {
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  const a=server.address();
  assert(a && typeof a!=='string','No loopback server port');
  return 'http://127.0.0.1:'+a.port;
}
function outbox() {
  if (!fs.existsSync(dbPath)) return null;
  const db=new Database(dbPath,{readonly:true,fileMustExist:true});
  try {
    return db.prepare('SELECT id,tenantId,sent,status,retry_count FROM outbox WHERE id=?')
      .get(eventId) || null;
  } finally {db.close();}
}
async function snapshotAndRestore(expectedSent) {
  const db = new Database(dbPath,{readonly:true,fileMustExist:true});
  try {await db.backup(snapshot);} finally{db.close();}
  fs.copyFileSync(snapshot,restored);
  const restoredDb=new Database(restored,{readonly:true,fileMustExist:true});
  try {
    const integrity=restoredDb.pragma('integrity_check',{simple:true});
    assert.equal(integrity,'ok','Backup restore SQLite integrity check failed');
    const row=restoredDb.prepare('SELECT id,tenantId,sent FROM outbox WHERE id=?').get(eventId);
    assert.equal(row?.id,eventId,'Restored event UUID mismatch');
    assert.equal(row?.tenantId,tenant);
    assert.equal(row?.sent,expectedSent,'Restored sent flag mismatch');
    return crypto.createHash('sha256').update(fs.readFileSync(snapshot)).digest('hex');
  } finally {restoredDb.close();}
}
async function main() {
  assert(nssm && fs.existsSync(nssm),'Pinned QA NSSM binary missing');
  assert(fs.existsSync(agentEntry),'Compiled tenant-agent entrypoint missing');
  assert(state()===null,'Unique QA service already exists; refusing modification');
  assert(!fs.existsSync(dir),'Unique QA workspace already exists; refusing modification');
  fs.mkdirSync(dir,{recursive:false});
  dirCreated=true;

  tenantApi=http.createServer(async(req,res)=>{
    try {
      if(req.headers.authorization!=='Bearer '+tokenTenant) {
        json(res,401,{success:false});return;
      }
      if(req.method==='GET' && req.url==='/local-events/pending') {
        json(res,200,{success:true,data:markedSource?[]:[event]});return;
      }
      if(req.method==='PATCH' && req.url==='/local-events/'+eventId+'/mark-sent') {
        markedSource=true;json(res,200,{success:true});return;
      }
      json(res,404,{success:false});
    }catch{json(res,500,{success:false});}
  });
  centralApi=http.createServer(async(req,res)=>{
    try {
      if(req.headers.authorization!=='Bearer '+tokenCentral){
        json(res,401,{success:false});return;
      }
      if(req.method==='POST' && req.url==='/api/v1/heartbeats') {
        const data=await body(req);
        if(data.tenantId!==tenant){json(res,403,{success:false});return;}
        json(res,200,{success:true,status:'recorded',tenantId:tenant});return;
      }
      if(req.method==='POST' && req.url==='/api/v1/events') {
        const data=await body(req);
        if(data.id!==eventId || data.tenantId!==tenant) {
          json(res,400,{success:false});return;
        }
        if(!centralAvailable){json(res,503,{success:false,code:'CI_OFFLINE'});return;}
        if(accepted.has(data.id)){
          duplicateReceipts++;
          json(res,200,{success:true,status:'duplicate',eventId:data.id});return;
        }
        accepted.set(data.id,data);
        json(res,201,{success:true,status:'accepted',eventId:data.id});return;
      }
      json(res,404,{success:false});
    }catch{json(res,500,{success:false});}
  });
  const tenantUrl=await bindServer(tenantApi);
  const centralUrl=await bindServer(centralApi);

  // The process is the actual compiled tenant-agent, not a synthetic service worker.
  // All values are CI-only fixtures; only loopback HTTP is permitted.
  command(nssm,['install',name,process.execPath,agentEntry]);
  serviceCreated=true;
  command(nssm,['set',name,'AppDirectory',dir]);
  command(nssm,['set',name,'Start','SERVICE_DEMAND_START']);
  command(nssm,['set',name,'AppExit','Default','Exit']);
  command(nssm,['set',name,'AppEnvironmentExtra',
    'TENANT_ID='+tenant,
    'TENANT_API_URL='+tenantUrl,
    'SYSTEM_API_URL='+centralUrl,
    'TENANT_AGENT_API_KEY='+tokenTenant,
    'CENTRAL_AGENT_API_KEY='+tokenCentral,
    'TENANT_SYNC_INTERVAL_MS=1000',
    'TENANT_HEARTBEAT_INTERVAL_MS=1000'
  ]);

  command('sc.exe',['start',name]);
  await waitState('RUNNING');
  await waitFor(()=>markedSource && outbox()?.sent===0 && outbox()?.retry_count>=1,
    'offline failure leaves same original event in SQLite',25000);
  assert.equal(accepted.size,0,'Offline Central must not have accepted event');

  // Windows service restart and independent SQLite restore of the failed event.
  command('sc.exe',['stop',name]);
  await waitState('STOPPED');
  assert.equal(outbox()?.sent,0);
  const checksum=await snapshotAndRestore(0);
  assert(/^[a-f0-9]{64}$/.test(checksum));
  centralAvailable=true;
  command('sc.exe',['start',name]);
  await waitState('RUNNING');
  await waitFor(()=>accepted.size===1 && outbox()?.sent===1,
    'post-restart retry and central durable acknowledgment',25000);
  assert.equal(accepted.get(eventId)?.id,eventId);
  assert.equal(accepted.get(eventId)?.payload?.id,101);
  assert.equal(accepted.size,1);

  // Crash window after central acceptance but before SQLite sent commit: replay.
  command('sc.exe',['stop',name]);
  await waitState('STOPPED');
  {
    const db=new Database(dbPath);
    try {db.prepare("UPDATE outbox SET sent=0,status='pending' WHERE id=?").run(eventId);}
    finally {db.close();}
  }
  command('sc.exe',['start',name]);
  await waitState('RUNNING');
  await waitFor(()=>duplicateReceipts>=1 && outbox()?.sent===1,
    'duplicate replay acknowledged without central duplication',25000);
  assert.equal(accepted.size,1,'Central duplicate event ID must not multiply records');
  console.log('PASS ACTUAL TENANT-AGENT WINDOWS SCM: offline queue, service restart, verified SQLite restore, central retry and duplicate replay');
}
async function cleanup() {
  let fail=false;
  if(serviceCreated){
    try {
      if(state()!==null && state()!=='STOPPED'){
        command('sc.exe',['stop',name]); await waitState('STOPPED');
      }
      if(state()!==null) {
        command(nssm,['remove',name,'confirm']); await waitState(null);
      }
    } catch {
      fail=true;
      console.error('QA service cleanup failed; service '+name+' requires inspection');
    }
  }
  for(const server of [tenantApi,centralApi]){
    if(server?.listening) {
      try {await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
      catch {fail=true;}
    }
  }
  if(dirCreated){
    if(state()===null) {
      try {fs.rmSync(dir,{recursive:true,force:true});}
      catch{fail=true;console.error('QA workspace cleanup failed');}
    } else { fail=true; }
  }
  if(fail) throw Error('Hosted Windows QA cleanup incomplete');
}
(async()=>{
  let failure;
  try { await main(); }
  catch(error){failure=error;console.error('Tenant-Agent Windows SCM QA failed: '+error.message);}
  try {await cleanup();}catch(error){failure=failure||error;}
  if(failure) process.exitCode=1;
})().catch(()=>{process.exitCode=1;});
