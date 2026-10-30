'use strict';
// Regression tests for the production error contract. These load the real rule table (the
// refresh-safety tests mock this service), so the message-to-recovery mapping is checked directly.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'Production', 'ProductionError_Service.js'), 'utf8'), sandbox, { filename: 'ProductionError_Service.js' });

function classify(message) {
  sandbox.__caught = new Error(message);
  return vm.runInContext('ProductionErrorService.normalise(__caught, "test")', sandbox, { filename: 'ProductionErrorService' });
}

const cases = [
  ['a malformed worker callback is reported as a worker result problem, not an internal error', 'Malformed callback: completed without an https video URL.', 'PRODUCTION_WORKER_RESULT_INVALID'],
  ['an unauthorised callback is reported as an authorisation problem', 'Unauthorized.', 'PROVIDER_AUTH_REQUIRED'],
  ['a rate limit is retryable after a minute', 'ElevenLabs returned 429 rate limit', 'PROVIDER_RATE_LIMITED'],
  ['a duplicate submission is refused with the existing render', 'This Short is already being submitted. The duplicate submission was prevented.', 'PRODUCTION_BUSY'],
  ['an uncertain upload asks for a YouTube Studio check, not a retry', 'This upload ended in an uncertain state. Check YouTube Studio, then reconcile each uncertain attempt before retrying.', 'PRODUCTION_UPLOAD_UNCERTAIN'],
  ['a quality failure names the correction', 'Render quality check failed: Finished video is not vertical.', 'PRODUCTION_QUALITY_BLOCKED'],
];

let failed = 0;
for (const [name, message, expectedCode] of cases) {
  try {
    const result = classify(message);
    assert.equal(result.code, expectedCode, 'classified as ' + result.code);
    assert.ok(result.recoveryAction && result.recoveryAction.length > 0, 'a recovery action is required');
    console.log('PASS ' + name);
  } catch (error) {
    failed++;
    console.log('FAIL ' + name + ': ' + error.message);
  }
}
console.log('Production error contract: ' + (cases.length - failed) + '/' + cases.length + ' passed.');
process.exit(failed ? 1 : 0);
