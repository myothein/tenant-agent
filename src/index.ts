#!/usr/bin/env node
import { Command } from "commander";
import { getCommandRegistry } from "./cli/command-registry.js";
import { CLIHelp } from "./cli/help.js";
import { startAgent } from "./start-agent.js"; // <-- new runtime logic
import "dotenv/config";

const program = new Command();

program
    .name("tenant-agent")
    .description("Tenant infrastructure agent for SMS")
    .version("0.1.0");

program.configureHelp({
    formatHelp: (cmd, helper) => {
        try {
            return new CLIHelp().formatHelp(cmd, helper);
        } catch (err: unknown) {
            if (err instanceof Error) console.error("HELP ERROR:", err.message);
            else console.error("HELP ERROR:", err);
            throw err;
        }
    },
    helpWidth: 80,
    sortSubcommands: true
});

const commands = getCommandRegistry();
commands.forEach(({ command }) => program.addCommand(command));

// Parse CLI arguments
await program.parseAsync(process.argv);

// ----------------------
// SERVICE MODE
// ----------------------
if (!process.argv.slice(2).length) {
    console.log("No CLI command detected → running as Windows service");
    startAgent().catch(err => {
        console.error("Tenant Agent failed:", err);
        process.exit(1);
    });
}
