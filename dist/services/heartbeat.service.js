import axios from "axios";
import { config } from "../config/tenant-agent.config.js";
export class HeartbeatService {
    async sendHeartbeat() {
        try {
            console.log(`[Heartbeat] Sending heartbeat for tenant ${config.tenantId}...`);
            await axios.post(`${config.systemApiUrl}/heartbeat`, { tenantId: config.tenantId });
            console.log("[Heartbeat] Success");
        }
        catch (err) {
            if (err instanceof Error) {
                console.error("[Heartbeat] Failed:", err.message);
            }
            else {
                console.error("[Heartbeat] Failed:", err);
            }
        }
    }
    start(intervalMs = config.heartbeatIntervalMs) {
        this.sendHeartbeat();
        setInterval(() => this.sendHeartbeat(), intervalMs);
    }
}
