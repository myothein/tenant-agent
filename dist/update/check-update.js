export {};
/*
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import semver from "semver";
import { getLatestVersion } from "./latest-version.js";
import { shouldCheckUpdate } from "./cache.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkg = JSON.parse(
    readFileSync(path.join(__dirname, "../../../package.json"), "utf-8")
);

export async function checkForUpdate() {
    try {
        if (!shouldCheckUpdate()) return;

        const current = pkg.version;
        const latest = await getLatestVersion();

        if (semver.lt(current, latest)) {
            console.log(`⬆️ Update available: ${current} → ${latest}`);
            console.log("Run: tenant-agent self-update");
        }
    } catch {
        // silent fail (offline-safe)
    }
}
*/ 
