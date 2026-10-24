'use strict';
// ReleaseReadinessService: the read-only preflight that catches deployment
// misconfiguration before it breaks callbacks, renders or uploads.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'Production/ReleaseReadiness_Service.js'), 'utf8'), context);
const service = vm.runInContext('ReleaseReadinessService', context);

const MAIN = 'https://script.google.com/macros/s/AKfycbMAINxxxxxxxx/exec';
const BRIDGE = 'https://script.google.com/macros/s/AKfycbBRIDGEyyyyyy/exec';
const NOW = Date.parse('2026-10-21T12:00:00Z');
const SECRET = 'a-real-looking-secret-value-123';

function env(overrides) {
  const o = overrides || {};
  const props = Object.assign({
    VIDEO_PROVIDER: 'cloud-run', MEDIA_WORKER_URL: 'https://dispatcher-abc.a.run.app',
    MEDIA_WORKER_JOB_SUBMIT_SECRET: SECRET, MEDIA_WORKER_SHARED_SECRET: SECRET + '-cb',
    MEDIA_WORKER_CALLBACK_URL: BRIDGE
  }, o.props || {});
  return {
    property: name => (name in props ? props[name] : null),
    ownWebAppUrl: () => ('ownUrl' in o ? o.ownUrl : MAIN),
    inboxReport: () => {
      if (o.inboxThrows) throw new Error('Sheet unavailable');
      return Object.assign({ spreadsheetId: '1AbCdEfGh123456', inboxSheetPresent: true, headersMatch: true,
        pending: 0, pendingWithErrors: 0, oldestPendingReceivedAt: '' }, o.inbox || {});
    },
    queueTriggerCount: () => { if (o.triggers === 'noscope') throw new Error('scope'); return o.triggers || 0; },
    now: () => NOW
  };
}
const check = (report, id) => report.checks.find(c => c.id === id) || {};

test('fully configured bridge setup is READY', () => {
  const report = service.run(env());
  assert.equal(report.status, 'READY', JSON.stringify(report.checks));
});

test('callback URL pointing at the main app is a BLOCKER (MYSELF access)', () => {
  const report = service.run(env({ props: { MEDIA_WORKER_CALLBACK_URL: MAIN } }));
  assert.equal(report.status, 'BLOCKED');
  assert.equal(check(report, 'callback-url').level, 'block');
  assert.match(check(report, 'callback-url').message, /MYSELF/);
});

test('missing or malformed callback URL blocks', () => {
  assert.equal(check(service.run(env({ props: { MEDIA_WORKER_CALLBACK_URL: '' } })), 'callback-url').level, 'block');
  assert.equal(check(service.run(env({ props: { MEDIA_WORKER_CALLBACK_URL: BRIDGE + '?secret=x' } })), 'callback-url').level, 'block');
  assert.equal(check(service.run(env({ props: { MEDIA_WORKER_CALLBACK_URL: 'https://evil.example/exec' } })), 'callback-url').level, 'block');
});

test('unknown own URL or editor /dev context downgrades the callback check to a warning, not a pass', () => {
  // From the editor, getUrl() is the /dev URL: comparing it would falsely pass a main-app callback URL.
  assert.equal(check(service.run(env({ ownUrl: 'https://script.google.com/macros/s/AKfycbDEVzzzz/dev', props: { MEDIA_WORKER_CALLBACK_URL: MAIN } })), 'callback-url').level, 'warn');
  assert.equal(check(service.run(env({ ownUrl: '' })), 'callback-url').level, 'warn');
});

test('missing secrets block; secrets with CR/LF or spaces block', () => {
  assert.equal(check(service.run(env({ props: { MEDIA_WORKER_SHARED_SECRET: null } })), 'MEDIA_WORKER_SHARED_SECRET').level, 'block');
  for (const bad of [SECRET + '\r\n', ' ' + SECRET, SECRET + '\t']) {
    const report = service.run(env({ props: { MEDIA_WORKER_JOB_SUBMIT_SECRET: bad } }));
    assert.equal(check(report, 'MEDIA_WORKER_JOB_SUBMIT_SECRET').level, 'block', JSON.stringify(bad));
  }
});

