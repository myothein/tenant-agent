import fs from "fs";
import path from "path";
import { loadConfig } from "../config/load-config.js";

export interface HeartbeatRecord {
    sentAt: number;          // unix ms
    status: "ok" | "error";
    error?: string;
}

const HEARTBEAT_FILE = "heartbeat.json";

/**
 * Persist last heartbeat result.
 * Called by heartbeat sender.
 */
export function saveHeartbeat(record: HeartbeatRecord): void {
    const filePath = getHeartbeatFilePath();

    ensureDirectory(path.dirname(filePath));

    fs.writeFileSync(
        filePath,
        JSON.stringify(record, null, 2),
        "utf-8"
    );
}

/**
 * Read last heartbeat record.
 * Used by `doctor` and `heartbeat-status`.
 */
export async function getLastHeartbeat(): Promise<HeartbeatRecord | null> {
    const filePath = getHeartbeatFilePath();

    if (!fs.existsSync(filePath)) {
        return null;
    }

    try {
        const raw = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(raw) as HeartbeatRecord;
    } catch {
        // Corrupt heartbeat file should not crash doctor
        return null;
    }
}

/* =======================
   Internals
   ======================= */

function getHeartbeatFilePath(): string {
    const config = loadConfig();

    return path.join(
        path.dirname(config.outboxDbPath),
        HEARTBEAT_FILE
    );
}

function ensureDirectory(dir: string) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
