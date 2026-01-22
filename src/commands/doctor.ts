// src/cli/commands/doctor.ts
import { Command } from "commander";
import { runDoctor } from "../doctor/run-doctor.js";

export function registerDoctorCommand(): Command {
    const cmd = new Command("doctor");
    cmd
        .description("Run health checks on tenant agent")
        .option("--json", "Output results as JSON", false)
        .action(async (opts) => {
            try {
                const { exitCode } = await runDoctor({ json: opts.json });
                process.exit(exitCode);
            } catch (err: any) {
                console.error("Doctor command failed:", err.message);
                process.exit(2);
            }
        });
    return cmd;
}
