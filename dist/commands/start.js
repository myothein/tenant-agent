import { Command } from "commander";
import { config } from "../config/tenant-agent.config.js";
import { Logger } from "../utils/logger.js";
import { LocalEventsSyncService } from "../services/sync-local-events.service.js";
import { systemApi } from "../system-api/client.js";
import { saveHeartbeat } from "../heartbeat/store.js";
export function startCommand() {
    return new Command("start")
        .description("Start the Tenant Agent (heartbeat + local_event sync + outbox flush)")
        .action(async () => {
        const tenantId = config.tenantId;
        const syncService = new LocalEventsSyncService(tenantId, config.tenantServiceUrl);
        Logger.info(`[Tenant-Agent] Starting agent for tenant: ${tenantId}`);
        // --------------------
        // Heartbeat loop
        // --------------------
        const sendHeartbeat = async () => {
            try {
                await systemApi.sendHeartbeat({
                    tenantId,
                    sentAt: Date.now(),
                });
                saveHeartbeat({ sentAt: Date.now(), status: "ok" });
                Logger.info(`[Heartbeat] Sent successfully`);
            }
            catch (err) {
                Logger.error(`[Heartbeat] Failed: ${err.message}`);
                saveHeartbeat({ sentAt: Date.now(), status: "error", error: err.message });
            }
        };
        sendHeartbeat(); // immediately
        setInterval(sendHeartbeat, config.heartbeatIntervalMs);
        // --------------------
        // Sync + flush loop
        // --------------------
        const runSync = async () => {
            try {
                const polled = await syncService.pollLocalEvents();
                if (polled > 0)
                    Logger.info(`[Sync] Polled ${polled} local events from tenant-service`);
                const flushed = await syncService.flushOutbox();
                if (flushed > 0)
                    Logger.info(`[Sync] Flushed ${flushed} events to central API`);
            }
            catch (err) {
                Logger.error(`[Sync] Error during sync: ${err.message}`);
            }
        };
        runSync(); // immediately
        setInterval(runSync, config.syncIntervalMs);
        Logger.info(`[Tenant-Agent] Agent is running. Press Ctrl+C to stop.`);
    });
}
