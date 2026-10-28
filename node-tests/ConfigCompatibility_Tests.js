'use strict';
// Contracts that span the media worker, the callback bridge and the main app.
// Each side defines its own copy; if any one drifts, callbacks silently stop
// matching. Definitions are read from the real sources, not restated here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }

function regexFrom(file, pattern) {
  const match = pattern.exec(read(file));
  assert.ok(match, 'Could not find the render ID pattern in ' + file + ' (update this test if it moved).');
  return new RegExp(match[1], match[2] || '');
}

test('a render ID reserved by the main app is accepted by every validator in all three components', () => {
  // The REAL reserveRenderId (PR #19), with Apps Script's lowercase UUIDs.
  const context = vm.createContext({ Utilities: { getUuid: () => randomUUID() }, Logger: { log() {} } });
  vm.runInContext(read('Production/VideoProcessingProvider.js'), context);
  const ids = Array.from({ length: 25 }, () => vm.runInContext('CloudRunFFmpegProvider.reserveRenderId()', context));
  const validators = {
    'media-worker dispatcher.js': regexFrom('media-worker/src/dispatcher.js', /validJobIdShape = [^;]*\/(\^cr-[^/]+)\/([a-z]*)\.test/),
    'media-worker jobStatus.js': regexFrom('media-worker/src/lib/jobStatus.js', /JOB_ID_PATTERN = \/(.+)\/([a-z]*);/),
    'CallbackBridge.js': regexFrom('CallbackBridge/CallbackBridge.js', /RENDER_ID_PATTERN = \/(.+)\/([a-z]*);/),
    'MediaWorkerCallbackInbox_Service.js': regexFrom('Production/MediaWorkerCallbackInbox_Service.js', /const RENDER_ID = \/(.+)\/([a-z]*);/),
    'VideoProcessingProvider.js (reserved shape)': regexFrom('Production/VideoProcessingProvider.js', /RESERVED_ID_SHAPE = \/(.+)\/([a-z]*);/)
  };
  for (const id of ids) {
    for (const [name, regex] of Object.entries(validators)) {
      assert.ok(regex.test(id), name + ' rejects reserved render ID ' + id);
    }
  }
});

test('the worker stores the video where the link-refresh rule expects it: renders/<renderId>/final.mp4', () => {
  assert.match(read('media-worker/src/pipeline/deliver.js'), /const videoDestination = `renders\/\$\{jobId\}\/final\.mp4`;/);
  assert.match(read('Production/VideoLink_Service.js'), /"renders\/" \+ current\.renderId \+ "\/final\.mp4"/);
  assert.match(read('node-tests/staging/send-synthetic-callback.cjs'), /'renders\/' \+ renderId \+ '\/final\.mp4'/);
});

test('the callback secret has the same property name in the main app and the bridge', () => {
  assert.match(read('Services/Services_Secrets.js'), /getProperty\("MEDIA_WORKER_SHARED_SECRET"\)/);
  assert.match(read('CallbackBridge/CallbackBridge.js'), /getProperty\("MEDIA_WORKER_SHARED_SECRET"\)/);
});

test('the main app sends the job-submission secret the way the worker checks it (Bearer)', () => {
  assert.match(read('Production/VideoProcessingProvider.js'), /Authorization: "Bearer " \+ submitSecret_\(\)/);
  const auth = read('media-worker/src/lib/auth.js');
  assert.match(auth, /startsWith\("Bearer "\)/);
  assert.match(read('media-worker/src/dispatcherConfig.js'), /requireSecretEnv\("JOB_SUBMIT_SECRET"\)/);
});

test('the callback URL carries no secret; the secret travels in the job body and the bridge reads it there', () => {
  const provider = read('Production/VideoProcessingProvider.js');
  assert.ok(provider.includes('return webAppUrl + "?route=media-worker-callback";'));
  assert.ok(!provider.includes('encodeURIComponent(callbackSecret_())'));
  assert.ok(provider.includes('callbackSecret: callbackSecret_()'));
  const bridge = read('CallbackBridge/CallbackBridge.js');
  assert.ok(bridge.includes('route === "media-worker-callback"'));
  assert.ok(bridge.includes('isAuthorizedCallback_({ secret: body.callbackSecret }'));
});

test('the bridge persists every field the worker sends and the inbox reads', () => {
  const runJob = read('media-worker/src/pipeline/runJob.js');
  for (const field of ['jobId', 'status: "completed"', 'video: {', 'url: delivery.videoUrl', 'gcsPath: delivery.gcsPath', 'probe: {']) {
    assert.ok(runJob.includes(field), 'worker payload no longer has ' + field);
  }
  assert.match(read('media-worker/src/job-runner.js'), /status: "failed",\s*error: \{ message: renderError\.message \}/);
  const persisted = /var payload = JSON\.stringify\(\{([\s\S]*?)\}\);/.exec(read('CallbackBridge/CallbackBridge.js'))[1];
  for (const field of ['jobId', 'status', 'video', 'probe', 'error']) assert.match(persisted, new RegExp('\\b' + field + ':'), 'bridge drops ' + field);
  const inbox = read('Production/MediaWorkerCallbackInbox_Service.js');
  assert.match(inbox, /body\.video/);
  assert.match(inbox, /body\.error && body\.error\.message/);
});

test('every property the readiness check inspects is a property the app actually uses', () => {
  const secrets = read('Services/Services_Secrets.js');
  const readiness = read('Production/ReleaseReadiness_Service.js');
  // Plain properties are read with property("X"); secrets go through secret_(add, e, "X", ...).
  const names = Array.from(readiness.matchAll(/(?:property\(|secret_\(add, e, )"([A-Z_]+)"/g)).map(m => m[1]);
  assert.ok(names.length >= 5);
  for (const name of names.filter(n => n !== 'PRODUCTION_QUEUE_ENABLED')) {
    assert.ok(secrets.includes('"' + name + '"'), 'readiness checks ' + name + ', which Services_Secrets.js never reads');
  }
  assert.match(read('Production/ProductionQueue_Service.js'), /"PRODUCTION_QUEUE_ENABLED"/);
});

test('the staging marker has one spelling everywhere it is checked', () => {
  for (const file of ['Utils/EnvironmentGuard.js', 'CallbackBridge/CallbackBridge.js', 'Production/StagingVerification_Service.js']) {
    assert.match(read(file), /"SAVANNAH_ENVIRONMENT"\)?\s*(===|!==)\s*"staging"|getProperty\("SAVANNAH_ENVIRONMENT"\) !== "staging"/, file);
  }
});

console.log(`Configuration compatibility: ${passed}/${passed} passed.`);
