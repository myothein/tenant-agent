// packages/tenant-agent/src/utils/logger.ts
export class Logger {
    static info(message, ...optional) {
        console.log(`[INFO] ${new Date().toISOString()} - ${message}`, ...optional);
    }
    static warn(message, ...optional) {
        console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, ...optional);
    }
    static error(message, ...optional) {
        console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, ...optional);
    }
}
