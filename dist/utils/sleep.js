// packages/tenant-agent/src/utils/sleep.ts
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
