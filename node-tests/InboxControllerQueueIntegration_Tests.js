'use strict';
// Integration tests for PR #12 + #13 + #14 together: the REAL callback inbox
// (MediaWorkerCallbackInbox) wired into the REAL ProductionController refresh
// paths and the REAL ProductionQueueService tick, with the REAL ScenePlanService
// whose legacy estimate gate is now advisory. Sheets, providers and the
// network are in-memory fakes; nothing leaves the process.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
let passed = 0;

function test(name, run) {
  run();
  passed++;
  console.log('PASS ' + name);
}

const HEADERS = ['Receipt ID', 'Render ID', 'Status', 'Payload JSON', 'Received At', 'Handled At', 'Result'];
const RENDER_ID = 'cr-7d0f6a52-3c1e-4b8a-9f2d-5e6a7b8c9d0e';
const VIDEO_URL = 'https://storage.googleapis.com/savannah-media/renders/integration.mp4?X-Goog-Signature=abc';
const clone = value => JSON.parse(JSON.stringify(value));

function inboxSheet(rows, headers) {
  const data = [headers || HEADERS.slice()].concat(rows);
  return {
    data,
    getLastRow: () => data.length,
    getRange: (row, col, numRows, numCols) => ({
      getValues: () => data.slice(row - 1, row - 1 + numRows).map(r => r.slice(col - 1, col - 1 + numCols)),
      getDisplayValues: () => data.slice(row - 1, row - 1 + numRows).map(r => r.slice(col - 1, col - 1 + numCols).map(String)),
      setValues: values => values.forEach((v, i) => v.forEach((cell, j) => { data[row - 1 + i][col - 1 + j] = cell; }))
    })
  };
}

function receipt(status, body) {
  const payload = body || (status === 'completed' ?
    { jobId: RENDER_ID, status, video: { url: VIDEO_URL }, probe: { durationSeconds: 41 }, error: {} } :
    { jobId: RENDER_ID, status, video: {}, probe: {}, error: { message: 'Worker failed.' } });
  return [randomUUID(), RENDER_ID, status, JSON.stringify(payload), new Date(), '', ''];
}

// One shared sandbox per scenario: real inbox + real model + the module under test.
function sandbox(options) {
  const opts = options || {};
  const sheet = inboxSheet(opts.receipts || [], opts.headers);
  let job = clone(Object.assign({
    id: 'RND-INT1', renderId: RENDER_ID, scriptId: 'SCR-INT', templateId: 'cloud-run-worker',
    seoPackId: 'SEO-INT', status: 'RENDERING', progress: 30, videoUrl: '', snapshotUrl: '',
    errorMessage: '', requestPayload: {}, providerResponse: {}, version: 1,
    createdAt: '2026-10-21T01:00:00.000Z', updatedAt: '2026-10-21T01:01:00.000Z'
  }, opts.job || {}));
  const events = [];
  let lockHeld = false, renderWrites = 0, warnings = [];
  const context = vm.createContext({
    console, Logger: { log() {} },
    Utilities: { getUuid: randomUUID },
    UrlFetchApp: { fetch() { throw new Error('Network access is forbidden in integration tests.'); } },
    LockService: { getScriptLock: () => ({
      tryLock: () => {
        if (opts.busy || lockHeld) return false;
        lockHeld = true; events.push('lock'); return true;
      },
      releaseLock: () => { lockHeld = false; events.push('unlock'); }
    }) },
    LoggingService: {
      STATUS: { WARNING: 'Warning' }, started() {}, success() {}, failure() {},
      log: entry => warnings.push(entry)
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: name => name === 'Render Callback Inbox' ? sheet : null }) },
    ProductionErrorService: {
      normalise: caught => ({ message: String(caught.message || caught), statusCode: 400 }),
      recordOccurrence: issue => issue
    },
    RenderJobRepository: {
      getById: id => id === job.id ? clone(job) : null,
      getByRenderId: renderId => renderId === job.renderId ? clone(job) : null,
      getAll: () => [clone(job)],
      update: value => { renderWrites++; events.push('render-write:' + value.status); job = clone(value); return clone(job); }
    },
    VideoProcessingProvider: { forJob: () => ({ getRender() {
      events.push('poll');
      if (opts.onPoll) opts.onPoll(sheet);
      return clone(opts.pollResponse || { status: 'rendering', progress: 55, url: '' });
    } }) },
    RenderQualityService: {}, RenderReviewService: {}, PublishingJobRepository: {},
    SeoRepository: {}, ScriptsRepository: {}, ProductionTaskRepository: opts.tasks || {},
    Secrets: {}, SHEETS: {},
    ProductionController: opts.stubController
  });
  for (const source of ['Models/RenderJob.js', 'Production/MediaWorkerCallbackInbox_Service.js',
    'Production/ScenePlan_Service.js', 'Production/ProductionQueue_Service.js'].concat(opts.stubController ? [] : ['App/ProductionController.js'])) {
    vm.runInContext(fs.readFileSync(path.join(root, source), 'utf8'), context, { filename: source });
  }
  return {
    context, sheet, events, warnings: () => warnings,
    call: code => vm.runInContext(code, context, { timeout: 10000 }),
    job: () => clone(job), renderWrites: () => renderWrites, lockHeld: () => lockHeld
  };
}

