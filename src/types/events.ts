export type TenantEventType =
    | "student.created"
    | "student.updated"
    | "payment.received"
    | "attendance.marked";

export interface TenantEvent<T = any> {
    id: string;
    type: TenantEventType;
    payload: T;
    createdAt: string;
}
