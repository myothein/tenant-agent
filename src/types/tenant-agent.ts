export interface OutboxEvent {
    id: string;
    type: string;
    payload: any;
    createdAt: string;
    sent?: boolean;
}
