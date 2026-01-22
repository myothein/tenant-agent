import { Command } from "commander";
import { SyncService } from "../services/sync.service.js";

export function syncCommand() {
    return new Command("sync")
        .description("Sync tenant events with system")
        .action(async () => {
            try {
                const sync = new SyncService();
                await sync.flushOutbox();
                console.log("Sync completed");
            } catch (err) {
                console.error("SYNC ERROR:", err);
                process.exit(1);
            }
        });
}
