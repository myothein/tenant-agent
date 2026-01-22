import fs from "fs";
import path from "path";
import { loadConfig } from "../config/load-config.js";

export interface AuthToken {
    token: string;
    createdAt: number;      // unix ms
    expiresAt?: number;     // unix ms (optional)
}

const TOKEN_FILE = "auth-token.json";

/* =======================
   Public API
   ======================= */

/**
 * Read auth token from env or disk.
 * Used by system-api client and `doctor`.
 */
export async function getAuthToken(): Promise<AuthToken | null> {
    // 1️⃣ ENV has highest priority (stateless deployments)
    const envToken = process.env.SYSTEM_API_TOKEN;
    if (envToken) {
        return {
            token: envToken,
            createdAt: 0,
        };
    }

    // 2️⃣ Fallback to disk
    const filePath = getTokenFilePath();
    if (!fs.existsSync(filePath)) {
        return null;
    }

    try {
        const raw = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(raw) as AuthToken;
    } catch {
        // Corrupt token file should not crash doctor
        return null;
    }
}

/**
 * Persist auth token to disk.
 * Used by `auth login` / `auth rotate`.
 */
export async function saveAuthToken(token: AuthToken): Promise<void> {
    const filePath = getTokenFilePath();

    ensureDirectory(path.dirname(filePath));

    fs.writeFileSync(
        filePath,
        JSON.stringify(token, null, 2),
        "utf-8"
    );
}

/**
 * Remove stored auth token.
 * Used by `auth revoke`.
 */
export async function clearAuthToken(): Promise<void> {
    const filePath = getTokenFilePath();

    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}

/* =======================
   Internals
   ======================= */

function getTokenFilePath(): string {
    const config = loadConfig();

    // Store token alongside outbox DB
    return path.join(
        path.dirname(config.outboxDbPath),
        TOKEN_FILE
    );
}

function ensureDirectory(dir: string) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
