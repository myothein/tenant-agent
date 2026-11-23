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

/** Only the central origin or the canonical /api/v1 prefix is accepted. */
export function resolveSystemApiBaseUrl(configured: string): string {
    let url: URL;
    try { url = new URL(configured); }
    catch { throw new Error('Invalid SYSTEM_API_URL'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
        url.search || url.hash) {
        throw new Error('Invalid SYSTEM_API_URL');
    }
    const path = url.pathname.replace(/\/+$/, '');
    if (path && path !== '/api/v1') {
        throw new Error('SYSTEM_API_URL must use the central API origin or /api/v1');
    }
    if (url.protocol === 'http:' &&
        !['localhost','127.0.0.1','[::1]','::1'].includes(url.hostname)) {
        throw new Error('SYSTEM_API_URL must use HTTPS outside loopback');
    }
    return url.origin;
}

/** An agent process may only forward data for its deployment-pinned tenant. */
export function assertAgentTenant(tenantId: unknown): void {
    const configured = process.env.TENANT_ID;
    if (!configured || !/^[A-Za-z0-9_-]{1,64}$/.test(configured) ||
        tenantId !== configured) {
        throw new Error('Cross-tenant Central API operation rejected');
    }
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
        return resolveSystemApiBaseUrl(loadConfig().systemApiUrl);
    }
    private agentAuthorization(): string {
        const value = process.env.CENTRAL_AGENT_API_KEY;
        if (!value || Buffer.byteLength(value, 'utf8') < 32) {
            throw new Error('CENTRAL_AGENT_API_KEY must be configured');
        }
        return 'Bearer ' + value;
    }
    private async request(path: string, options: RequestInit = {}, agentAuth = false): Promise<Response> {
        // Ensure caller-supplied headers can never override the scoped agent
        // credential after it has been validated.
        const headers = new Headers(options.headers);
        headers.set('content-type', 'application/json');
        if (agentAuth) headers.set('authorization', this.agentAuthorization());
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
        assertAgentTenant(payload.tenantId);
        // The central endpoint alone decides whether its response is durable.
        const response = await this.request('/api/v1/heartbeats', {
            method:'POST', body:JSON.stringify(payload)
        }, true);
        await response.text();
    }
    async sendEvent(event: CentralEventEnvelope): Promise<void> {
        assertAgentTenant(event.tenantId);
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
