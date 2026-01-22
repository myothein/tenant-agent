import { Command } from "commander";
import { SyncService } from "../services/sync.service.js";
import { v4 as uuid } from "uuid";
export function testSyncCommand() {
    return new Command("test-sync")
        .description("Send a test event to the system API")
        .action(async () => {
        try {
            const sync = new SyncService();
            const event = {
                id: uuid(),
                tenantId: "4d34d946-2495-47fc-b67f-4326032d2b81",
                agentId: "tenant-agent-1",
                aggregate_type: "My Aggregate", // REQUIRED
                aggregate_id: uuid(), // REQUIRED
                event_type: "test-event",
                payload: {
                    "studentId": "s12345",
                    "name": "Myo Thein",
                    "class": "1A",
                    "age": 6
                },
                createdAt: new Date().toISOString(),
                occurredAt: new Date().toISOString(),
                sent: 0, // optional, default 0
                status: "pending", // optional, default 'pending'
                retry_count: 0, // optional
                event_version: 1, // optional
                headers: JSON.stringify({}) // optional
            };
            sync.addEvent(event); // cast to bypass strict typing
            const flushed = await sync.flushOutbox();
            console.log(`[Test-Sync] Flushed ${flushed} event(s)`);
            sync.close();
        }
        catch (err) {
            if (err instanceof Error)
                console.error("[Test-Sync]", err.message);
            else
                console.error("[Test-Sync] Unknown error:", err);
        }
    });
}
