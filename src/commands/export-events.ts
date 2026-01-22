// src/cli/commands/export-events.ts
import { Command } from "commander";
import { ExportService } from "../services/export.service.js";

export function exportEventsCommand(): Command {
    return new Command("export-events")
        .description("Export local outbox events to a JSON file")
        .option("-o, --out <file>", "Output file", "outbox-events.json")
        .option("--only-unsent", "Export only unsent events")
        .option("--only-sent", "Export only sent events")
        .option("--tenant <tenantId>", "Filter by tenantId")
        .action(async (opts) => {
            const service = new ExportService();
            try {
                const outFile = await service.exportEvents({
                    outFile: opts.out,
                    onlySent: opts.onlySent,
                    onlyUnsent: opts.onlyUnsent,
                    tenantId: opts.tenant,
                });
                console.log(`[Export] Events exported to ${outFile}`);
            } catch (err: any) {
                console.error("[Export] Failed:", err.message);
                process.exitCode = 1;
            }
        });
}
