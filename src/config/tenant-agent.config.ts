export const config = {
    tenantId: process.env.TENANT_ID || "",
    systemApiUrl: process.env.SYSTEM_API_URL || "http://localhost:5000",
    tenantServiceUrl: process.env.TENANT_API_URL || "http://localhost:3000",
    heartbeatIntervalMs: 30_000, // every 30 seconds
    syncIntervalMs: 60_000, // every 1 minute
    eventRetentionMs: 1000 * 60 * 60 * 24, // 1 day
    cleanupIntervalMs: 3600_000, // 1 day
    autoCleanDb: false // set true to clean DB on startup
};
