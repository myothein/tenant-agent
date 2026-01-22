// packages/tenant-agent/src/services/local-event.service.ts
import axios from "axios";
import { Logger } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";
export class LocalEventService {
    tenantServiceUrl;
    centralApiUrl;
    agentId;
    maxRetries;
    constructor(config) {
        this.tenantServiceUrl = config.tenantServiceUrl;
        this.centralApiUrl = config.centralApiUrl;
        this.agentId = config.agentId;
        this.maxRetries = config.maxRetries ?? 3;
    }
    /** Fetch pending events from tenant-service */
    async fetchPendingEvents() {
        try {
            const { data } = await axios.get(`${this.tenantServiceUrl}/local-events/pending`);
            Logger.info(`Fetched ${data.length} pending events`);
            return data;
        }
        catch (err) {
            Logger.error("Failed to fetch pending events from tenant-service", err);
            return [];
        }
    }
    /** Send a single event to central API */
    async sendToCentral(event) {
        try {
            await axios.post(`${this.centralApiUrl}/events`, event.payload, {
                headers: { ...event.headers, "X-Agent-Id": this.agentId },
            });
            Logger.info(`Event sent to central API: ${event.id}`);
            return true;
        }
        catch (err) {
            Logger.error(`Failed to send event ${event.id} to central API`, err.message || err);
            return false;
        }
    }
    /** Mark event as sent or failed in tenant-service */
    async updateEventStatus(event, sent) {
        try {
            await axios.patch(`${this.tenantServiceUrl}/local-events/${event.id}`, {
                sent: sent ? 1 : 0,
                status: sent ? "sent" : "failed",
                retry_count: event.retry_count + (sent ? 0 : 1),
            });
            Logger.info(`Event status updated: ${event.id} => ${sent ? "sent" : "failed"}`);
        }
        catch (err) {
            Logger.error(`Failed to update status for event ${event.id}`, err);
        }
    }
    /** Process pending events */
    async processPendingEvents() {
        const events = await this.fetchPendingEvents();
        for (const event of events) {
            let sent = false;
            let attempt = 0;
            while (!sent && attempt <= this.maxRetries) {
                attempt++;
                sent = await this.sendToCentral(event);
                if (!sent) {
                    Logger.warn(`Retrying event ${event.id} in ${2 ** attempt}s`);
                    await sleep(2 ** attempt * 1000); // exponential backoff
                }
            }
            await this.updateEventStatus(event, sent);
        }
    }
}
