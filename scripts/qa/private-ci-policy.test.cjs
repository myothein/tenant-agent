'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const yml=fs.readFileSync(path.resolve(__dirname,'../../.github/workflows/private-readonly-ci.yml'),'utf8');
const names=['central-service','tenant-service','db-helper','tenant-agent','agentctl','central-cli'];
const expected={
  'central-service':'25618c6982e1c9616e9f870c764a223629c82c8a',
  'tenant-service':'eb031e08ed1137115fde5e7865a50ea498ba135d',
  'db-helper':'b45452c9eead28d1888c68d16b634e6186e95bce',
  'tenant-agent':'5fa9371496b65dc91149f40685f9f8671695e518',
  'agentctl':'6738bf136fc2f5e8a8e5d192ca8343160642ca9c',
  'central-cli':'212eec6ae12ecd8e856db9b4a22fead6ce1b3a6b'
};
const [privateJob,buildJob]=yml.split(/^  build-without-private-token:/m);
const normalize=text=>text.replace(/\r\n/g,'\n');

test('private CI runs only from owner-confirmed protected main dispatch',()=>{
  assert.match(yml,/^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(yml,/^\s{2}(?:pull_request|pull_request_target|workflow_run|push|schedule):/m);
  assert.match(privateJob,/github\.event_name == 'workflow_dispatch'/);
  assert.match(privateJob,/github\.repository == 'myothein\/tenant-agent'/);
  assert.match(privateJob,/github\.actor == 'myothein'/);
  assert.match(privateJob,/github\.ref == 'refs\/heads\/main'/);
  assert.match(privateJob,/AUTHORIZE-READONLY-QA/);
  assert.match(privateJob,/^    environment: gtsp-private-ci$/m);
});

test('narrow ephemeral GitHub App token exists only in checkout job',()=>{
  assert.match(privateJob,/uses: actions\/create-github-app-token@[a-f0-9]{40}/);
  assert.match(privateJob,/permission-contents: read/);
  assert.match(privateJob,/private-key: \$\{\{ secrets\.GTSP_CI_APP_PRIVATE_KEY \}\}/);
  assert.match(privateJob,/client-id: \$\{\{ vars\.GTSP_CI_APP_CLIENT_ID \}\}/);
  assert.match(privateJob,/owner: myothein/);
  assert.doesNotMatch(privateJob,/skip-token-revoke: true/);
  assert.doesNotMatch(privateJob,/npm (?:ci|run|test|install)/);
  assert.doesNotMatch(privateJob,/node (?:src|scripts|dist)/);
  assert.ok(buildJob);
  assert.doesNotMatch(buildJob,/\bsecrets\./);
  assert.doesNotMatch(buildJob,/\bvars\./);
  assert.doesNotMatch(buildJob,/readonly-app\.outputs\.token/);
  assert.doesNotMatch(buildJob,/create-github-app-token/);
  assert.doesNotMatch(buildJob,/^    environment:/m);
});

test('exactly six audited source checkouts with immutable SHA and no persisted token',()=>{
  const checkouts=[...privateJob.matchAll(/repository: myothein\/([a-z-]+)\n\s+ref: ([a-f0-9]{40})\n\s+path: snapshot\/([a-z-]+)\n\s+token: \$\{\{ steps\.readonly-app\.outputs\.token \}\}\n\s+persist-credentials: false/g)];
  assert.equal(checkouts.length,6);
  assert.deepEqual(checkouts.map(m=>m[1]).sort(),[...names].sort());
  for(const match of checkouts){
    assert.equal(match[1],match[3],'Repository and local directory differ');
    assert.equal(match[2],expected[match[1]],'Unaudited Git ref for '+match[1]);
  }
  for(const name of names){
    assert.match(privateJob,new RegExp('^            '+name+'$','m'));
    // Verify the here-doc matches each immutable checkout ref.
    assert.match(privateJob,new RegExp('^          '+name+' '+expected[name]+'$','m'));
  }
});

test('every external GitHub action is pinned to a full immutable commit SHA',()=>{
  const uses=[...normalize(yml).matchAll(/^\s+-?\s*uses: ([^\s#]+)/gm)].map(m=>m[1]);
  assert.ok(uses.length>=10);
  assert.ok(uses.every(a=>/^[a-z0-9-]+\/[a-z0-9-]+@[a-f0-9]{40}$/.test(a)),
    'Unpinned or external action');
});

test('privileged scan rejects tracked secrets and backup archives',()=>{
  assert.match(privateJob,/git -C "snapshot\/\$name" ls-files -z/);
  assert.match(privateJob,/\.npmrc\|\*\/\.npmrc/);
  assert.match(privateJob,/\*\.pem\|\*\.p12\|\*\.pfx\|\*\.key/);
  assert.match(privateJob,/\*\.db-\*/);
  assert.match(privateJob,/\*\.dump\|\*\.backup/);
  assert.match(privateJob,/Audited source tracks authentication material/);
  assert.match(privateJob,/Audited source tracks runtime or backup artifacts/);
  assert.doesNotMatch(privateJob,/grep -Ev/);
  assert.match(privateJob,/--exclude='\.npmrc'/);
  assert.match(privateJob,/--exclude='\*\.key'/);
  assert.match(privateJob,/--exclude='\*\.backup'/);
  assert.match(buildJob,/\(mybackup\|backups\)/);
  assert.match(buildJob,/\(pem\|p12\|pfx\|key\|dump\|backup\|db\|sqlite\|sqlite3\)/);
});

test('source and build jobs are isolated through short-lived token-free artifact',()=>{
  assert.match(privateJob,/--exclude=\.git/);
  assert.match(privateJob,/--exclude='\.env'/);
  assert.match(privateJob,/--exclude='\*\.db'/);
  assert.match(privateJob,/retention-days: 1/);
  assert.match(buildJob,/needs: fetch-audited-sources/);
  assert.match(buildJob,/tar -tzf/);
  assert.match(buildJob,/tar -xzf/);
  assert.match(buildJob,/npm ci --ignore-scripts/);
  assert.match(buildJob,/node-version: '22'/);
  assert.match(yml,/^permissions:\n  contents: read/m);
});
