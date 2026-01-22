// src/outbox/outbox.types.ts

export type OutboxStatus =
    | "pending"
    | "sent"
    | "failed";

export interface OutboxEvent {
    id: string;
    tenantId: string;
    type: string;                 // e.g. "student.created"
    payload: unknown;
    createdAt: string;            // ISO
    sent: number;                 // 0 | 1 (SQLite friendly)
    status: OutboxStatus;
    error?: string | null;
}

// src/outbox/outbox.types.ts
export let allowedEventTypes = ["student.created", "student.updated", "student.deleted"];

/**
 * Add new allowed event types dynamically at runtime.
 */
export function registerEventType(type: string) {
    if (!allowedEventTypes.includes(type)) {
        allowedEventTypes.push(type);
    }
}

/**
 * Replace the entire list of allowed event types (optional)
 */
export function setAllowedEventTypes(types: string[]) {
    allowedEventTypes = [...types];
}
