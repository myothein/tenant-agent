import { Help } from "commander";
export class CLIHelp extends Help {
    constructor() {
        super();
    }
    formatHelp(cmd, helper) {
        let output = "";
        // Header
        output += `\n${cmd.name()} CLI\n\n`;
        output += `${cmd.description()}\n\n`;
        // Usage
        output += `Usage: ${helper.commandUsage(cmd)}\n\n`;
        // Commands
        const visibleCommands = cmd.commands.filter(c => !c._hidden);
        if (visibleCommands.length > 0) {
            output += `Commands:\n`;
            visibleCommands.forEach(c => {
                const name = c.name();
                const desc = c.description();
                const icon = c.icon ? c.icon + " " : "";
                output += `  ${icon}${name.padEnd(12)} ${desc}\n`;
            });
            output += "\n";
        }
        // Options
        output += `Options:\n`;
        const options = helper.visibleOptions(cmd);
        options.forEach(o => {
            const flags = o.flags.padEnd(20);
            const desc = o.description;
            output += `  ${flags} ${desc}\n`;
        });
        // Footer
        output += `\n`;
        return output;
    }
}
