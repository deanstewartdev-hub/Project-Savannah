'use strict';
// Regression tests for the bridge self-test: the probe sends the secret only in the body, never
// returns it, refuses a non-/exec URL, and is not reachable as a top-level (google.script.run) function.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const SECRET = 'synthetic-probe-secret-DO-NOT-LEAK';
const BRIDGE = 'https://script.google.com/macros/s/AKfycbTestDeployment/exec';

function load(fetchImpl) {
  const sandbox = {
    Secrets: { getMediaWorkerSharedSecret: () => SECRET },
    UrlFetchApp: { fetch: fetchImpl },
    JSON
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'Production', 'MediaWorkerProbe_Service.js'), 'utf8'), sandbox, { filename: 'MediaWorkerProbe_Service.js' });
  return { MediaWorkerProbeService: vm.runInContext('MediaWorkerProbeService', sandbox) };
}

function responder(status, body) {
  const calls = [];
  const fetch = (url, options) => {
    calls.push({ url, options });
    return { getResponseCode: () => status, getContentText: () => JSON.stringify(body) };
  };
  return { fetch, calls };
}

const cases = [
  ['a bridge that accepts the secret reports verified', () => {
    const r = responder(200, { success: true, verified: true });
    const result = load(r.fetch).MediaWorkerProbeService.probeBridge(BRIDGE);
    assert.equal(result.verified, true);
  }],
  ['the secret is sent only in the body, never in the URL', () => {
    const r = responder(200, { success: true, verified: true });
    load(r.fetch).MediaWorkerProbeService.probeBridge(BRIDGE);
    assert.ok(!r.calls[0].url.includes(SECRET));
    assert.equal(JSON.parse(r.calls[0].options.payload).callbackSecret, SECRET);
    assert.equal(r.calls[0].url, BRIDGE + '?route=verify');
  }],
  ['the result never contains the secret', () => {
    const r = responder(401, { success: false, error: 'Unauthorized.' });
    const result = load(r.fetch).MediaWorkerProbeService.probeBridge(BRIDGE);
    assert.equal(result.verified, false);
    assert.ok(!JSON.stringify(result).includes(SECRET));
  }],
  ['a bridge that refuses reports not verified', () => {
    const r = responder(200, { success: false, error: 'Unauthorized.' });
    assert.equal(load(r.fetch).MediaWorkerProbeService.probeBridge(BRIDGE).verified, false);
  }],
  ['a URL that is not an /exec address is refused before any request', () => {
    const r = responder(200, { success: true, verified: true });
    const service = load(r.fetch).MediaWorkerProbeService;
    for (const bad of ['http://script.google.com/macros/s/x/exec', BRIDGE + '?secret=x', 'https://example.test/exec', '']) {
      assert.equal(service.probeBridge(bad).verified, false, 'accepted ' + bad);
    }
    assert.equal(r.calls.length, 0);
  }],
  ['the probe is not a top-level function google.script.run could call', () => {
    const source = fs.readFileSync(path.join(root, 'Production', 'MediaWorkerProbe_Service.js'), 'utf8');
    assert.ok(!/^function\s+probeBridge/m.test(source));
    assert.ok(/const MediaWorkerProbeService/.test(source));
  }],
  ['the editor entry point returns only PASS or FAIL and reads only the stored bridge URL', () => {
    const source = fs.readFileSync(path.join(root, 'Production', 'MediaWorkerProbe_Service.js'), 'utf8');
    assert.ok(/^function runBridgeSecretProbe()/m.test(source), 'top-level entry point must be listed by the editor (no trailing underscore)');
    assert.ok(!source.includes('runBridgeSecretProbe_('), 'no underscore-suffixed entry point may remain');
    assert.ok(source.includes('Secrets.getMediaWorkerCallbackUrl()'));
  }],
];

let failed = 0;
for (const [name, run] of cases) {
  try { run(); console.log('PASS ' + name); }
  catch (error) { failed++; console.log('FAIL ' + name + ': ' + error.message); }
}
console.log('Bridge self-test probe: ' + (cases.length - failed) + '/' + cases.length + ' passed.');
process.exit(failed ? 1 : 0);
