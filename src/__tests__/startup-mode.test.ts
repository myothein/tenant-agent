import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareAgentBackupDirectory, resolveAgentBackupDirectory,
    verifyAgentBackupDirectory } from '../services/backup-storage-policy.js';

const entry = path.resolve('dist/index.js');

test('zero-argument CLI selects service mode and refuses invalid config safely', () => {
    const result = spawnSync(process.execPath, [entry], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            TENANT_ID: '',
            SYSTEM_API_URL: '',
            TENANT_API_URL: '',
            CENTRAL_AGENT_API_KEY: '',
            TENANT_AGENT_API_KEY: ''
        },
        encoding: 'utf8',
        timeout: 10_000
    });
    assert.notEqual(result.status, 0, 'Service must fail closed without tenant config');
    assert.match(result.stderr, /Tenant Agent startup refused/);
    assert.doesNotMatch(result.stdout, /Usage: tenant-agent/);
    assert.doesNotMatch(result.stderr, /CENTRAL_AGENT_API_KEY=/);
});

test('--help remains a CLI operation and does not start service', () => {
    const result = spawnSync(process.execPath, [entry, '--help'], {
        encoding: 'utf8',
        timeout: 10_000
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /tenant-agent/i);
    assert.doesNotMatch(result.stderr, /Tenant Agent startup refused/);
});


test('production backup directory is explicit, absolute, pre-provisioned and outside the app tree', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-backup-policy-'));
    const workdir = path.join(dir, 'app');
    const external = path.join(dir, 'operator-backups');
    fs.mkdirSync(workdir);
    fs.mkdirSync(external);
    const installed = path.join(dir, 'installed-agent');
    const installBackup = path.join(installed, 'backups');
    fs.mkdirSync(installBackup, { recursive: true });
    try {
        assert.throws(() => resolveAgentBackupDirectory(undefined, 'production', workdir),
            /requires TENANT_AGENT_BACKUP_DIR/);
        assert.throws(() => resolveAgentBackupDirectory('', 'production', workdir),
            /Invalid TENANT_AGENT_BACKUP_DIR/);
        assert.throws(() => resolveAgentBackupDirectory('../backup', 'production', workdir),
            /must be absolute/);
        assert.throws(() => resolveAgentBackupDirectory('data\0backup', 'production', workdir),
            /Invalid TENANT_AGENT_BACKUP_DIR/);

        const inside = path.join(workdir, 'backups');
        fs.mkdirSync(inside);
        assert.throws(() => prepareAgentBackupDirectory(inside, 'production', workdir),
            /Backup directory failed deployment safety checks/);
        assert.throws(() => prepareAgentBackupDirectory(workdir, 'production', workdir),
            /Backup directory failed deployment safety checks/);
        // Windows services may start from System32 rather than the application
        // install path; backup storage under the deployment is still forbidden.
        assert.throws(() => prepareAgentBackupDirectory(
            installBackup, 'production', workdir, installed
        ), /Backup directory failed deployment safety checks/);

        const outside = prepareAgentBackupDirectory(external, 'production', workdir);
        assert.equal(outside, fs.realpathSync.native(external));
        assert.equal(verifyAgentBackupDirectory(outside, 'production', workdir), outside);

        const absent = path.join(dir, 'not-provisioned');
        assert.throws(() => prepareAgentBackupDirectory(absent, 'production', workdir),
            /Backup directory failed deployment safety checks/);
        assert.equal(fs.existsSync(absent), false, 'Production must not create unreviewed backup directories');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('non-production backup policy preserves existing isolated QA directory behavior', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-dev-backup-'));
    try {
        const result = prepareAgentBackupDirectory(undefined, 'test', dir);
        assert.equal(result, fs.realpathSync.native(path.join(dir, 'backups')));
        assert.equal(fs.statSync(result).isDirectory(), true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('production agent process refuses to sync if backup destination was not provisioned', () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-prod-no-backup-'));
    try {
        const env = {
            ...process.env,
            NODE_ENV: 'production',
            TENANT_ID: 'tenant_ci_qa',
            TENANT_API_URL: 'http://127.0.0.1:31002',
            SYSTEM_API_URL: 'http://127.0.0.1:31003',
            TENANT_AGENT_API_KEY: 'ci-only-agent-key-longer-than-thirty-two-bytes',
            CENTRAL_AGENT_API_KEY: 'ci-only-central-key-longer-than-thirty-two-bytes'
        };
        delete env.TENANT_AGENT_BACKUP_DIR;
        const proc = spawnSync(process.execPath, [entry], {
            cwd: work, env, encoding: 'utf8', timeout: 10_000
        });
        assert.notEqual(proc.status, 0, 'Production process must fail closed');
        assert.match(proc.stderr, /Tenant Agent startup refused/);
        assert.doesNotMatch(proc.stderr, /ci-only-agent-key|ci-only-central-key/);
        assert.equal(fs.existsSync(path.join(work, 'data', 'outbox.db')), false,
            'No durable outbox is opened before backup policy validation');
        assert.equal(fs.existsSync(path.join(work, 'backups')), false,
            'No insecure fallback backup directory is silently created');
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
});
