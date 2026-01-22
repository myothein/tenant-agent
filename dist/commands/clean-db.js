import { Command } from "commander";
import fs from "fs-extra";
import path from "path";
import { SyncService } from "../services/sync.service.js";
export function cleanDbCommand() {
    return new Command("clean-db")
        .description("Delete the local tenant outbox database safely")
        .action(async () => {
        const dbPath = path.resolve("data/outbox.db");
        try {
            if (!(await fs.pathExists(dbPath))) {
                console.log("[CleanDB] No database found to delete.");
                return;
            }
            // Close SQLite connection if open
            const syncService = new SyncService();
            syncService.close(); // ✅ ensure db is released
            await fs.remove(dbPath);
            console.log("[CleanDB] Outbox database deleted successfully.");
            // Recreate empty folder for future events
            await fs.ensureDir(path.dirname(dbPath));
            console.log("[CleanDB] Ready for fresh events.");
        }
        catch (err) {
            if (err instanceof Error)
                console.error("[CleanDB] Failed:", err.message);
            else
                console.error("[CleanDB] Failed:", err);
        }
    });
}
