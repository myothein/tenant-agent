import fs from "fs";
export function parseDuration(value) {
    if (/^\d+$/.test(value)) {
        return Number(value);
    }
    const match = value.match(/^(\d+)(ms|s|m)$/);
    if (!match) {
        throw new Error(`Invalid duration: ${value}`);
    }
    const amount = Number(match[1]);
    const unit = match[2];
    switch (unit) {
        case "ms":
            return amount;
        case "s":
            return amount * 1000;
        case "m":
            return amount * 60_000;
        default:
            throw new Error(`Unknown duration unit: ${unit}`);
    }
}
export function ensureDirectory(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
