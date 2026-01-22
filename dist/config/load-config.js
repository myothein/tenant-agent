import path from "path";
import { parseDuration, ensureDirectory } from "./utils.js";
let cachedConfig = null;
/**
 * Load and validate tenant-agent configuration.
 * Throws on failure, unless allowMissing=true.
 */
export function loadConfig({ allowMissing = false } = {}) {
    if (cachedConfig)
        return cachedConfig;
    const tenantId = process.env.TENANT_ID;
    const systemApiUrl = process.env.SYSTEM_API_URL;
    const authToken = process.env.SYSTEM_API_TOKEN;
    if (!tenantId && !allowMissing) {
        throw new Error("TENANT_ID is not set");
    }
    if (!systemApiUrl && !allowMissing) {
        throw new Error("SYSTEM_API_URL is not set");
    }
    const heartbeatIntervalMs = parseDuration(process.env.HEARTBEAT_INTERVAL ?? "60s");
    const syncIntervalMs = parseDuration(process.env.SYNC_INTERVAL ?? "30s");
    const outboxDbPath = process.env.OUTBOX_DB_PATH ??
        path.resolve(process.cwd(), "data", "outbox.db");
    ensureDirectory(path.dirname(outboxDbPath));
    cachedConfig = {
        tenantId: tenantId ?? "",
        systemApiUrl: systemApiUrl ?? "",
        authToken,
        heartbeatIntervalMs,
        syncIntervalMs,
        outboxDbPath,
    };
    return cachedConfig;
}
