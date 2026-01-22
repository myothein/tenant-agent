import Database from "better-sqlite3";
import fs from "fs-extra";
import path from "path";
import { Command } from "commander";
function hasColumn(db, table, column) {
    const stmt = db.prepare(`PRAGMA table_info(${table})`);
    const columns = stmt.all().map((row) => row.name);
    return columns.includes(column);
}
const migrationColumns = {
    "002_add_created_at.sql": [["outbox", "created_at"]],
    "003_add_status.sql": [["outbox", "status"]],
    "004_add_retry_count.sql": [["outbox", "retry_count"]],
    "011_add_agentId.sql": [["outbox", "agentId"]]
};
function shouldSkip(file, db) {
    const columns = migrationColumns[file];
    if (!columns)
        return false;
    return columns.every(([table, column]) => hasColumn(db, table, column));
}
function markApplied(db, version) {
    db.prepare(`INSERT OR IGNORE INTO schema_migrations (version, applied_at)
         VALUES (?, datetime('now'))`).run(version);
}
// The migrate command
export function migrateCommand() {
    return new Command("migrate")
        .description("Run outbox database migrations")
        .action(() => {
        const dbPath = path.resolve("data/outbox.db");
        const migrationsDir = path.resolve("migrations");
        const db = new Database(dbPath);
        db.pragma("journal_mode = WAL");
        // Ensure migrations table exists
        db.exec(`
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version TEXT PRIMARY KEY,
                    applied_at TEXT NOT NULL
                );
            `);
        const applied = new Set(db.prepare("SELECT version FROM schema_migrations")
            .all()
            .map((r) => r.version));
        const files = fs
            .readdirSync(migrationsDir)
            .filter(f => f.endsWith(".sql"))
            .sort();
        for (const file of files) {
            if (applied.has(file))
                continue;
            if (shouldSkip(file, db)) {
                console.log("Skipping (already applied in schema):", file);
                markApplied(db, file);
                continue;
            }
            console.log("Applying migration:", file);
            const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
            const tx = db.transaction(() => {
                db.exec(sql);
                markApplied(db, file);
            });
            tx();
        }
        console.log("Migrations complete");
        db.close();
    });
}
