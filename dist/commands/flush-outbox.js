import { Command } from "commander";
import { SyncService } from "../services/sync.service.js";
export function flushOutboxCommand() {
    return new Command("flush-outbox")
        .description("Flush all unsent events from outbox to the system API")
        .action(async () => {
        try {
            const sync = new SyncService();
            console.log("[Flush] Checking for unsent events...");
            const unsentCount = await sync.flushOutbox();
            if (unsentCount === 0) {
                console.log("No unsent events found.");
            }
            else {
                console.log(`[Flush] ${unsentCount} event(s) successfully flushed.`);
            }
        }
        catch (err) {
            if (err instanceof Error)
                console.error("Error flushing outbox:", err.message);
            else
                console.error("Error flushing outbox:", err);
        }
    });
}
