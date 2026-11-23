import { Command } from "commander";
import { SyncService } from "../services/sync.service.js";

export function syncCommand() {
    return new Command("sync")
        .description("Sync tenant events with system")
        .action(async () => {
            let sync: SyncService | undefined;
            try {
                sync = new SyncService();
                const delivered = await sync.flushOutbox();
                // A zero count may mean no work OR a retained, failed event.
                // Do not claim delivery of events that Central did not accept.
                console.log("Sync attempt finished; delivered " + delivered + " event(s)");
            } catch {
                // Raw exception objects may include transport configuration and tokens.
                console.error("SYNC ERROR: local event delivery refused; queued events retained");
                process.exitCode = 1;
            } finally {
                try { sync?.close(); }
                catch {
                    console.error("SYNC ERROR: failed to close the local outbox safely");
                    process.exitCode = 1;
                }
            }
        });
}
