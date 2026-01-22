import fs from "fs";
import path from "path";
import { loadConfig } from "../config/load-config.js";
const HEARTBEAT_FILE = "heartbeat.json";
/**
 * Persist last heartbeat result.
 * Called by heartbeat sender.
 */
export function saveHeartbeat(record) {
    const filePath = getHeartbeatFilePath();
    ensureDirectory(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), "utf-8");
}
/**
 * Read last heartbeat record.
 * Used by `doctor` and `heartbeat-status`.
 */
export async function getLastHeartbeat() {
    const filePath = getHeartbeatFilePath();
    if (!fs.existsSync(filePath)) {
        return null;
    }
    try {
        const raw = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        // Corrupt heartbeat file should not crash doctor
        return null;
    }
}
/* =======================
   Internals
   ======================= */
function getHeartbeatFilePath() {
    const config = loadConfig();
    return path.join(path.dirname(config.outboxDbPath), HEARTBEAT_FILE);
}
function ensureDirectory(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
