import { systemApi } from "./system-api/client.js";
import { config } from "./config/tenant-agent.config.js";
import { SyncService } from "./services/sync.service.js";
import fs from "fs-extra";
import path from "path";


export async function startAgent() {
    console.log("Tenant Agent starting...");

    if (config.autoCleanDb) {
        throw new Error('Automatic outbox deletion is disabled; use verified backup and approved maintenance');
    }
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(config.tenantId)) {
        throw new Error('Valid TENANT_ID is required to start the agent');
    }
    if (!process.env.SYSTEM_API_URL || !process.env.TENANT_API_URL) {
        throw new Error('SYSTEM_API_URL and TENANT_API_URL must be explicitly configured');
    }
    const syncService = new SyncService();

    // Heartbeat
    const sendHeartbeat = async () => {
        try {
            await systemApi.sendHeartbeat({ tenantId: config.tenantId, sentAt: Date.now() });
            console.log(`[Heartbeat] Success`);
        } catch (err: any) {
            console.error(`[Heartbeat] Failed: ${err.message}`);
        }
    };
    sendHeartbeat();
    const heartbeatInterval = setInterval(sendHeartbeat, config.heartbeatIntervalMs);

    // Outbox sync
    syncService.start(config.syncIntervalMs);

    // Automatic backup
    const backupOutbox = async () => {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const backupDir = path.resolve("backups");
            await fs.ensureDir(backupDir);

            const backupFile = path.join(backupDir, `outbox-backup-${timestamp}.db`);
            await syncService.backupTo(backupFile);

            console.log(`[Backup] Created: ${backupFile}`);
        } catch (err: unknown) {
            console.error("[Backup] Failed:", err instanceof Error ? err.message : err);
        }
    };
    const backupInterval = setInterval(backupOutbox, 1000 * 60 * 60);

    // Cleanup old events
    const cleanupInterval = setInterval(() => syncService.cleanOldEvents(config.eventRetentionMs), 1000 * 60 * 60);

    // Never run database migrations implicitly from a long-running Windows agent.
    // db-helper migrations require an explicit, backed-up operator-controlled step.
    console.log('[Migrate] Automatic startup migrations disabled; run verified migrations separately.');

    // Graceful shutdown
    const shutdown = () => {
        console.log("Tenant Agent stopping...");
        clearInterval(heartbeatInterval);
        clearInterval(backupInterval);
        clearInterval(cleanupInterval);
        syncService.close();
        process.exit(0);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);

    console.log("Tenant Agent is running.");
}
