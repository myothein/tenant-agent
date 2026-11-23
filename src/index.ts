#!/usr/bin/env node
// Configure local development environment before evaluating dependent modules.
// Production services must inject secrets through the runtime environment.
import 'dotenv/config';
import { Command } from 'commander';
import { getCommandRegistry } from './cli/command-registry.js';
import { CLIHelp } from './cli/help.js';
import { startAgent } from './start-agent.js';

const program = new Command();
program
    .name('tenant-agent')
    .description('Tenant infrastructure agent for SMS')
    .version('0.1.0');
program.configureHelp({
    formatHelp: (cmd, helper) => {
        try { return new CLIHelp().formatHelp(cmd, helper); }
        catch {
            console.error('CLI help rendering failed');
            throw new Error('CLI help rendering failed');
        }
    },
    helpWidth: 80,
    sortSubcommands: true
});
for (const { command } of getCommandRegistry()) program.addCommand(command);

// Explicit service mode MUST bypass Commander parsing: some Commander versions
// display subcommand help and exit before the service can start with zero args.
if (process.argv.slice(2).length === 0) {
    try {
        await startAgent();
    } catch {
        // Do not log raw environment or connection errors: these may contain secrets.
        console.error('Tenant Agent startup refused. Check validated QA/service configuration.');
        process.exitCode = 1;
    }
} else {
    await program.parseAsync(process.argv);
}
