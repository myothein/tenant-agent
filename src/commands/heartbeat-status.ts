import { Command } from "commander";
import axios from "axios";
import { config } from "../config/tenant-agent.config.js";

export function heartbeatStatusCommand(): Command {
    return new Command("heartbeat-status")
        .description("Check the last heartbeat status for this tenant")
        .action(async () => {
            try {
                console.log(`[Heartbeat] Checking last heartbeat for tenant: ${config.tenantId}...`);

                const response = await axios.get(`${config.systemApiUrl}/heartbeat/${config.tenantId}`);

                if (response.status === 200) {
                    const data = response.data;
                    console.log(`[Heartbeat] Last heartbeat: ${data.lastHeartbeat}`);
                    console.log(`[Heartbeat] Status: ${data.status}`);
                } else {
                    console.log(`[Heartbeat] Unexpected response: ${response.status}`);
                }
            } catch (err: unknown) {
                if (err instanceof Error) {
                    console.error(`[Heartbeat] Failed to fetch status: ${err.message}`);
                } else {
                    console.error(`[Heartbeat] Failed to fetch status:`, err);
                }
            }
        });
}
