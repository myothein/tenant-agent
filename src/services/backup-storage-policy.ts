import fs from 'node:fs';
import path from 'node:path';

/**
 * Runtime backups contain tenant data. Production must use an administrator-
 * provisioned directory outside the process working tree, not ./backups.
 * This is a path guard, NOT proof of filesystem ACLs or at-rest encryption.
 */
export function resolveAgentBackupDirectory(
    configured: string | undefined,
    environment: string | undefined = process.env.NODE_ENV,
    workingDirectory: string = process.cwd()
): string {
    if (configured !== undefined && (configured.trim() === '' || configured.includes('\0'))) {
        throw new Error('Invalid TENANT_AGENT_BACKUP_DIR');
    }
    if (environment === 'production' && !configured) {
        throw new Error('Production requires TENANT_AGENT_BACKUP_DIR');
    }
    if (configured && !path.isAbsolute(configured)) {
        throw new Error('TENANT_AGENT_BACKUP_DIR must be absolute');
    }
    return path.resolve(configured ?? path.join(workingDirectory, 'backups'));
}

function isWithin(directory: string, base: string): boolean {
    const relative = path.relative(base, directory);
    return relative === '' || (!relative.startsWith('..' + path.sep) &&
        relative !== '..' && !path.isAbsolute(relative));
}

/**
 * Require a pre-provisioned production directory so the service does not
 * silently create an ACL-unreviewed backup directory. Reject redirection
 * inside the application working tree, including through directory symlinks.
 */
export function verifyAgentBackupDirectory(
    directory: string,
    environment: string | undefined = process.env.NODE_ENV,
    workingDirectory: string = process.cwd()
): string {
    try {
        if (!fs.statSync(directory).isDirectory()) throw new Error('Not a directory');
        const resolved = fs.realpathSync.native(directory);
        if (environment === 'production') {
            const working = fs.realpathSync.native(workingDirectory);
            if (isWithin(resolved, working)) {
                throw new Error('Backup directory within application working tree');
            }
        }
        return resolved;
    } catch {
        // Paths may contain personal or deployment information; never print them.
        throw new Error('Backup directory failed deployment safety checks');
    }
}

/** No implicit directory creation or chmod in production. */
export function prepareAgentBackupDirectory(
    configured: string | undefined,
    environment: string | undefined = process.env.NODE_ENV,
    workingDirectory: string = process.cwd()
): string {
    const directory = resolveAgentBackupDirectory(configured, environment, workingDirectory);
    if (environment !== 'production') {
        fs.mkdirSync(directory, { recursive: true });
    }
    return verifyAgentBackupDirectory(directory, environment, workingDirectory);
}
