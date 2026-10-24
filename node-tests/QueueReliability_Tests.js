'use strict';
// Regression tests: the background queue must not wedge, retry forever, or submit twice.
// Runs the REAL ProductionTaskRepository (on a fake sheet), ProductionQueueService and
// ProductionController. Only the spreadsheet, locks, providers and clocks are fake.
// Scene preparation only runs under the Creatomate fallback (the Cloud Run renderer builds its own
// visuals), so the tests that prepare scenes use it; the submission tests also cover Cloud Run.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const MIN = 60 * 1000;
const ago = ms => new Date(Date.now() - ms).toISOString();

function fakeSheet(onWrite) {
  const rows = [];
  const sheet = {
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
            if (row - 1 + r > 0) onWrite(vals);
          });
          return this;
        },
        setFontWeight() { return this; }
      };
    }
  };
  return sheet;
}

function sandbox(options = {}) {
  const logs = [], visualCalls = [], submitCalls = [], writes = [];
  let lockHeld = false, lockCalls = 0;
  let renders = [];
  let providerReturned = false;
  const sheet = fakeSheet(vals => writes.push({ id: vals[0], status: vals[4], lockHeld }));
  const script = id => ({ id, status: 'APPROVED', scenes: [{ sceneNumber: 1 }] });
  const context = vm.createContext({
    Utilities: { getUuid: randomUUID }, Logger: { log() {} }, SHEETS: {},
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet, insertSheet: () => sheet }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'true', setProperty() {}, deleteProperty() {} }) },
    ScriptApp: { getProjectTriggers: () => [] },
    LockService: { getScriptLock: () => ({
      tryLock() {
        lockCalls++;
        if (options.busy === true || (options.busyOnce && lockCalls === 1)) return false;
        lockHeld = true; return true;
      },
      releaseLock() { lockHeld = false; }
    }) },
    LoggingService: {
      STATUS: { WARNING: 'Warning' }, started() {}, success() {}, failure() {},
      log(entry) { logs.push(entry); }
    },
    MediaWorkerCallbackInbox: { processPending: () => ({}), processPendingLocked: () => ({}) },
    ScriptsRepository: { getScriptById: id => script(id) },
    SeoRepository: { getByScriptId: () => ({ id: 'SEO-1' }) },
    PublishingJobRepository: { getAll: () => [] },
    Secrets: { getCreatomateTemplateId: () => 'tpl', getVideoProvider: () => options.provider || 'creatomate' },
    CreatomateProviderAdapter: {},
    ScenePlanService: { create: () => ({}) },
    VisualAssetService: { prepareSceneVisual(s, plan, scene) { visualCalls.push(scene); return { scene }; } },
    VideoProcessingProvider: { get: () => provider, forJob: () => provider },
    RenderJobRepository: {
      getAll: () => renders.map(job => JSON.parse(JSON.stringify(job))),
      getById: id => renders.find(job => job.id === id) || null,
      save(job) { renders.push(job); return job; },
      update(job) {
        if (options.renderUpdatesFailAfterProvider && providerReturned) throw new Error('Sheets unavailable');
        renders = renders.map(item => item.id === job.id ? job : item);
        return job;
      }
    }
  });
  const provider = {
    submitRender() {
      submitCalls.push(Date.now());
      if (options.providerFails) throw new Error(options.providerFails);
      providerReturned = true;
      return { render: { id: 'cr-' + randomUUID(), status: 'RENDERING', progress: 5 }, payload: {} };
    }
  };
  for (const file of ['Models/RenderJob.js', 'Production/ProductionError_Service.js',
    'Production/ProductionTask_Repository.js', 'Production/ProductionQueue_Service.js', 'App/ProductionController.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }
  const call = expr => JSON.parse(JSON.stringify(vm.runInContext(expr, context, { timeout: 10000 }) ?? null));
  const addTask = data => {
    context.__task = data;
    return call('ProductionTaskRepository.save(ProductionTaskRepository.create(__task))');
  };
  const task = id => call('ProductionTaskRepository.getById(' + JSON.stringify(id) + ')');
  const tick = () => {
    try { return { result: call('ProductionQueueService.processNext()') }; }
    catch (caught) { return { error: String(caught.message || caught) }; }
  };
  return { call, addTask, task, tick, logs, visualCalls, submitCalls, writes, renders: () => renders,
    addRender: job => { renders.push(job); } };
}
const fourScenes = { preparedScenes: [1, 2, 3, 4], nextScene: 5, attempts: 4 };

test('Healthy path: four ticks prepare the scenes, the fifth submits exactly one render', () => {
  const s = sandbox();
  s.addTask({ id: 'PRD-1', scriptId: 'SCR-1' });
  for (let i = 0; i < 4; i++) assert.equal(s.tick().result.processed, true);
  assert.deepEqual(s.visualCalls, [1, 2, 3, 4]);
  assert.equal(s.task('PRD-1').status, 'READY');
  assert.equal(s.tick().result.processed, true);
  assert.equal(s.submitCalls.length, 1);
  assert.equal(s.task('PRD-1').status, 'SUBMITTED');
  assert.equal(s.task('PRD-1').renderJobId, s.renders()[0].id);
  assert.equal(s.tick().result.processed, false);
  assert.equal(s.submitCalls.length, 1, 'a finished task is never submitted again');
});

test('A task stuck in SUBMITTING with no render is returned to READY and submitted exactly once', () => {
  const s = sandbox();
  s.addTask(Object.assign({ id: 'PRD-2', scriptId: 'SCR-1', status: 'SUBMITTING', updatedAt: ago(20 * MIN) }, fourScenes));
  const first = s.tick();
  assert.equal(first.result.processed, true, 'the recovered task is picked up in the same tick');
  assert.equal(s.submitCalls.length, 1);
  assert.equal(s.task('PRD-2').status, 'SUBMITTED');
  assert.ok(s.logs.some(l => l.action === 'PRODUCTION_RECOVERY' && /PRD-2/.test(l.message)), 'the recovery must be logged');
  s.tick();
  assert.equal(s.submitCalls.length, 1);
});

test('A task stuck in SUBMITTING whose render already started is linked to it, never submitted again', () => {
  const s = sandbox();
  s.addTask(Object.assign({ id: 'PRD-3', scriptId: 'SCR-1', status: 'SUBMITTING', updatedAt: ago(20 * MIN) }, fourScenes));
  s.addRender({ id: 'RND-LIVE', scriptId: 'SCR-1', status: 'RENDERING', renderId: 'cr-live', createdAt: ago(19 * MIN) });
  s.tick(); s.tick();
  assert.equal(s.task('PRD-3').status, 'SUBMITTED');
  assert.equal(s.task('PRD-3').renderJobId, 'RND-LIVE');
  assert.equal(s.submitCalls.length, 0, 'no second (paid) render may be started');
  assert.equal(s.renders().length, 1);
});

test('A render that predates the submission is not mistaken for it', () => {
  const s = sandbox();
  s.addTask(Object.assign({ id: 'PRD-4', scriptId: 'SCR-1', status: 'SUBMITTING', updatedAt: ago(20 * MIN), sourceRenderJobId: 'RND-OLD' }, fourScenes));
  s.addRender({ id: 'RND-OLD', scriptId: 'SCR-1', status: 'SUCCEEDED', renderId: 'cr-old', videoUrl: 'https://x/v.mp4', createdAt: ago(5 * 24 * 60 * MIN) });
  s.tick();
  assert.notEqual(s.task('PRD-4').renderJobId, 'RND-OLD');
});

test('A fresh SUBMITTING task is left alone, and a second submission of it is refused', () => {
  const s = sandbox();
  s.addTask(Object.assign({ id: 'PRD-5', scriptId: 'SCR-1', status: 'SUBMITTING', updatedAt: ago(MIN) }, fourScenes));
  assert.equal(s.tick().result.processed, false);
  assert.equal(s.task('PRD-5').status, 'SUBMITTING');
  const direct = s.call('ProductionController.submitPrepared({taskId:"PRD-5"})');
  assert.equal(direct.success, false);
  assert.match(direct.error.message, /already being submitted/);
  assert.equal(direct.error.retryable, true, 'a busy task is a temporary condition, not a failure');
  assert.equal(s.submitCalls.length, 0);
});

test('Claiming a task for submission happens while the script lock is held', () => {
  const s = sandbox();
  s.addTask(Object.assign({ id: 'PRD-6', scriptId: 'SCR-1', status: 'READY' }, fourScenes));
  s.tick();
  const claims = s.writes.filter(w => w.id === 'PRD-6' && w.status === 'SUBMITTING');
  assert.equal(claims.length, 1);
  assert.equal(claims[0].lockHeld, true, 'READY -> SUBMITTING must be a locked compare-and-set');
});

test('If the sheet fails after the worker accepted the job, the task stays linked to that render', () => {
  const s = sandbox({ renderUpdatesFailAfterProvider: true });
  s.addTask(Object.assign({ id: 'PRD-7', scriptId: 'SCR-1', status: 'READY' }, fourScenes));
  const outcome = s.tick();
  assert.ok(outcome.error, 'the failure is still reported');
  assert.equal(s.submitCalls.length, 1);
  assert.equal(s.task('PRD-7').status, 'SUBMITTED', 'a failed task would invite a second paid render');
  assert.equal(s.task('PRD-7').renderJobId, s.renders()[0].id);
  assert.equal(s.tick().result.processed, false);
  assert.equal(s.submitCalls.length, 1);
});

test('A definite failure (render marked FAILED) still fails the task', () => {
  const s = sandbox({ providerFails: 'The media worker rejected the render.' });
  s.addTask(Object.assign({ id: 'PRD-8', scriptId: 'SCR-1', status: 'READY' }, fourScenes));
  s.tick();
  assert.equal(s.task('PRD-8').status, 'FAILED');
  assert.equal(s.renders()[0].status, 'FAILED');
});

test('A poison task cannot starve the tasks behind it', () => {
  const s = sandbox();
  // READY but only three scenes prepared: the step throws before it can record any failure.
  s.addTask({ id: 'PRD-POISON', scriptId: 'SCR-1', status: 'READY', priority: 5, preparedScenes: [1, 2, 3], nextScene: 4, attempts: 3 });
  s.addTask({ id: 'PRD-GOOD', scriptId: 'SCR-2', status: 'PREPARING', priority: 3 });
  const first = s.tick();
  assert.ok(first.error, 'the failure is reported');
  assert.equal(s.task('PRD-POISON').status, 'FAILED');
  assert.match(s.task('PRD-POISON').errorMessage, /Stopped by the queue/);
  const second = s.tick();
  assert.equal(second.result.processed, true);
  assert.equal(second.result.taskId, 'PRD-GOOD');
  assert.deepEqual(s.visualCalls, [1]);
});

test('A temporary failure (busy lock) does not fail the task', () => {
  const s = sandbox({ busy: true });
  s.addTask({ id: 'PRD-BUSY', scriptId: 'SCR-1', status: 'PREPARING' });
  assert.ok(s.tick().error);
  assert.equal(s.task('PRD-BUSY').status, 'PREPARING');
  assert.equal(s.visualCalls.length, 0);
});

test('An interrupted scene waits 5, then 10, minutes before it is retried', () => {
  const one = sandbox();
  one.addTask({ id: 'PRD-B1', scriptId: 'SCR-1', status: 'PREPARING', preparedScenes: [1], nextScene: 2, attempts: 2, updatedAt: ago(MIN) });
  assert.equal(one.tick().result.processed, false, 'one minute after the first interruption is too soon');
  assert.equal(one.visualCalls.length, 0);
  const due = sandbox();
  due.addTask({ id: 'PRD-B2', scriptId: 'SCR-1', status: 'PREPARING', preparedScenes: [1], nextScene: 2, attempts: 2, updatedAt: ago(6 * MIN) });
  assert.equal(due.tick().result.processed, true);
  assert.deepEqual(due.visualCalls, [2]);
  const two = sandbox();
  two.addTask({ id: 'PRD-B3', scriptId: 'SCR-1', status: 'PREPARING', preparedScenes: [1], nextScene: 2, attempts: 3, updatedAt: ago(6 * MIN) });
  assert.equal(two.tick().result.processed, false, 'a second interruption doubles the wait');
  const twoDue = sandbox();
  twoDue.addTask({ id: 'PRD-B4', scriptId: 'SCR-1', status: 'PREPARING', preparedScenes: [1], nextScene: 2, attempts: 3, updatedAt: ago(11 * MIN) });
  assert.equal(twoDue.tick().result.processed, true);
});

test('A backing-off task does not hold up a different task', () => {
  const s = sandbox();
  s.addTask({ id: 'PRD-WAIT', scriptId: 'SCR-1', status: 'PREPARING', priority: 5, preparedScenes: [1], nextScene: 2, attempts: 2, updatedAt: ago(MIN) });
  s.addTask({ id: 'PRD-NEXT', scriptId: 'SCR-2', status: 'PREPARING', priority: 1 });
  assert.equal(s.tick().result.taskId, 'PRD-NEXT');
});

test('A scene interrupted three times stops, says why, and Resume starts it fresh', () => {
  const s = sandbox();
  s.addTask({ id: 'PRD-CAP', scriptId: 'SCR-1', status: 'PREPARING', preparedScenes: [1], nextScene: 2, attempts: 4, updatedAt: ago(60 * MIN) });
  const outcome = s.tick();
  assert.equal(outcome.result.processed, false);
  assert.equal(s.visualCalls.length, 0, 'no more paid scene work after the cap');
  const stopped = s.task('PRD-CAP');
  assert.equal(stopped.status, 'FAILED');
  assert.match(stopped.errorMessage, /Scene 2 was interrupted 3 times/);
  assert.match(stopped.errorMessage, /Resume/);
  assert.ok(s.logs.some(l => l.action === 'PRODUCTION_RECOVERY' && /PRD-CAP/.test(l.message)));
  const resumed = s.call('ProductionController.controlPreparation({taskId:"PRD-CAP",action:"resume"})');
  assert.equal(resumed.success, true);
  assert.equal(s.task('PRD-CAP').attempts, 1, 'the interruption count is cleared by an operator resume');
  assert.equal(s.tick().result.processed, true);
  assert.deepEqual(s.visualCalls, [2]);
});

test('A failure while reviewing stalled tasks does not stop the tick', () => {
  const s = sandbox({ busyOnce: true });
  s.addTask({ id: 'PRD-OK', scriptId: 'SCR-1', status: 'PREPARING' });
  const outcome = s.tick();
  assert.equal(outcome.result.processed, true, 'the step still runs although the review could not take the lock');
  assert.deepEqual(s.visualCalls, [1]);
});

test('Queue status counts a SUBMITTING task as waiting', () => {
  const s = sandbox();
  s.addTask(Object.assign({ id: 'PRD-ST', scriptId: 'SCR-1', status: 'SUBMITTING' }, fourScenes));
  assert.equal(s.call('ProductionQueueService.status()').waitingTasks, 1);
});


test('Under Cloud Run a leftover READY task is still submitted once, and PREPARING tasks are not run', () => {
  const s = sandbox({ provider: 'cloud-run' });
  s.addTask({ id: 'PRD-LEFT', scriptId: 'SCR-2', status: 'PREPARING', priority: 5 });
  s.addTask(Object.assign({ id: 'PRD-RDY', scriptId: 'SCR-1', status: 'READY' }, fourScenes));
  assert.equal(s.tick().result.taskId, 'PRD-RDY');
  assert.equal(s.submitCalls.length, 1);
  assert.equal(s.task('PRD-RDY').status, 'SUBMITTED');
  assert.equal(s.tick().result.processed, false, 'the leftover PREPARING task must not buy images');
  assert.equal(s.visualCalls.length, 0);
});
test('Under Cloud Run a task stuck in SUBMITTING is still settled without a second render', () => {
  const s = sandbox({ provider: 'cloud-run' });
  s.addTask(Object.assign({ id: 'PRD-CR', scriptId: 'SCR-1', status: 'SUBMITTING', updatedAt: ago(20 * MIN) }, fourScenes));
  s.addRender({ id: 'RND-CR', scriptId: 'SCR-1', status: 'QUEUED', renderId: 'cr-live', createdAt: ago(19 * MIN) });
  s.tick();
  assert.equal(s.task('PRD-CR').status, 'SUBMITTED');
  assert.equal(s.task('PRD-CR').renderJobId, 'RND-CR');
  assert.equal(s.submitCalls.length, 0);
});
console.log(`Queue reliability: ${passed}/${passed} passed.`);