const result = (s, i) => s.sheet.data[i + 1][6];

// ---------- Controller + inbox (PR #12 stale-write guard + PR #14 inbox) ----------

test('Manual refresh applies a queued completion before polling and skips the provider', () => {
  const s = sandbox({ receipts: [receipt('completed')] });
  const response = s.call('ProductionController.refresh({jobId:"RND-INT1"})');
  assert.equal(response.success, true);
  assert.equal(response.data.job.status, 'SUCCEEDED');
  assert.equal(response.data.job.videoUrl, VIDEO_URL);
  assert.equal(s.events.includes('poll'), false, 'Terminal render must not be polled.');
  assert.equal(result(s, 0), 'APPLIED');
  assert.equal(s.lockHeld(), false);
});

test('Callback receipt landing mid-poll wins over the stale provider result', () => {
  const s = sandbox({
    onPoll: sheet => sheet.data.push(receipt('completed')),
    pollResponse: { status: 'failed', progress: 30, url: '', error_message: 'Stale failure' }
  });
  const response = s.call('ProductionController.refresh({jobId:"RND-INT1"})');
  assert.equal(response.success, true);
  assert.equal(s.job().status, 'SUCCEEDED', 'Stale poll overwrote the callback.');
  assert.equal(s.job().videoUrl, VIDEO_URL);
  assert.equal(s.renderWrites(), 1, 'Only the receipt may write the render.');
  assert.deepEqual(s.events.filter(e => e.startsWith('render-write')), ['render-write:SUCCEEDED']);
});

test('Duplicate completion receipts through refreshActive write the render exactly once', () => {
  const s = sandbox({ receipts: [receipt('completed'), receipt('completed'), receipt('failed')] });
  const response = s.call('ProductionController.refreshActive()');
  assert.equal(response.success, true);
  assert.equal(s.renderWrites(), 1);
  assert.equal(s.job().status, 'SUCCEEDED');
  assert.deepEqual([0, 1, 2].map(i => result(s, i)), ['APPLIED', 'IGNORED_TERMINAL', 'IGNORED_TERMINAL']);
});

test('Completion receipt without a video leaves the render to polling, never SUCCEEDED-without-URL', () => {
  const noVideo = { jobId: RENDER_ID, status: 'completed', video: {}, probe: {} };
  const s = sandbox({ receipts: [receipt('completed', noVideo)], pollResponse: { status: 'rendering', progress: 80, url: '' } });
  const response = s.call('ProductionController.refresh({jobId:"RND-INT1"})');
  assert.equal(response.success, true);
  assert.equal(result(s, 0), 'REJECTED_NO_VIDEO');
  assert.equal(s.job().status, 'RENDERING');
  assert.equal(s.job().progress, 80, 'Polling should still update the active render.');
});

test('Broken inbox schema does not take down refreshActive; receipt stays pending and a warning is logged', () => {
  const wrong = HEADERS.slice(); wrong[0] = 'Receipt';
  const s = sandbox({ receipts: [receipt('completed')], headers: wrong });
  const response = s.call('ProductionController.refreshActive()');
  assert.equal(response.success, true, 'Production refresh failed because of the inbox.');
  assert.equal(result(s, 0), '', 'Receipt must remain pending.');
  assert.equal(s.job().status, 'RENDERING');
  assert.ok(s.warnings().some(w => w.action === 'PRODUCTION_CALLBACK_INBOX' && /schema mismatch/.test(w.errorDetails)));
  assert.equal(s.lockHeld(), false);
});

