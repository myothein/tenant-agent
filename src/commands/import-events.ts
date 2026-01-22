// src/cli/commands/import-events.ts
import { Command } from "commander";
import { ExportService } from "../services/export.service.js";

export function importEventsCommand(): Command {
    return new Command("import-events")
        .description("Import events from a JSON file into local outbox")
        .argument("<file>", "JSON file containing events")
        .option("--skip-duplicates", "Skip events that already exist in the outbox")
        .action(async (file, opts) => {
            const service = new ExportService();
            try {
                const count = await service.importEvents(file, { skipDuplicates: opts.skipDuplicates });
                console.log(`[Import] Imported ${count} events from ${file}`);
            } catch (err: any) {
                console.error("[Import] Failed:", err.message);
                process.exitCode = 1;
            }
        });
}
