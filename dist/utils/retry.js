// packages/tenant-agent/src/utils/retry.ts
import { Logger } from "./logger.js";
export async function retry(fn, maxRetries = 3, delay = 1000) {
    let attempt = 0;
    while (true) {
        try {
            return await fn();
        }
        catch (err) {
            attempt++;
            if (attempt > maxRetries)
                throw err;
            Logger.warn(`Retry attempt ${attempt} failed. Retrying in ${delay}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            delay *= 2; // exponential backoff
        }
    }
}