test('report never contains a secret value or the worker URL path', () => {
  const report = service.run(env({ props: { MEDIA_WORKER_JOB_SUBMIT_SECRET: SECRET + '\n', MEDIA_WORKER_URL: 'https://dispatcher-abc.a.run.app/jobs?token=zzz' } }));
  const text = JSON.stringify(report);
  assert.equal(text.includes(SECRET), false, 'Secret leaked into report.');
  assert.equal(text.includes('token=zzz'), false, 'URL query leaked into report.');
});

test('missing or non-https worker URL blocks', () => {
  assert.equal(check(service.run(env({ props: { MEDIA_WORKER_URL: '' } })), 'media-worker-url').level, 'block');
  assert.equal(check(service.run(env({ props: { MEDIA_WORKER_URL: 'http://x.example' } })), 'media-worker-url').level, 'block');
});

test('creatomate provider warns and skips worker checks', () => {
  const report = service.run(env({ props: { VIDEO_PROVIDER: 'creatomate', MEDIA_WORKER_URL: '' } }));
  assert.equal(check(report, 'video-provider').level, 'warn');
  assert.equal(report.checks.some(c => c.id === 'media-worker-url'), false);
});

test('inbox: unreadable blocks, schema mismatch blocks, missing tab warns', () => {
  assert.equal(check(service.run(env({ inboxThrows: true })), 'callback-inbox').level, 'block');
  assert.equal(check(service.run(env({ inbox: { headersMatch: false } })), 'callback-inbox').level, 'block');
  assert.equal(check(service.run(env({ inbox: { inboxSheetPresent: false } })), 'callback-inbox').level, 'warn');
});

test('inbox: stale or failing pending receipts warn; fresh pending is ok', () => {
  const stale = service.run(env({ inbox: { pending: 2, oldestPendingReceivedAt: '2026-10-21T09:00:00.000Z' } }));
  assert.equal(check(stale, 'callback-inbox').level, 'warn');
  const failing = service.run(env({ inbox: { pending: 1, pendingWithErrors: 1, oldestPendingReceivedAt: '2026-10-21T11:59:00.000Z' } }));
  assert.equal(check(failing, 'callback-inbox').level, 'warn');
  const fresh = service.run(env({ inbox: { pending: 1, oldestPendingReceivedAt: '2026-10-21T11:59:00.000Z' } }));
  assert.equal(check(fresh, 'callback-inbox').level, 'ok');
});

test('spreadsheet identity is reported by last 6 characters only', () => {
  const message = check(service.run(env()), 'spreadsheet').message;
  assert.match(message, /123456/);
  assert.equal(message.includes('1AbCdEfGh123456'), false);
});

test('queue: enabled without trigger warns; unverifiable scope warns only when enabled', () => {
  assert.equal(check(service.run(env({ props: { PRODUCTION_QUEUE_ENABLED: 'true' }, triggers: 0 })), 'queue-trigger').level, 'warn');
  assert.equal(check(service.run(env({ props: { PRODUCTION_QUEUE_ENABLED: 'true' }, triggers: 1 })), 'queue-trigger').level, 'ok');
  assert.equal(check(service.run(env({ triggers: 'noscope' })), 'queue-trigger').level, 'ok');
  assert.equal(check(service.run(env({ props: { PRODUCTION_QUEUE_ENABLED: 'true' }, triggers: 'noscope' })), 'queue-trigger').level, 'warn');
  assert.equal(check(service.run(env({ triggers: 2 })), 'queue-trigger').level, 'warn');
});

test('main manifest still deploys with MYSELF (the assumption the callback check relies on)', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'appsscript.json'), 'utf8'));
  assert.equal(manifest.webapp.access, 'MYSELF');
});

test('service source performs no writes or network calls', () => {
  const source = fs.readFileSync(path.join(root, 'Production/ReleaseReadiness_Service.js'), 'utf8');
  assert.doesNotMatch(source, /setProperty|deleteProperty|setValue|newTrigger|deleteTrigger|UrlFetchApp/);
});

console.log(`Release readiness: ${passed}/${passed} passed.`);