test('Broken inbox schema does not block a manual refresh write under the lock', () => {
  const wrong = HEADERS.slice(); wrong[6] = 'Outcome';
  const s = sandbox({ headers: wrong, pollResponse: { status: 'rendering', progress: 70, url: '' } });
  const response = s.call('ProductionController.refresh({jobId:"RND-INT1"})');
  assert.equal(response.success, true);
  assert.equal(s.job().progress, 70);
});

// ---------- Queue tick + inbox + advisory estimate (PR #13 + PR #14) ----------

function shortEstimateScript() {
  // 4 scenes x 10 words: ScenePlanService estimates 20s, outside the 30-60s target.
  // Before PR #13 create() threw here; now it must warn and continue.
  const scenes = Array.from({ length: 4 }, (_, i) => ({
    sceneNumber: i + 1, narration: Array(10).fill('travel').join(' ') + '.', visualDirection: 'A trail'
  }));
  return { id: 'SCR-SHORT', title: 'Short estimate', status: 'APPROVED', scenes,
    voiceoverScript: scenes.map(scene => scene.narration).join(' ') };
}

function queueSandbox(options) {
  const task = { id: 'TSK-1', scriptId: 'SCR-SHORT', status: 'PREPARING', priority: 3, createdAt: '2026-10-21T00:00:00.000Z' };
  const stub = {};
  const s = sandbox(Object.assign({ tasks: { getAll: () => [clone(task)] }, stubController: stub }, options));
  const seen = { plans: [], lockHeldDuringStep: null };
  // Stand-in for the controller step: takes the lock itself and builds the real plan.
  Object.assign(stub, {
    prepareNextScene: () => {
      seen.lockHeldDuringStep = s.lockHeld();
      s.events.push('step');
      seen.plans.push(vm.runInContext('ScenePlanService', s.context).create(shortEstimateScript()));
      return { success: true, data: { complete: false } };
    }
  });
  return { s, seen };
}

test('Queue tick drains callbacks first, releases the lock, then prepares a short-estimate script', () => {
  const { s, seen } = queueSandbox({ receipts: [receipt('completed')] });
  const outcome = s.call('ProductionQueueService.processNext()');
  assert.equal(outcome.processed, true);
  assert.equal(s.job().status, 'SUCCEEDED', 'Queued callback was not drained by the tick.');
  assert.ok(s.events.indexOf('render-write:SUCCEEDED') < s.events.indexOf('step'), 'Callbacks must drain before the task step.');
  assert.equal(seen.lockHeldDuringStep, false, 'Inbox lock must be released before the controller takes its own.');
  assert.equal(seen.plans[0].expectedDurationSeconds, 20);
  assert.equal(seen.plans[0].warnings.length, 1, 'Short estimate should warn, not throw.');
});

test('Queue tick still prepares scenes when the inbox is broken, and reports the inbox error', () => {
  const wrong = HEADERS.slice(); wrong[2] = 'State';
  const { s, seen } = queueSandbox({ receipts: [receipt('completed')], headers: wrong });
  const outcome = s.call('ProductionQueueService.processNext()');
  assert.equal(outcome.processed, true, 'A broken inbox stopped scene preparation.');
  assert.equal(seen.plans.length, 1);
  assert.equal(result(s, 0), '', 'Receipt must remain pending for a later pass.');
  assert.equal(s.lockHeld(), false);
});

test('Queue tick with no tasks still drains callbacks and reports the stats', () => {
  const s = sandbox({ receipts: [receipt('failed')], tasks: { getAll: () => [] }, stubController: {} });
  const outcome = s.call('ProductionQueueService.processNext()');
  assert.equal(outcome.processed, false);
  assert.equal(outcome.callbacks.processed, 1);
  assert.equal(s.job().status, 'FAILED');
});

test('Queue tick under lock contention skips the drain but still runs the step', () => {
  const { s, seen } = queueSandbox({ receipts: [receipt('completed')], busy: true });
  const outcome = s.call('ProductionQueueService.processNext()');
  assert.equal(outcome.processed, true);
  assert.equal(seen.plans.length, 1);
  assert.equal(s.job().status, 'RENDERING', 'A skipped pass must not touch the render.');
  assert.equal(result(s, 0), '', 'Receipt must remain pending.');
});

console.log(`Inbox/controller/queue integration: ${passed}/${passed} passed.`);
