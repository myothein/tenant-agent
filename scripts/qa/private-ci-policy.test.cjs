'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const yml=fs.readFileSync(path.resolve(__dirname,'../../.github/workflows/private-readonly-ci.yml'),'utf8');
const names=['central-service','tenant-service','db-helper','tenant-agent','agentctl','central-cli'];
const expected={
  'central-service':'d423d9fee7f3d382be8072f85cd98fc64be087e3',
  'tenant-service':'db138df1f65d3b39646106c884409129ec8f5f6d',
  'db-helper':'cd99b4508ba4674110484527525ad9b172618b4a',
  'tenant-agent':'ce06a973dfd3bde7603c604d06e5b25be1102a98',
  'agentctl':'6738bf136fc2f5e8a8e5d192ca8343160642ca9c',
  'central-cli':'e3c78a06991c9c64c39a5d57f7297605aa37a3f9'
};
const [privateJob,buildJob]=yml.split(/^  build-without-private-token:/m);
const normalize=text=>text.replace(/\r\n/g,'\n');

test('private CI runs only from owner-confirmed protected main dispatch',()=>{
  assert.match(yml,/^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(yml,/^\s{2}(?:pull_request|pull_request_target|workflow_run|push|schedule):/m);
  assert.match(privateJob,/github\.event_name == 'workflow_dispatch'/);
  assert.match(privateJob,/github\.repository == 'myothein\/tenant-agent'/);
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
  }
});

test('every external GitHub action is pinned to a full immutable commit SHA',()=>{
  const uses=[...normalize(yml).matchAll(/^\s+-?\s*uses: ([^\s#]+)/gm)].map(m=>m[1]);
  assert.ok(uses.length>=10);
  assert.ok(uses.every(a=>/^[a-z0-9-]+\/[a-z0-9-]+@[a-f0-9]{40}$/.test(a)),
    'Unpinned or external action');
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
