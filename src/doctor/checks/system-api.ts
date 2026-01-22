// src/doctor/checks/system-api.ts
import { systemApi } from "../../system-api/client.js";

export async function checkSystemApi() {
    const start = Date.now();

    try {
        await systemApi.ping();

        return {
            name: "System API",
            status: "pass" as const,
            message: `Reachable (${Date.now() - start}ms)`,
        };
    } catch (err: any) {
        return {
            name: "System API",
            status: "fail" as const,
            message: err.message || "Unreachable",
        };
    }
}
