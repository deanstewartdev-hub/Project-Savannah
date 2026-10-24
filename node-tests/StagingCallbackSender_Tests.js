'use strict';
// Guard tests for node-tests/staging/send-synthetic-callback.cjs. Every case
// here must be refused BEFORE any network request is attempted (exit code 2).
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.join(__dirname, 'staging', 'send-synthetic-callback.cjs');
const STAGING_URL = 'https://script.google.com/macros/s/AKfycbSTAGINGexample123/exec';
const PROD_URL = 'https://script.google.com/macros/s/AKfycbzfD4HhW82TJyrdl5wteB1L84uiQJqb_hANd106zLDOOpY4HKqclGv67noe-kpQn2vDDw/exec';
const RENDER = 'cr-7d0f6a52-3c1e-4b8a-9f2d-5e6a7b8c9d0e';
let passed = 0;

function run(args, env) {
  // A fetch that throws proves no request was made if a guard is missing.
  const result = spawnSync(process.execPath,
    ['--require', path.join(__dirname, 'staging', 'no-network.cjs'), script].concat(args), {
      env: Object.assign({ PATH: process.env.PATH }, env), encoding: 'utf8'
    });
  return { code: result.status, output: result.stdout + result.stderr };
}

function refused(name, args, env, pattern) {
  const result = run(args, env);
  assert.equal(result.code, 2, name + ': expected refusal exit 2, got ' + result.code + ' ' + result.output);
  assert.match(result.output, pattern, name);
  assert.doesNotMatch(result.output, /NETWORK_ATTEMPTED/, name + ': a request was attempted.');
  passed++;
  console.log('PASS ' + name);
}

const env = { SAVANNAH_STAGING_BRIDGE_URL: STAGING_URL, SAVANNAH_STAGING_CALLBACK_SECRET: 'synthetic-staging-secret' };
refused('requires explicit staging flag', ['completed', RENDER], env, /--i-am-targeting-staging/);
refused('refuses the production deployment', ['--i-am-targeting-staging', 'completed', RENDER],
  Object.assign({}, env, { SAVANNAH_STAGING_BRIDGE_URL: PROD_URL }), /PRODUCTION/);
refused('requires the bridge URL', ['--i-am-targeting-staging', 'completed', RENDER],
  { SAVANNAH_STAGING_CALLBACK_SECRET: 'x' }, /BRIDGE_URL is not set/);
refused('requires the secret', ['--i-am-targeting-staging', 'completed', RENDER],
  { SAVANNAH_STAGING_BRIDGE_URL: STAGING_URL }, /SECRET is not set/);
refused('rejects a URL with a query string', ['--i-am-targeting-staging', 'completed', RENDER],
  Object.assign({}, env, { SAVANNAH_STAGING_BRIDGE_URL: STAGING_URL + '?secret=leak' }), /bare https/);
refused('rejects a non-Apps-Script host', ['--i-am-targeting-staging', 'completed', RENDER],
  Object.assign({}, env, { SAVANNAH_STAGING_BRIDGE_URL: 'https://evil.example/macros/s/x/exec' }), /bare https/);
refused('rejects a malformed render ID', ['--i-am-targeting-staging', 'completed', 'RND-123'], env, /cr-<uuid>/);
refused('rejects an unknown scenario', ['--i-am-targeting-staging', 'explode', RENDER], env, /unknown scenario/);

// Positive control: a valid staging invocation does reach fetch, so the
// refusals above are real guards rather than an always-failing script.
{
  const result = run(['--i-am-targeting-staging', 'completed', RENDER], env);
  assert.equal(result.code, 1);
  assert.match(result.output, /NETWORK_ATTEMPTED/);
  assert.doesNotMatch(result.output, /synthetic-staging-secret/, 'Secret was printed.');
  passed++;
  console.log('PASS valid staging invocation reaches the network layer without printing the secret');
}

console.log(`Staging callback sender guards: ${passed}/${passed} passed.`);
