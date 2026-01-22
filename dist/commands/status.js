import { Command } from "commander";
import { HeartbeatService } from "../services/heartbeat.service.js";
export function statusCommand() {
    return new Command("status")
        .description("Show tenant agent status and heartbeat")
        .action(async () => {
        try {
            console.log("Tenant Agent Status");
            console.log("- Tenant DB: OK (dummy)");
            console.log("- Schema version: v1.0.0");
            const heartbeat = new HeartbeatService();
            await heartbeat.sendHeartbeat();
        }
        catch (err) {
            console.error("STATUS ERROR:", err);
            process.exit(1);
        }
    });
}
