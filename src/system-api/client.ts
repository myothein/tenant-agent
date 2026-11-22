import { loadConfig } from '../config/load-config.js';

export interface SystemApiClientOptions { timeoutMs?: number; }
export interface CentralEventEnvelope {
    id: string;
    tenantId: string;
    agentId: string;
    event_type: string;
    aggregate_type: string;
    aggregate_id: string;
    payload: unknown;
    createdAt: string;
    occurredAt: string;
}

/**
 * Scoped client for Central Service. The old on-disk token fallback is deliberately
 * NOT used for event delivery. Inject CENTRAL_AGENT_API_KEY securely at runtime.
 */
export class SystemApiClient {
    private timeoutMs: number;
    constructor(options: SystemApiClientOptions = {}) {
        this.timeoutMs = options.timeoutMs ?? 5000;
    }
    private get baseUrl(): string {
        const configured = loadConfig().systemApiUrl.replace(/\/+$/, '');
        const root = configured.replace(/\/api\/v1$/, '');
        const url = new URL(root);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
            throw new Error('Invalid SYSTEM_API_URL');
        }
        if (url.protocol === 'http:' && !['localhost','127.0.0.1','[::1]','::1'].includes(url.hostname)) {
            throw new Error('SYSTEM_API_URL must use HTTPS outside loopback');
        }
        return root;
    }
    private agentAuthorization(): string {
        const value = process.env.CENTRAL_AGENT_API_KEY;
        if (!value || Buffer.byteLength(value, 'utf8') < 32) {
            throw new Error('CENTRAL_AGENT_API_KEY must be configured');
        }
        return 'Bearer ' + value;
    }
    private async request(path: string, options: RequestInit = {}, agentAuth = false): Promise<Response> {
        const headers = { 'content-type':'application/json', ...(agentAuth ?
            { authorization: this.agentAuthorization() } : {}), ...(options.headers ?? {}) };
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const response = await fetch(this.baseUrl + path, {
                ...options, headers, signal: controller.signal
            });
            if (!response.ok) {
                // Do not echo server-supplied errors: they may contain private data.
                throw new Error('Central API returned HTTP ' + response.status);
            }
            return response;
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error('Central API request timed out');
            }
            throw error;
        } finally { clearTimeout(timeout); }
    }
    async ping(): Promise<void> {
        const response = await this.request('/health', { method:'GET' });
        await response.text();
    }
    async sendHeartbeat(payload: { tenantId:string; sentAt:number }): Promise<void> {
        // Central currently returns 501 here; preserve heartbeat as unsuccessful.
        const response = await this.request('/api/v1/heartbeats', {
            method:'POST', body:JSON.stringify(payload)
        }, true);
        await response.text();
    }
    async sendEvent(event: CentralEventEnvelope): Promise<void> {
        const response = await this.request('/api/v1/events', {
            method:'POST', body:JSON.stringify(event)
        }, true);
        if (response.status !== 200 && response.status !== 201) {
            throw new Error('Central event delivery did not return a durable acknowledgment');
        }
        let confirmation: unknown;
        try { confirmation = await response.json(); }
        catch { throw new Error('Invalid central event acknowledgment'); }
        const body = confirmation as { success?: boolean; eventId?: string; status?: string } | null;
        if (!body || body.success !== true || body.eventId !== event.id ||
            !['accepted', 'duplicate'].includes(body.status ?? '')) {
            throw new Error('Central event acknowledgment did not match event identity');
        }
    }
}

export const systemApi = new SystemApiClient();
