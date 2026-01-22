import axios from "axios";
import { config } from "./config/tenant-agent.config.js";
import { SyncService } from "./services/sync.service.js";
import fs from "fs-extra";
import path from "path";
import { exec } from "child_process";
export async function startAgent() {
    console.log("Tenant Agent starting...");
    const syncService = new SyncService();
    const dbPath = path.resolve("data/outbox.db");
    // Auto-clean DB
    if (config.autoCleanDb) {
        try {
            syncService.close();
            await fs.remove(dbPath);
            await fs.ensureDir(path.dirname(dbPath));
            console.log("[AutoCleanDB] Outbox database cleaned.");
        }
        catch (err) {
            console.error("[AutoCleanDB] Failed:", err instanceof Error ? err.message : err);
        }
    }
    // Heartbeat
    const sendHeartbeat = async () => {
        try {
            await axios.post(`${config.systemApiUrl}/heartbeat`, { tenantId: config.tenantId });
            console.log(`[Heartbeat] Success`);
        }
        catch (err) {
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
            await fs.copy(dbPath, backupFile);
            console.log(`[Backup] Created: ${backupFile}`);
        }
        catch (err) {
            console.error("[Backup] Failed:", err instanceof Error ? err.message : err);
        }
    };
    const backupInterval = setInterval(backupOutbox, 1000 * 60 * 60);
    // Cleanup old events
    const cleanupInterval = setInterval(() => syncService.cleanOldEvents(config.eventRetentionMs), 1000 * 60 * 60);
    // Run migrations at startup
    const runMigrations = () => {
        try {
            const schemaPath = path.resolve("packages/db-helper/prisma/tenant.prisma");
            const migrateCmd = `npx prisma migrate deploy --schema=${schemaPath}`;
            exec(migrateCmd, (error, stdout, stderr) => {
                if (error)
                    console.error("[Migrate] Error:", error.message);
                if (stderr)
                    console.error("[Migrate] Stderr:", stderr);
                if (stdout)
                    console.log("[Migrate] Success:\n", stdout);
            });
        }
        catch (err) {
            console.error("[Migrate] Failed:", err instanceof Error ? err.message : err);
        }
    };
    runMigrations();
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
