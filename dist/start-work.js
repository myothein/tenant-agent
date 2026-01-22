import { Command } from "commander";
import axios from "axios";
import { config } from "./config/tenant-agent.config.js";
import { SyncService } from "./services/sync.service.js";
import fs from "fs-extra";
import path from "path";
import { exec } from "child_process";
export function startCommand() {
    return new Command("start")
        .description("Start the tenant agent (heartbeat + automatic sync + backup + migrate + cleanup)")
        .action(async () => {
        console.log("Starting Tenant Agent...");
        const syncService = new SyncService();
        const dbPath = path.resolve("data/outbox.db");
        // --------------------
        // Optional: Auto-clean DB on startup
        // --------------------
        if (config.autoCleanDb) {
            try {
                syncService.close(); // release DB file
                await fs.remove(dbPath);
                await fs.ensureDir(path.dirname(dbPath));
                console.log("[AutoCleanDB] Outbox database cleaned on startup.");
            }
            catch (err) {
                if (err instanceof Error)
                    console.error("[AutoCleanDB] Failed:", err.message);
                else
                    console.error("[AutoCleanDB] Failed:", err);
            }
        }
        // --------------------
        // Heartbeat
        // --------------------
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
        setInterval(sendHeartbeat, config.heartbeatIntervalMs);
        // --------------------
        // Outbox Sync
        // --------------------
        syncService.start(config.syncIntervalMs);
        // --------------------
        // Automatic Backup
        // --------------------
        const backupOutbox = async () => {
            try {
                const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                const backupDir = path.resolve("backups");
                await fs.ensureDir(backupDir);
                const backupFile = path.join(backupDir, `outbox-backup-${timestamp}.db`);
                await fs.copy(path.resolve("data/outbox.db"), backupFile);
                console.log(`[Backup] Outbox backup created: ${backupFile}`);
            }
            catch (err) {
                if (err instanceof Error)
                    console.error("[Backup] Failed:", err.message);
                else
                    console.error("[Backup] Failed:", err);
            }
        };
        setInterval(backupOutbox, 1000 * 60 * 60);
        // --------------------
        // Automatic Cleanup of Old Events
        // --------------------
        setInterval(() => syncService.cleanOldEvents(config.eventRetentionMs), 1000 * 60 * 60);
        // --------------------
        // Run Migrations at Startup
        // --------------------
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
                if (err instanceof Error)
                    console.error("[Migrate] Failed:", err.message);
                else
                    console.error("[Migrate] Failed:", err);
            }
        };
        runMigrations();
        console.log("Tenant Agent running. Press Ctrl+C to stop.");
    });
}
