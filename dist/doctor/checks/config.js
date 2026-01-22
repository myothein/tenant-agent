import { loadConfig } from "../../config/load-config.js";
export async function checkConfig() {
    try {
        const config = loadConfig({ allowMissing: true });
        const results = [];
        let status = "pass";
        if (!config.tenantId) {
            results.push("TENANT_ID is missing");
            status = "fail";
        }
        if (!config.systemApiUrl) {
            results.push("SYSTEM_API_URL is missing");
            status = "fail";
        }
        return {
            name: "Config",
            status,
            message: results.join(", ") || undefined,
        };
    }
    catch (err) {
        return {
            name: "Config",
            status: "fail",
            message: err.message,
        };
    }
}
