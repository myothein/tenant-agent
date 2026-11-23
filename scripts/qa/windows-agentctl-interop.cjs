#!/usr/bin/env node
'use strict';

// This integration probe has no service-control or production filesystem rights.
// It proves incompatible packaging is rejected BEFORE agentctl asks NSSM/SCM to
// modify any Windows service. A separate signed EXE packaging acceptance is needed.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

assert.equal(process.platform,'win32','Windows QA only');
assert.equal(process.env.CI,'true','Hosted CI only');
assert.equal(process.env.RUNNER_OS,'Windows','Hosted Windows CI only');
assert.equal(process.env.GITHUB_ACTIONS,'true','GitHub Actions CI only');
assert.equal(process.env.GITHUB_HEAD_REF,'hardening/release-security-baseline-20261122');

const root=path.resolve('.');
const ctlRoot=path.join(root,'integration','agentctl');
const compiledAgent=path.join(root,'dist','index.js');
const compiledCtl=path.join(ctlRoot,'dist','index.js');
const expectedExe=path.join(root,'dist','tenant-agent.exe');
const {installNewService}=require(path.join(ctlRoot,'dist','core','agent','safe-install.js'));

function cliHelp(directory,entry){
    const result=spawnSync(process.execPath,[entry,'--help'],{
        cwd:directory,windowsHide:true,encoding:'utf8',timeout:10000,
        stdio:['ignore','pipe','pipe']
    });
    assert.equal(result.status,0,'CLI --help must exit 0');
}
async function main(){
    assert(fs.existsSync(compiledAgent),'Compiled tenant-agent Node entrypoint missing');
    assert(fs.existsSync(compiledCtl),'Compiled agentctl Node entrypoint missing');
    cliHelp(root,compiledAgent);
    cliHelp(ctlRoot,compiledCtl);
    // This repository does not currently publish a signed executable at the
    // path expected by agentctl install (C:\Program Files\TenantAgent\bin).
    // Do not treat a working JS CLI as proof of native Windows service packaging.
    assert(!fs.existsSync(expectedExe),
        'New tenant-agent.exe detected: review signed packaging and replace this preflight test');
    const observed=[];
    const binDir=path.join(root,'dist');
    await assert.rejects(
        installNewService({
            serviceName:'GTSPAgentInteropCI',
            agentExe:expectedExe,
            ctlExe:compiledCtl,
            nssmExe:path.join(binDir,'nssm.exe'),
            binDir,
            configFile:path.join(root,'synthetic-ci-config.env'),
            // Simulate other prerequisites present while preserving the real
            // filesystem check for the missing executable.
            fileExists:p=>p===expectedExe?fs.existsSync(p):true,
            run:async args=>{
                observed.push(args);
                throw Error('Installer must not invoke NSSM/SCM');
            }
        }),
        /Install prerequisite missing/
    );
    assert.deepEqual(observed,[],
        'Missing signed EXE must be rejected without any Windows service command');
    console.log('PASS Windows interop: both CLIs compile, missing signed tenant-agent EXE blocks service registration before SCM');
}
main().catch(()=>{
    console.error('Windows agentctl/tenant-agent compatibility gate FAILED');
    process.exitCode=1;
});
