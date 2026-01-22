import { Command } from "commander";
import { startAgent } from "./start-agent.js";

export function startCommand(): Command {
    return new Command("start")
        .description("Start the tenant agent (CLI mode)")
        .action(async () => {
            console.log("CLI: Starting Tenant Agent...");
            await startAgent();
        });
}
