'use strict';
// Regression tests: the finished-media quality gate must refuse a video with no audio track,
// and must keep accepting a good probe and older probes that predate the hasAudio field.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'Production', 'RenderQuality_Service.js'), 'utf8'), sandbox, { filename: 'RenderQuality_Service.js' });

function evaluateJob(jobRecord) {
  sandbox.__job = jobRecord;
  return vm.runInContext('RenderQualityService.evaluate(__job)', sandbox, { filename: 'RenderQualityService' });
}

function job(probe) {
  return {
    status: 'SUCCEEDED',
    videoUrl: 'https://storage.googleapis.com/example/final.mp4',
    providerResponse: { probe: Object.assign({
      durationSeconds: 45, width: 1080, height: 1920, passesResolutionGate: true,
      passesSilenceGate: true, passesBlackFrameGate: true, clippingDetected: false,
      loudness: { integratedLufs: -14 }
    }, probe) }
  };
}

const cases = [
  ['a good probe with an audio track passes', () => {
    const result = evaluateJob(job({ hasAudio: true }));
    assert.equal(result.passed, true);
    assert.equal(result.checks.audioPresent, true);
  }],
  ['a probe with no audio track is refused, with a clear reason', () => {
    const result = evaluateJob(job({ hasAudio: false }));
    assert.equal(result.passed, false);
    assert.equal(result.checks.audioPresent, false);
    assert.ok(result.issues.some((issue) => /no audio track/.test(issue)));
  }],
  ['an older probe with no hasAudio field still passes (no retroactive failure)', () => {
    const result = evaluateJob(job({}));
    assert.equal(result.passed, true);
    assert.equal(result.checks.audioPresent, true);
  }],
];

let failed = 0;
for (const [name, run] of cases) {
  try { run(); console.log('PASS ' + name); }
  catch (error) { failed++; console.log('FAIL ' + name + ': ' + error.message); }
}
console.log('Render quality audio gate: ' + (cases.length - failed) + '/' + cases.length + ' passed.');
process.exit(failed ? 1 : 0);
