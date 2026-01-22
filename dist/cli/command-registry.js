import { statusCommand } from "../commands/status.js";
import { syncCommand } from "../commands/sync.js";
import { migrateCommand } from "../commands/migrate.js";
import { backupCommand } from "../commands/backup.js";
import { restoreCommand } from "../commands/restore.js";
import { cleanDbCommand } from "../commands/clean-db.js";
import { exportEventsCommand } from "../commands/export-events.js";
import { importEventsCommand } from "../commands/import-events.js";
import { startCommand } from "../commands/start.js";
import { testSyncCommand } from "../commands/test-sync.js";
import { registerDoctorCommand } from "../commands/doctor.js";
import { outboxCommand } from "../commands/outbox.js";
import { flushOutboxCommand } from "../commands/flush-outbox.js";
import { retryUnsentCommand } from "../commands/retry-unsent.js";
import { heartbeatStatusCommand } from "../commands/heartbeat-status.js";
export function getCommandRegistry() {
    return [
        { command: statusCommand() },
        { command: syncCommand() },
        { command: migrateCommand() },
        { command: backupCommand() },
        { command: restoreCommand() },
        { command: cleanDbCommand() },
        { command: exportEventsCommand() },
        { command: importEventsCommand() },
        { command: startCommand() },
        { command: testSyncCommand() },
        { command: registerDoctorCommand() },
        { command: outboxCommand() },
        { command: flushOutboxCommand() },
        { command: retryUnsentCommand() },
        { command: heartbeatStatusCommand() },
    ];
}
