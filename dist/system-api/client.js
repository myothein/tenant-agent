import { loadConfig } from "../config/load-config.js";
import { getAuthToken } from "../auth/token-store.js";
class SystemApiClient {
    _baseUrl;
    timeoutMs;
    constructor(options = {}) {
        this.timeoutMs = options.timeoutMs ?? 5000;
    }
    /* =======================
       Lazy Base URL Getter
       ======================= */
    get baseUrl() {
        if (!this._baseUrl) {
            const config = loadConfig(); // lazy load
            this._baseUrl = config.systemApiUrl.replace(/\/$/, "");
        }
        return this._baseUrl;
    }
    /* =======================
       Core HTTP Helper
       ======================= */
    async request(path, options = {}) {
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
        }
        catch (err) {
            if (err.name === "AbortError") {
                throw new Error("Request timed out");
            }
            throw err;
        }
        finally {
            clearTimeout(timeout);
        }
    }
    /* =======================
       Public API
       ======================= */
    /**
     * Used by `doctor` to verify connectivity.
     */
    async ping() {
        await this.request("/health", { method: "GET" });
    }
    /**
     * Send a heartbeat to the system.
     */
    async sendHeartbeat(payload) {
        await this.request("/tenant/heartbeat", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    }
    /**
     * Send a single outbox event.
     */
    async sendEvent(event) {
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
async function safeReadText(res) {
    try {
        return await res.text();
    }
    catch {
        return "";
    }
}
