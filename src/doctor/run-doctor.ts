// src/doctor/run-doctor.ts
import { renderDoctorResult } from "./render.js";
import { checkConfig } from "./checks/config.js";
import { checkOutbox } from "./checks/outbox.js";
import { checkSystemApi } from "./checks/system-api.js";
import { checkHeartbeat } from "./checks/heartbeat.js";
import { checkAuth } from "./checks/auth.js";

export type DoctorStatus = "pass" | "warn" | "fail";

export interface DoctorCheckResult {
    name: string;
    status: DoctorStatus;
    message?: string;
    meta?: Record<string, unknown>;
}

export interface RunDoctorOptions {
    json?: boolean;
}

export async function runDoctor(
    options: RunDoctorOptions = {}
): Promise<{ exitCode: number; checks: DoctorCheckResult[] }> {
    const checks = await Promise.all([
        checkConfig(),
        checkAuth(),
        checkOutbox(),
        checkSystemApi(),
        checkHeartbeat(),
    ]);

    const hasFail = checks.some(c => c.status === "fail");
    const hasWarn = checks.some(c => c.status === "warn");

    const exitCode = hasFail ? 2 : hasWarn ? 1 : 0;

    renderDoctorResult(checks, {
        json: options.json,
        exitCode,
    });

    return { exitCode, checks };
}
