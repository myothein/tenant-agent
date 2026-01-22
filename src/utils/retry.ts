// packages/tenant-agent/src/utils/retry.ts
import { Logger } from "./logger.js";

export async function retry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    delay: number = 1000
): Promise<T> {
    let attempt = 0;
    while (true) {
        try {
            return await fn();
        } catch (err) {
            attempt++;
            if (attempt > maxRetries) throw err;
            Logger.warn(`Retry attempt ${attempt} failed. Retrying in ${delay}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            delay *= 2; // exponential backoff
        }
    }
}
