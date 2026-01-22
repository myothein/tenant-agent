// src/cli/commands/validate-events.ts
import { Command } from "commander";
import { ExportService } from "../services/export.service.js";

export function validateEventsCommand(): Command {
    return new Command("validate-events")
        .description("Validate events in the local outbox")
        .option("--tenant <tenantId>", "Filter by tenant")
        .option("--type <eventType>", "Filter by event type")
        .option("--json", "Output results as JSON", false)
        .action(async (opts) => {
            const service = new ExportService();
            try {
                const { valid, invalid } = await service.validateEvents({
                    tenantId: opts.tenant,
                    type: opts.type,
                });

                if (opts.json) {
                    console.log(JSON.stringify({ valid, invalid, total: valid.length + invalid.length }, null, 2));
                } else {
                    console.log(`Total events: ${valid.length + invalid.length}`);
                    console.log(`Valid events: ${valid.length}`);
                    console.log(`Invalid events: ${invalid.length}`);

                    if (invalid.length) {
                        console.log("\nInvalid events:");
                        for (const evt of invalid) {
                            console.log(`- ${evt.id}: ${evt.errors.join("; ")}`);
                        }
                    }
                }

                if (invalid.length > 0) process.exitCode = 1;
            } catch (err: any) {
                console.error("[Validate] Failed:", err.message);
                process.exitCode = 1;
            }
        });
}
