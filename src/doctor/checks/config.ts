import { loadConfig } from "../../config/load-config.js";
import { DoctorCheckResult } from "../run-doctor.js";

export async function checkConfig(): Promise<DoctorCheckResult> {
    try {
        const config = loadConfig({ allowMissing: true });

        const results: string[] = [];
        let status: "pass" | "warn" | "fail" = "pass";

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
    } catch (err: any) {
        return {
            name: "Config",
            status: "fail",
            message: err.message,
        };
    }
}
