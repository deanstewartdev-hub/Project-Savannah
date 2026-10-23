'use strict';
// Regression tests: queue worker (PR #20) x reserved render ID (PR #19) x callback inbox (PR #14/#15).
// Runs the REAL task and render repositories, queue service, controller, Cloud Run provider and
// callback inbox on fake sheets. Only the spreadsheet, the script lock and the dispatcher's HTTP
// responses are fake. The lock is a real mutex, so overlapping work behaves as two executions would.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const VIDEO_URL = 'https://storage.googleapis.com/savannah-media/renders/final.mp4?X-Goog-Signature=abc';
const INBOX_HEADERS = ['Receipt ID', 'Render ID', 'Status', 'Payload JSON', 'Received At', 'Handled At', 'Result'];
const MIN = 60 * 1000;
const ago = ms => new Date(Date.now() - ms).toISOString();

function words(count) { return Array.from({ length: count }, (_, i) => 'word' + i).join(' '); }
const SCRIPT = { id: 'SCR-1', status: 'APPROVED', title: 'Test', scenes: [1, 2, 3].map(n => ({
  sceneNumber: n, narration: words(35) + '.', visualDirection: 'Scene ' + n })) };

function fakeSheet() {
  const rows = [];
  return {
    rows,
    getLastRow: () => rows.length,
    getLastColumn: () => (rows[0] ? rows[0].length : 0),
    clear() { rows.length = 0; },
    setFrozenRows() {},
    getRange(row, col, numRows = 1, numCols = 1) {
      return {
        getValues: () => Array.from({ length: numRows }, (_, r) =>
          Array.from({ length: numCols }, (_, c) => (rows[row - 1 + r] || [])[col - 1 + c] ?? '')),
        getDisplayValues: () => Array.from({ length: numRows }, (_, r) =>
          Array.from({ length: numCols }, (_, c) => String((rows[row - 1 + r] || [])[col - 1 + c] ?? ''))),
        getDisplayValue: () => String((rows[row - 1] || [])[col - 1] ?? ''),
        setValues(values) {
          values.forEach((vals, r) => {
            rows[row - 1 + r] = rows[row - 1 + r] || [];
            vals.forEach((value, c) => { rows[row - 1 + r][col - 1 + c] = value; });
          });
          return this;
        },
        setFontWeight() { return this; }
      };
    }
  };
}

