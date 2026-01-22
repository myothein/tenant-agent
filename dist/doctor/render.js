const ICONS = {
    pass: "✔",
    warn: "⚠",
    fail: "✖",
};
export function renderDoctorResult(checks, options) {
    if (options.json) {
        console.log(JSON.stringify({ checks, exitCode: options.exitCode }, null, 2));
        return;
    }
    let passed = 0;
    let warned = 0;
    let failed = 0;
    for (const check of checks) {
        if (check.status === "pass")
            passed++;
        if (check.status === "warn")
            warned++;
        if (check.status === "fail")
            failed++;
        const icon = ICONS[check.status];
        const msg = check.message ? ` — ${check.message}` : "";
        console.log(`${icon} ${check.name}${msg}`);
    }
    console.log("");
    console.log("Doctor summary:");
    console.log(`  Passed: ${passed}`);
    console.log(`  Warnings: ${warned}`);
    console.log(`  Failed: ${failed}`);
    console.log("");
    console.log(`Status: ${failed ? "UNHEALTHY" : warned ? "DEGRADED" : "HEALTHY"}`);
}
