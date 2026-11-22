import { systemApi } from './system-api/client.js';
import { config } from './config/tenant-agent.config.js';
import { LocalEventsSyncService } from './services/sync-local-events.service.js';
import fs from 'fs-extra';
import path from 'node:path';

function validateEndpoint(value: string, label: string) {
    let url: URL;
    try { url = new URL(value); }
    catch { throw new Error(label + ' must be a valid HTTP(S) URL'); }
    if (url.username || url.password ||
        !['https:', 'http:'].includes(url.protocol) ||
        (url.protocol === 'http:' &&
         !['localhost','127.0.0.1','[::1]','::1'].includes(url.hostname))) {
        throw new Error(label + ' requires HTTPS outside localhost, without embedded credentials');
    }
}

export async function startAgent(): Promise<void> {
    if (config.autoCleanDb) {
        throw new Error('Automatic outbox deletion is disabled');
    }
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(config.tenantId)) {
        throw new Error('Valid TENANT_ID is required');
    }
    if (!process.env.SYSTEM_API_URL || !process.env.TENANT_API_URL) {
        throw new Error('SYSTEM_API_URL and TENANT_API_URL must be configured');
    }
    validateEndpoint(process.env.SYSTEM_API_URL,'SYSTEM_API_URL');
    validateEndpoint(process.env.TENANT_API_URL,'TENANT_API_URL');
    for (const name of ['TENANT_AGENT_API_KEY','CENTRAL_AGENT_API_KEY']) {
        const value=process.env[name];
        if (!value || Buffer.byteLength(value,'utf8')<32) {
            throw new Error(name + ' must be configured');
        }
    }

    // One canonical agent loop owns polling + durable SQLite + central delivery.
    // Do not launch the separate legacy SyncService loop in parallel.
    const syncService=new LocalEventsSyncService(config.tenantId,config.tenantServiceUrl);
    syncService.start(config.syncIntervalMs);

    const heartbeat = async () => {
        try {
            await systemApi.sendHeartbeat({tenantId:config.tenantId,sentAt:Date.now()});
        } catch {
            console.error('[Heartbeat] Central heartbeat unavailable; local events remain queued');
        }
    };
    void heartbeat();
    const heartbeatTimer=setInterval(()=>void heartbeat(),config.heartbeatIntervalMs);

    let backupJob:Promise<boolean> | null=null;
    const backupOutbox=():Promise<boolean> => {
        if (backupJob) return backupJob;
        backupJob=(async()=>{
            try {
                const directory=path.resolve('backups');
                await fs.ensureDir(directory);
                const stamp=new Date().toISOString().replace(/[:.]/g,'-');
                await syncService.backupTo(path.join(directory,'outbox-backup-'+stamp+'.db'));
                return true;
            } catch {
                console.error('[Backup] SQLite snapshot failed');
                return false;
            }
        })().finally(()=>{backupJob=null;});
        return backupJob;
    };
    const backupTimer=setInterval(()=>void backupOutbox(),60*60*1000);
    const cleanupTimer=setInterval(()=>{
        try {syncService.cleanSentEvents(config.eventRetentionMs);}
        catch {console.error('[Cleanup] Failed to prune acknowledged events');}
    },60*60*1000);

    // Migrations are never applied automatically during Windows service startup.
    console.log('[Tenant-Agent] Poll, durable outbox, central delivery and heartbeat active');
    let shuttingDown=false;
    const shutdown=async()=>{
        if (shuttingDown) return;
        shuttingDown=true;
        clearInterval(heartbeatTimer);
        clearInterval(backupTimer);
        clearInterval(cleanupTimer);
        let status=0;
        try {
            await syncService.stop(); // wait for any active poll/flush before closing SQLite
            if (!(await backupOutbox())) status=1;
            syncService.close();
        } catch {
            console.error('[Tenant-Agent] Graceful shutdown failed');
            status=1;
        }
        process.exit(status);
    };
    process.once('SIGTERM',()=>void shutdown());
    process.once('SIGINT',()=>void shutdown());
}
