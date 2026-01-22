// src/doctor/checks/auth.ts
import { getAuthToken } from "../../auth/token-store.js";

export async function checkAuth() {
    const token = await getAuthToken();

    if (!token) {
        return {
            name: "Auth",
            status: "fail" as const,
            message: "No auth token found",
        };
    }

    if (token.expiresAt && token.expiresAt < Date.now()) {
        return {
            name: "Auth",
            status: "fail" as const,
            message: "Auth token expired",
        };
    }

    return {
        name: "Auth",
        status: "pass" as const,
        message: "Auth token valid",
    };
}