// hooks.onJobsPost(body, ctx) runs when the dispatcher receives POST /jobs, before it answers.
function sandbox(options = {}) {
  const sheets = {};
  sheets['Render Callback Inbox'] = fakeSheet();
  sheets['Render Callback Inbox'].rows.push(INBOX_HEADERS.slice());
  const getSheet = name => (sheets[name] = sheets[name] || fakeSheet());
  const logs = [], posts = [];
  let held = false;
  const context = vm.createContext({
    Utilities: { getUuid: randomUUID }, Logger: { log() {} },
    SHEETS: { RENDER_JOBS: 'Render Jobs', PUBLISHING_JOBS: 'Publishing Jobs', PRODUCTION_TASKS: 'Production Tasks' },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: getSheet, insertSheet: getSheet }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => (key === 'PRODUCTION_QUEUE_ENABLED' ? 'true' : ''), setProperty() {}, deleteProperty() {} }) },
    ScriptApp: { getProjectTriggers: () => [] },
    LockService: { getScriptLock: () => ({
      tryLock() { if (held) return false; held = true; return true; },
      releaseLock() { held = false; }
    }) },
    LoggingService: { STATUS: { WARNING: 'Warning' }, started() {}, success() {}, failure() {}, log(entry) { logs.push(entry); } },
    ScriptsRepository: { getScriptById: id => (id === 'SCR-1' ? SCRIPT : null) },
    SeoRepository: { getByScriptId: () => ({ id: 'SEO-1' }) },
    PublishingJobRepository: { getAll: () => [] },
    ScenePlanService: { create: () => ({}) },
    VisualAssetService: { prepareSceneVisual: () => ({}) },
    CreatomateProviderAdapter: {},
    Secrets: {
      getVideoProvider: () => 'cloud-run', getCreatomateTemplateId: () => 'tpl',
      getMediaWorkerUrl: () => 'https://worker.example',
      getMediaWorkerJobSubmitSecret: () => 'submit-secret-for-tests',
      getMediaWorkerSharedSecret: () => 'callback-secret-for-tests',
      getMediaWorkerCallbackUrl: () => 'https://script.google.com/macros/s/TEST/exec'
    },
    UrlFetchApp: {
      fetch(url, request) {
        const body = JSON.parse(request.payload);
        if (/\/jobs\/status$/.test(url)) {
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ state: 'UNKNOWN', artifactExists: false }) };
        }
        posts.push(body);
        if (options.onJobsPost) options.onJobsPost(body, api);
        if (options.workerTimesOut) throw new Error('Timeout: worker did not answer');
        return { getResponseCode: () => 202, getContentText: () => JSON.stringify({ jobId: body.jobId, status: 'queued' }) };
      }
    }
  });
  for (const file of ['Utils/EnvironmentGuard.js', 'Models/RenderJob.js', 'Production/ProductionError_Service.js', 'Production/RenderJob_Repository.js',
    'Production/ProductionTask_Repository.js', 'Production/VideoLink_Service.js', 'Production/MediaWorkerCallbackInbox_Service.js',
    'Production/VideoProcessingProvider.js', 'Production/ProductionQueue_Service.js', 'App/ProductionController.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }
  const call = expr => JSON.parse(JSON.stringify(vm.runInContext(expr, context, { timeout: 10000 }) ?? null));
  const api = {
    call,
    addTask(data) { context.__task = data; return call('ProductionTaskRepository.save(ProductionTaskRepository.create(__task))'); },
    task: id => call('ProductionTaskRepository.getById(' + JSON.stringify(id) + ')'),
    renders: () => call('RenderJobRepository.getAll()'),
    tick() {
      try { return { result: call('ProductionQueueService.processNext()') }; }
      catch (caught) { return { error: String(caught.message || caught) }; }
    },
    // What the standalone callback bridge does: append a receipt, never touch Render Jobs.
    deliver(renderId, status, body) {
      const sheet = getSheet('Render Callback Inbox');
      const payload = body || (status === 'completed' ?
        { jobId: renderId, status, video: { url: VIDEO_URL, width: 1080, height: 1920 }, probe: { durationSeconds: 36.9 }, error: {} } :
        { jobId: renderId, status, video: {}, probe: {}, error: { message: 'FFmpeg assembly failed.' } });
      sheet.rows.push([randomUUID(), renderId, status, JSON.stringify(payload), new Date(), '', '']);
    },
    receiptResults: () => getSheet('Render Callback Inbox').rows.slice(1).map(r => r[6]),
    // Render Jobs as stored right now, read straight from the sheet (used from inside the fake dispatcher).
    storedRenders: () => getSheet('Render Jobs').rows.slice(1),
    posts, logs
  };
  return api;
}
const ready = { preparedScenes: [1, 2, 3, 4], nextScene: 5, attempts: 4 };
const readyTask = id => Object.assign({ id, scriptId: 'SCR-1', status: 'READY' }, ready);

test('1. The render row carries its reserved ID before the worker is asked to start', () => {
  const seen = [];
  const s = sandbox({ onJobsPost: (body, api) => seen.push(api.storedRenders().map(r => ({ renderId: r[1], status: r[5] }))) });
  s.addTask(readyTask('PRD-1'));
  assert.equal(s.tick().result.processed, true);
  assert.equal(s.posts.length, 1);
  assert.deepEqual(seen[0], [{ renderId: s.posts[0].jobId, status: 'QUEUED' }],
    'at the moment the dispatcher received the job, the saved row already held the same ID');
});

test('2-4. An unconfirmed worker response: no second render, task stays linked, second tick submits nothing', () => {
  const s = sandbox({ workerTimesOut: true });
  s.addTask(readyTask('PRD-2'));
  const first = s.tick();
  assert.ok(first.error, 'the unconfirmed submission is reported');
  assert.equal(s.posts.length, 1);
  const renders = s.renders();
  assert.equal(renders.length, 1, 'exactly one render row exists');
  assert.equal(renders[0].status, 'QUEUED', 'left active, not FAILED');
  assert.equal(renders[0].renderId, s.posts[0].jobId, 'under the ID the worker received');
  const task = s.task('PRD-2');
  assert.equal(task.status, 'SUBMITTED');
  assert.equal(task.renderJobId, renders[0].id);
  assert.match(task.errorMessage, /Do not re-render/);
  const second = s.tick();
  assert.equal(second.result.processed, false);
  assert.equal(s.posts.length, 1, 'the same task is not submitted again');
  assert.equal(s.renders().length, 1);
});

test('5. A direct submission cannot bypass the active-render guard', () => {
  const s = sandbox({ workerTimesOut: true });
  s.addTask(readyTask('PRD-5'));
  s.tick();
  for (const request of ['{scriptId:"SCR-1"}', '{scriptId:"SCR-1",forceRerender:true}']) {
    const direct = s.call('ProductionController.submit(' + request + ')');
    assert.equal(direct.success, false);
    assert.match(direct.error.message, /already has an active render/);
  }
  assert.equal(s.posts.length, 1, 'no second request reached the worker');
  assert.equal(s.renders().length, 1);
});

test('6. A callback completes the original render, once, and a replay changes nothing', () => {
  const s = sandbox({ workerTimesOut: true });
  s.addTask(readyTask('PRD-6'));
  s.tick();
  const original = s.renders()[0];
  s.deliver(original.renderId, 'completed');
  s.tick();
  const done = s.renders()[0];
  assert.equal(done.id, original.id, 'the same row, not a new one');
  assert.equal(done.status, 'SUCCEEDED');
  assert.equal(done.videoUrl, VIDEO_URL);
  assert.equal(s.task('PRD-6').renderJobId, original.id, 'the task still points at it');
  assert.deepEqual(s.receiptResults(), ['APPLIED']);
  s.deliver(original.renderId, 'completed');
  s.tick();
  assert.deepEqual(s.receiptResults(), ['APPLIED', 'IGNORED_TERMINAL']);
  assert.equal(s.renders()[0].version, done.version, 'the replay wrote nothing to the render');
  assert.equal(s.posts.length, 1);
});

test('7a. A late failure callback cannot overwrite a completed render', () => {
  const s = sandbox();
  s.addTask(readyTask('PRD-7A'));
  s.tick();
  const render = s.renders()[0];
  s.deliver(render.renderId, 'completed');
  s.deliver(render.renderId, 'failed');
  s.tick();
  assert.equal(s.renders()[0].status, 'SUCCEEDED');
  assert.equal(s.renders()[0].videoUrl, VIDEO_URL);
  assert.deepEqual(s.receiptResults(), ['APPLIED', 'IGNORED_TERMINAL']);
});

test('7b. Recovering a stuck task adopts a render that has meanwhile completed, without changing it', () => {
  const s = sandbox();
  s.addTask(Object.assign({ id: 'PRD-7B', scriptId: 'SCR-1', status: 'SUBMITTING', updatedAt: ago(20 * MIN) }, ready));
  s.call('RenderJobRepository.save(RenderJobModel.create({id:"RND-DONE0001",renderId:"cr-' + randomUUID() +
    '",scriptId:"SCR-1",seoPackId:"SEO-1",templateId:"cloud-run-worker",status:"SUCCEEDED",progress:100,videoUrl:"' + VIDEO_URL +
    '",createdAt:"' + ago(19 * MIN) + '"}))');
  const before = s.renders()[0];
  s.tick(); s.tick();
  assert.equal(s.task('PRD-7B').status, 'SUBMITTED');
  assert.equal(s.task('PRD-7B').renderJobId, 'RND-DONE0001');
  const after = s.renders()[0];
  assert.equal(after.status, 'SUCCEEDED');
  assert.equal(after.version, before.version, 'recovery must not rewrite the render');
  assert.equal(s.posts.length, 0, 'nothing was submitted');
});

test('7c. Recovery never reverts a task that is already SUBMITTED', () => {
  const s = sandbox();
  s.addTask(Object.assign({ id: 'PRD-7C', scriptId: 'SCR-1', status: 'SUBMITTED', renderJobId: 'RND-X', updatedAt: ago(60 * MIN) }, ready));
  s.tick(); s.tick();
  assert.equal(s.task('PRD-7C').status, 'SUBMITTED');
  assert.equal(s.task('PRD-7C').renderJobId, 'RND-X');
  assert.equal(s.posts.length, 0);
});

test('Overlap: a callback that arrives while the submission request is still failing is applied to the same render', () => {
  const s = sandbox({
    workerTimesOut: true,
    // The worker finished fast and delivered, but our HTTP request timed out: the receipt exists
    // before submitRender returns.
    onJobsPost: (body, api) => api.deliver(body.jobId, 'completed')
  });
  s.addTask(readyTask('PRD-OV1'));
  assert.ok(s.tick().error);
  assert.equal(s.renders()[0].status, 'QUEUED', 'the failed submit itself did not complete it');
  s.tick();
  assert.equal(s.renders().length, 1);
  assert.equal(s.renders()[0].status, 'SUCCEEDED');
  assert.equal(s.renders()[0].videoUrl, VIDEO_URL);
  assert.equal(s.task('PRD-OV1').status, 'SUBMITTED');
  assert.equal(s.posts.length, 1, 'one paid render in total');
  assert.deepEqual(s.receiptResults(), ['APPLIED']);
});

test('Overlap: a second queue tick and a direct submit during an in-flight submission are refused, not duplicated', () => {
  let inner;
  const s = sandbox({
    onJobsPost: (body, api) => {
      // Two more executions start while this one is inside the worker request.
      inner = {
        tick: api.tick(),
        direct: api.call('ProductionController.submit({scriptId:"SCR-1",forceRerender:true})'),
        claim: api.call('ProductionController.submitPrepared({taskId:"PRD-OV2"})')
      };
    }
  });
  s.addTask(readyTask('PRD-OV2'));
  assert.equal(s.tick().result.processed, true);
  assert.equal(s.posts.length, 1, 'only the original execution reached the worker');
  assert.equal(s.renders().length, 1);
  assert.equal(inner.direct.success, false, 'a direct submit cannot run while the lock is held');
  assert.equal(inner.direct.error.retryable, true);
  assert.equal(inner.claim.success, false, 'the task cannot be claimed a second time');
  assert.ok(inner.tick.error || inner.tick.result.processed === false, 'the overlapping tick submitted nothing');
  assert.equal(s.task('PRD-OV2').status, 'SUBMITTED');
});

test('Overlap: a callback drained between two ticks of a queued task does not make the task submit again', () => {
  const s = sandbox();
  s.addTask(readyTask('PRD-OV3'));
  s.tick();
  const render = s.renders()[0];
  s.deliver(render.renderId, 'failed');
  s.tick();
  assert.equal(s.renders()[0].status, 'FAILED', 'the worker reported a failure and it was applied');
  assert.equal(s.task('PRD-OV3').status, 'SUBMITTED', 'the finished task is not resubmitted by the queue');
  assert.equal(s.tick().result.processed, false);
  assert.equal(s.posts.length, 1);
});

console.log(`Queue x submission x callback interplay: ${passed}/${passed} passed.`);
