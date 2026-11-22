/**
 * Production defaults are conservative. Overrides are deliberately bounded so
 * QA can exercise real service restart without 60-second polling delays.
 */
function intervalMs(variable: string, fallback: number): number {
    const raw = process.env[variable];
    if (raw === undefined || raw === '') return fallback;
    if (!/^[0-9]{1,7}$/.test(raw)) {
        throw new Error(variable + ' must be an integer number of milliseconds');
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1000 || value > 3600000) {
        throw new Error(variable + ' must be between 1000 and 3600000 ms');
    }
    return value;
}

export const config = {
    tenantId: process.env.TENANT_ID || '',
    systemApiUrl: process.env.SYSTEM_API_URL || 'http://localhost:5000',
    tenantServiceUrl: process.env.TENANT_API_URL || 'http://localhost:3000',
    heartbeatIntervalMs: intervalMs('TENANT_HEARTBEAT_INTERVAL_MS', 30_000),
    syncIntervalMs: intervalMs('TENANT_SYNC_INTERVAL_MS', 60_000),
    eventRetentionMs: 1000 * 60 * 60 * 24,
    cleanupIntervalMs: 3600_000,
    autoCleanDb: false
};
