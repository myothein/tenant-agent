import { Command } from "commander";
import fs from "fs-extra";
import path from "path";
export function restoreCommand() {
    return new Command("restore")
        .description("Restore tenant outbox database from a backup file")
        .requiredOption("-f, --file <path>", "Backup file to restore from")
        .action(async (options) => {
        try {
            const backupFile = path.resolve(options.file);
            const outboxPath = path.resolve("data/outbox.db");
            if (!fs.existsSync(backupFile)) {
                console.error("Backup file does not exist:", backupFile);
                return;
            }
            await fs.ensureDir(path.dirname(outboxPath));
            // Backup current outbox before restoring
            if (fs.existsSync(outboxPath)) {
                const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                const oldBackup = path.join(path.dirname(outboxPath), `outbox-pre-restore-${timestamp}.db`);
                await fs.copy(outboxPath, oldBackup);
                console.log("Existing outbox backed up as:", oldBackup);
            }
            // Restore from backup
            await fs.copy(backupFile, outboxPath);
            console.log("Outbox successfully restored from backup:", backupFile);
        }
        catch (err) {
            if (err instanceof Error)
                console.error("Restore failed:", err.message);
            else
                console.error("Restore failed:", err);
        }
    });
}
