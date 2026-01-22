// src/outbox/outbox.types.ts
// src/outbox/outbox.types.ts
export let allowedEventTypes = ["student.created", "student.updated", "student.deleted"];
/**
 * Add new allowed event types dynamically at runtime.
 */
export function registerEventType(type) {
    if (!allowedEventTypes.includes(type)) {
        allowedEventTypes.push(type);
    }
}
/**
 * Replace the entire list of allowed event types (optional)
 */
export function setAllowedEventTypes(types) {
    allowedEventTypes = [...types];
}
