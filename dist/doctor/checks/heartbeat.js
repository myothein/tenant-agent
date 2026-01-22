// src/doctor/checks/heartbeat.ts
import { getLastHeartbeat } from "../../heartbeat/store.js";
const MAX_AGE_MS = 5 * 60 * 1000;
export async function checkHeartbeat() {
    const last = await getLastHeartbeat();
    if (!last) {
        return {
            name: "Heartbeat",
            status: "warn",
            message: "No heartbeat sent yet",
        };
    }
    const ageMs = Date.now() - last.sentAt;
    const ageSeconds = Math.round(ageMs / 1000);
    if (ageMs > MAX_AGE_MS) {
        return {
            name: "Heartbeat",
            status: "warn",
            message: `Last heartbeat was ${ageSeconds}s ago`,
            meta: {
                lastSentAt: new Date(last.sentAt).toISOString(),
                ageMs,
            },
        };
    }
    return {
        name: "Heartbeat",
        status: "pass",
        message: `Last heartbeat OK — ${ageSeconds}s ago`,
        meta: {
            lastSentAt: new Date(last.sentAt).toISOString(),
            ageMs,
        },
    };
}
