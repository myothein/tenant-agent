import { v4 as uuid } from "uuid";
import { SyncService, OutboxEvent } from "../services/sync.service.js";


async function sendTestStudentEvent() {
    const sync = new SyncService();

    const event: OutboxEvent = {
        id: uuid(),
        tenantId: "4d34d946-2495-47fc-b67f-4326032d2b81",
        agentId: "tenant-agent-1",
        event_type: "student.created",
        payload: {
            studentId: "s12345",
            name: "John Doe",
            class: "1A",
            age: 6
        },
        createdAt: new Date().toISOString(),
        occurredAt: new Date().toISOString(),
        aggregate_type: "student",  // move here
        aggregate_id: "s12345"      // move here
    };


    sync.addEvent(event);

    const flushedCount = await sync.flushOutbox();
    console.log(`[Test-Sync] Flushed ${flushedCount} event(s)`);

    sync.close();
}

sendTestStudentEvent().catch(err => console.error(err));
