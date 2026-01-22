// src/cli/commands/start.ts
import { Command } from "commander";
import { systemApi } from "../system-api/client.js";
import { loadConfig } from "../config/load-config.js";
import { SyncService } from "../services/sync.service.js";
import { saveHeartbeat } from "../heartbeat/store.js";
import { Logger } from "../utils/logger.js";
export function startCommand() {
    return new Command("start")
        .description("Start the tenant agent (heartbeat + outbox sync)")
        .action(async () => {
        Logger.info("Starting Tenant Agent...");
        const config = loadConfig();
        const syncService = new SyncService();
        // --------------------
        // Heartbeat
        // --------------------
        const sendHeartbeat = async () => {
            try {
                Logger.info(`[Heartbeat] Sending heartbeat for tenant ${config.tenantId}...`);
                await systemApi.sendHeartbeat({
                    tenantId: config.tenantId,
                    sentAt: Date.now(),
                });
                saveHeartbeat({ sentAt: Date.now(), status: "ok" });
                Logger.info("[Heartbeat] Success");
            }
            catch (err) {
                Logger.error(`[Heartbeat] Error: ${err.message}`);
                saveHeartbeat({ sentAt: Date.now(), status: "error", error: err.message });
            }
        };
        // Send immediately & repeat at interval
        sendHeartbeat();
        setInterval(sendHeartbeat, config.heartbeatIntervalMs);
        // --------------------
        // Outbox Sync
        // --------------------
        const flushOutbox = async () => {
            try {
                const flushed = await syncService.flushOutbox();
                if (flushed > 0) {
                    Logger.info(`[Sync] Flushed ${flushed} events to central API`);
                }
            }
            catch (err) {
                Logger.error("[Sync] Error flushing outbox:", err.message);
            }
        };
        // Flush immediately & repeat at interval
        flushOutbox();
        setInterval(flushOutbox, config.syncIntervalMs);
        Logger.info("Tenant Agent running. Press Ctrl+C to stop.");
    });
}
