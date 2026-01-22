import { Command } from "commander";
import { SyncService } from "../services/sync.service.js";

export function outboxCommand(): Command {
    return new Command("outbox")
        .description("List all events in the persistent outbox")
        .action(() => {
            try {
                const sync = new SyncService();
                const events = sync.listEvents(); // returns array of events from SQLite

                if (!events.length) {
                    console.log("Outbox is empty");
                    return;
                }

                console.table(
                    events.map(e => ({
                        ID: e.id,
                        Tenant: e.tenantId,
                        Type: e.event_type,
                        Payload: e.payload,
                        CreatedAt: e.createdAt,
                        Sent: e.sent ? "✅" : "❌",
                    }))
                );
            } catch (err: unknown) {
                if (err instanceof Error) console.error("Error reading outbox:", err.message);
                else console.error("Error reading outbox:", err);
            }
        });
}
