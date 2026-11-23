import { systemApi } from './system-api/client.js';
import { config } from './config/tenant-agent.config.js';
import { LocalEventsSyncService } from './services/sync-local-events.service.js';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { prepareAgentBackupDirectory, verifyAgentBackupDirectory } from './services/backup-storage-policy.js';

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

    // Before beginning delivery, require a non-repository, pre-provisioned
    // backup directory on production. Do not attempt to set NTFS ACLs here;
    // their independent review remains an explicit release gate.
    const backupDirectory = prepareAgentBackupDirectory(
        process.env.TENANT_AGENT_BACKUP_DIR, process.env.NODE_ENV
    );

    // One canonical agent loop owns polling + durable SQLite + central delivery.
    // Do not launch the separate legacy SyncService loop in parallel.
    const syncService=new LocalEventsSyncService(config.tenantId,config.tenantServiceUrl);

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
                // Detect a directory redirected into the app via a symlink
                // between startup and a periodic/shutdown backup.
                const directory=verifyAgentBackupDirectory(backupDirectory,process.env.NODE_ENV);
                const stamp=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID();
                await syncService.backupTo(path.join(directory,'outbox-backup-'+stamp+'.db'));
                return true;
            } catch {
                console.error('[Backup] SQLite snapshot failed');
                return false;
            }
        })().finally(()=>{backupJob=null;});
        return backupJob;
    };
    // A writable, independently verified recovery checkpoint must exist
    // before the agent can acknowledge source events. Fail closed without
    // delivering or marking events if startup backup creation is unavailable.
    if (!(await backupOutbox())) {
        syncService.close();
        throw new Error('Verified startup SQLite snapshot is unavailable');
    }
    syncService.start(config.syncIntervalMs);
    const backupTimer=setInterval(()=>void backupOutbox(),60*60*1000);
    // Do NOT automatically delete acknowledged events on their creation date:
    // a recently delivered old event can be immediately deleted, defeating
    // disaster recovery. Retention/confirmed-delivery/purge policy is not yet
    // accepted; preserve all event evidence until an owner-approved migration.
    // cleanSentEvents() remains a manual capability, never auto-scheduled.

    // Migrations are never applied automatically during Windows service startup.
    console.log('[Tenant-Agent] Poll, durable outbox, central delivery and heartbeat active');
    let shuttingDown=false;
    const shutdown=async()=>{
        if (shuttingDown) return;
        shuttingDown=true;
        clearInterval(heartbeatTimer);
        clearInterval(backupTimer);
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
