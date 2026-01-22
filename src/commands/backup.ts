import { Command } from "commander";
import fs from "fs-extra";
import path from "path";

export function backupCommand(): Command {
    return new Command("backup")
        .description("Backup tenant outbox database")
        .option("-d, --dest <path>", "Destination folder for backup", "backups")
        .action(async (options) => {
            try {
                const outboxPath = path.resolve("data/outbox.db");
                if (!fs.existsSync(outboxPath)) {
                    console.log("No outbox database found to backup.");
                    return;
                }

                const destFolder = path.resolve(options.dest);
                await fs.ensureDir(destFolder);

                const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                const backupFile = path.join(destFolder, `outbox-backup-${timestamp}.db`);

                await fs.copy(outboxPath, backupFile);

                console.log(`Backup successful: ${backupFile}`);
            } catch (err: unknown) {
                if (err instanceof Error) console.error("Backup failed:", err.message);
                else console.error("Backup failed:", err);
            }
        });
}
