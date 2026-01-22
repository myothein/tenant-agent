import { Command } from "commander";
import { SyncService } from "../services/sync.service.js";

export function retryUnsentCommand(): Command {
    return new Command("retry-unsent")
        .description("Retry sending all unsent events from the outbox")
        .action(async () => {
            try {
                const sync = new SyncService();
                console.log("[Retry] Checking for unsent events...");

                const flushedCount = await sync.flushOutbox();

                if (flushedCount === 0) {
                    console.log("No unsent events found.");
                } else {
                    console.log(`[Retry] ${flushedCount} event(s) successfully retried.`);
                }
            } catch (err: unknown) {
                if (err instanceof Error) console.error("Error retrying unsent events:", err.message);
                else console.error("Error retrying unsent events:", err);
            }
        });
}
