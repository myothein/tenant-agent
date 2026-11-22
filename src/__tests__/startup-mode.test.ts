import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

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
