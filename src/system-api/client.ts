import { loadConfig } from "../config/load-config.js";
import { getAuthToken } from "../auth/token-store.js";

export interface SystemApiClientOptions {
    timeoutMs?: number;
}

class SystemApiClient {
    private _baseUrl?: string;
    private timeoutMs: number;

    constructor(options: SystemApiClientOptions = {}) {
        this.timeoutMs = options.timeoutMs ?? 5000;
    }

    /* =======================
       Lazy Base URL Getter
       ======================= */
    private get baseUrl(): string {
        if (!this._baseUrl) {
            const config = loadConfig(); // lazy load
            this._baseUrl = config.systemApiUrl.replace(/\/$/, "");
        }
        return this._baseUrl;
    }

    /* =======================
       Core HTTP Helper
       ======================= */
    private async request(
        path: string,
        options: RequestInit = {}
    ): Promise<Response> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        const token = await getAuthToken();

        try {
            const res = await fetch(`${this.baseUrl}${path}`, {
                ...options,
                signal: controller.signal,
                headers: {
                    "content-type": "application/json",
                    ...(token ? { authorization: `Bearer ${token.token}` } : {}),
                    ...(options.headers ?? {}),
                },
            });

            if (!res.ok) {
                const text = await safeReadText(res);
                throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
            }

            return res;
        } catch (err: any) {
            if (err.name === "AbortError") {
                throw new Error("Request timed out");
            }
            throw err;
        } finally {
            clearTimeout(timeout);
        }
    }

    /* =======================
       Public API
       ======================= */

    /**
     * Used by `doctor` to verify connectivity.
     */
    async ping(): Promise<void> {
        await this.request("/health", { method: "GET" });
    }

    /**
     * Send a heartbeat to the system.
     */
    async sendHeartbeat(payload: { tenantId: string; sentAt: number }): Promise<void> {
        await this.request("/tenant/heartbeat", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    }

    /**
     * Send a single outbox event.
     */
    async sendEvent(event: {
        id: string;
        tenantId: string;
        agentId: string;
        event_type: string;
        payload: unknown;
        createdAt: string;
        occurredAt: string;
    }): Promise<void> {
        await this.request("/tenant/events", {
            method: "POST",
            body: JSON.stringify(event),
        });
    }
}

/* =======================
   Singleton
   ======================= */
export const systemApi = new SystemApiClient();

/* =======================
   Utilities
   ======================= */
async function safeReadText(res: Response): Promise<string> {
    try {
        return await res.text();
    } catch {
        return "";
    }
}
