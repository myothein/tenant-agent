#!/usr/bin/env node
'use strict';
// User-level process integration only; does NOT install or modify Windows Services.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const http=require('node:http');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const Database=require('better-sqlite3');
assert(process.platform==='win32' && process.env.CI==='true' && process.env.RUNNER_OS==='Windows',
  'This QA is restricted to disposable GitHub Windows CI');
const tenant='tenant_ci_qa';
const tenantKey='ci-only-tenant-agent-local-token-longer-than-32';
const centralKey='ci-only-central-agent-token-longer-than-32';
const eventId=crypto.randomUUID(), now=new Date().toISOString();
const source={
  id:eventId, tenant_code:tenant, agent_id:'tenant-service',aggregate_type:'Subject',
  aggregate_id:'101',event_type:'subject.created',
  payload:{id:101,name:'Synthetic Windows CI subject'},
  created_at:now,occurred_at:now,retry_count:0,event_version:1
};
const root=fs.mkdtempSync(path.join(os.tmpdir(),'tenant-agent-process-qa-'));
const dbPath=path.join(root,'data','outbox.db');
let sourceMarked=false,centralOnline=false,duplicate=0;
const centralEvents=new Map();
let tenantServer,centralServer,agent;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function listen(server) {
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return 'http://127.0.0.1:'+server.address().port;
}
function reply(res,status,body) {
  res.writeHead(status,{'content-type':'application/json'});
  res.end(JSON.stringify(body));
}
async function body(req) {
  let text='';
  for await(const chunk of req) {
    text+=chunk.toString('utf8');
    if(text.length>65536) throw Error('Invalid oversized QA payload');
  }
  return JSON.parse(text||'{}');
}
function readEvent() {
  if(!fs.existsSync(dbPath)) return null;
  const db=new Database(dbPath,{readonly:true});
  try {return db.prepare('SELECT id,tenantId,sent,status,retry_count FROM outbox WHERE id=?').get(eventId)||null;}
  finally{db.close();}
}
async function until(fn,message,timeout=20000) {
  const end=Date.now()+timeout;
  while(Date.now()<end) {
    try{if(await fn())return;}catch{}
    await delay(250);
  }
  throw Error('Windows process QA timed out: '+message);
}
async function start(urlTenant,urlCentral) {
  assert(!agent,'Duplicate agent process is not permitted');
  agent=spawn(process.execPath,[path.resolve('dist/index.js')],{
    cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],
    env:{
      ...process.env,NODE_ENV:'test',TENANT_ID:tenant,TENANT_API_URL:urlTenant,SYSTEM_API_URL:urlCentral,
      TENANT_AGENT_API_KEY:tenantKey,CENTRAL_AGENT_API_KEY:centralKey,
      TENANT_SYNC_INTERVAL_MS:'1000',TENANT_HEARTBEAT_INTERVAL_MS:'1000'
    }
  });
  const running=agent;
  const outputs=[];
  for(const channel of [running.stdout,running.stderr]) {
    channel.on('data',d=>{outputs.push(d.toString().slice(0,200));});
  }
  await delay(800);
  if(running.exitCode!==null)throw Error('Actual tenant-agent exited during startup');
  // Source events may only be acknowledged after a verified SQLite recovery
  // snapshot has been staged and published during service startup.
  const backupDirectory=path.join(root,'backups');
  await until(()=>fs.existsSync(backupDirectory) &&
    fs.readdirSync(backupDirectory).some(name=>/^outbox-backup-.*\.db$/.test(name)),
    'verified startup snapshot must exist before event transfer');
  const candidate=fs.readdirSync(backupDirectory)
    .filter(name=>/^outbox-backup-.*\.db$/.test(name)).sort().at(-1);
  const verified=new Database(path.join(backupDirectory,candidate),{readonly:true,fileMustExist:true});
  try{
    assert.equal(verified.pragma('integrity_check',{simple:true}),'ok');
    const schema=verified.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='outbox'").get();
    assert.equal(schema.n,1);
  }finally{verified.close();}
}
async function stop() {
  if(!agent)return;
  const running=agent;agent=undefined;
  if(running.exitCode!==null)return;
  await new Promise(resolve=>{
    const timer=setTimeout(()=>{running.kill();resolve();},5000);
    running.once('exit',()=>{clearTimeout(timer);resolve();});
    running.kill();
  });
}
async function verifyRestore(expectedSent) {
  const backup=path.join(root,'backup.db'), restored=path.join(root,'restore.db');
  const live=new Database(dbPath,{readonly:true});
  try{await live.backup(backup);}finally{live.close();}
  fs.copyFileSync(backup,restored);
  const restoredDb=new Database(restored,{readonly:true});
  try{
    assert.equal(restoredDb.pragma('integrity_check',{simple:true}),'ok');
    const row=restoredDb.prepare('SELECT id,tenantId,sent FROM outbox WHERE id=?').get(eventId);
    assert.equal(row?.id,eventId);
    assert.equal(row?.tenantId,tenant);
    assert.equal(row?.sent,expectedSent);
  }finally{restoredDb.close();}
}
async function main() {
  tenantServer=http.createServer(async(req,res)=>{
    try{
      if(req.headers.authorization!=='Bearer '+tenantKey){reply(res,401,{success:false});return;}
      if(req.method==='GET' && req.url==='/local-events/pending') {
        reply(res,200,{success:true,data:sourceMarked?[]:[source]});return;
      }
      if(req.method==='PATCH' && req.url==='/local-events/'+eventId+'/mark-sent') {
        sourceMarked=true;reply(res,200,{success:true});return;
      }
      reply(res,404,{success:false});
    }catch{reply(res,500,{success:false});}
  });
  centralServer=http.createServer(async(req,res)=>{
    try{
      if(req.headers.authorization!=='Bearer '+centralKey){reply(res,401,{success:false});return;}
      if(req.method==='POST' && req.url==='/api/v1/heartbeats') {
        reply(res,200,{success:true,status:'recorded'});return;
      }
      if(req.method==='POST' && req.url==='/api/v1/events') {
        const data=await body(req);
        if(data.id!==eventId||data.tenantId!==tenant){reply(res,400,{success:false});return;}
        if(!centralOnline){reply(res,503,{success:false});return;}
        if(centralEvents.has(data.id)){
          duplicate++;reply(res,200,{success:true,status:'duplicate',eventId});return;
        }
        centralEvents.set(data.id,data);
        reply(res,201,{success:true,status:'accepted',eventId});return;
      }
      reply(res,404,{success:false});
    }catch{reply(res,500,{success:false});}
  });
  const tenantUrl=await listen(tenantServer);
  const centralUrl=await listen(centralServer);
  await start(tenantUrl,centralUrl);
  await until(()=>sourceMarked && readEvent()?.sent===0 && readEvent()?.retry_count>=1,
    'durable SQLite pending event while Central offline');
  assert.equal(centralEvents.size,0);
  await stop();
  assert.equal(readEvent()?.sent,0);
  await verifyRestore(0);
  centralOnline=true;
  await start(tenantUrl,centralUrl);
  await until(()=>centralEvents.size===1 && readEvent()?.sent===1,
    'delivery after restarting actual agent process');
  assert.equal(centralEvents.get(eventId)?.payload?.id,101);
  await stop();
  // Simulate interruption after Central ACK but before SQLite sent marker.
  const db=new Database(dbPath);
  try{db.prepare("UPDATE outbox SET sent=0,status='pending' WHERE id=?").run(eventId);}
  finally{db.close();}
  await start(tenantUrl,centralUrl);
  await until(()=>duplicate>=1 && readEvent()?.sent===1,'idempotent replay after restart');
  assert.equal(centralEvents.size,1,'Central event must not duplicate');
  await stop();
  console.log('PASS actual Windows Node agent process: offline persistence, restart, SQLite restore and idempotent replay');
}
async function closeServer(server) {
  if(server?.listening)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
}
(async()=>{
  let error;
  try{await main();}catch(e){error=e;console.error('Windows tenant-agent process QA: '+e.message);}
  try{await stop();await closeServer(tenantServer);await closeServer(centralServer);}
  catch(e){error=error||e;}
  try{fs.rmSync(root,{recursive:true,force:true});}
  catch(e){error=error||e;}
  if(error)process.exitCode=1;
})().catch(()=>{process.exitCode=1;});
