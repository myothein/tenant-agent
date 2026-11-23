import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

/**
 * A SQLite backup must be a complete, readable snapshot before being published.
 * The directory and at-rest encryption/ACL are owned by the deployment operator.
 * Never call this with a path selected by an API or untrusted event.
 */
export function assertValidOutboxSnapshot(snapshotPath: string): void {
    let snapshot: Database.Database | undefined;
    try {
        snapshot = new Database(snapshotPath, { readonly: true, fileMustExist: true });
        if (snapshot.pragma('integrity_check', { simple: true }) !== 'ok') {
            throw new Error('Invalid SQLite backup integrity');
        }
        const schema = snapshot.prepare(
            "SELECT COUNT(*) AS n FROM sqlite_master " +
            "WHERE type='table' AND name='outbox'"
        ).get() as { n: number };
        if (schema.n !== 1) throw new Error('Missing SQLite outbox table');
        // Prove the event table can actually be read from this snapshot.
        snapshot.prepare('SELECT COUNT(*) AS n FROM outbox').get();
    } catch {
        // Do not emit raw SQLite errors or paths: backup directories and
        // database content may carry tenant/user-identifying information.
        throw new Error('SQLite outbox backup verification failed');
    } finally {
        snapshot?.close();
    }
}

/**
 * Stage a native SQLite snapshot inside the destination volume, inspect it,
 * and publish by hard-linking into the final path only if absent.
 * The hard-link step is atomic and refuses overwrites (unlike rename).
 * Never leave a failed or incomplete snapshot with a valid backup filename.
 */
export async function createVerifiedOutboxBackup(
    db: Database.Database, destination: string
): Promise<void> {
    if (typeof destination !== 'string' || !destination.trim() ||
        destination.includes('\0')) {
        throw new Error('Invalid SQLite backup destination');
    }
    const target = path.resolve(destination);
    const directory = path.dirname(target);
    if (!fs.statSync(directory).isDirectory()) {
        throw new Error('SQLite backup directory is unavailable');
    }
    // A staging directory prevents a partial SQLite backup from being mistaken
    // for a completed one by an external backup/restore process.
    const staging = fs.mkdtempSync(path.join(directory, '.outbox-backup-stage-'));
    const stagedFile = path.join(staging, 'snapshot.db');
    try {
        await db.backup(stagedFile);
        assertValidOutboxSnapshot(stagedFile);
        // Works on local NTFS and POSIX filesystems; never overwrites a
        // previous recovery point even when timestamps collide.
        fs.linkSync(stagedFile, target);
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
    }
}
