import fs from "fs";
import path from "path";
import os from "os";
const FILE = path.join(os.homedir(), ".tenant-agent-update.json");
export function shouldCheckUpdate() {
    try {
        const data = JSON.parse(fs.readFileSync(FILE, "utf-8"));
        return Date.now() - data.lastCheck > 24 * 60 * 60 * 1000;
    }
    catch {
        fs.writeFileSync(FILE, JSON.stringify({ lastCheck: Date.now() }));
        return true;
    }
}
