'use strict';
// Regression tests: the Production health panel reports background-queue problems (stuck
// submissions, failed and exhausted tasks, uncertain render submissions) and stays read-only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;

// ---- pure service ----
const service = vm.createContext({});
vm.runInContext(read('Production/ProductionHealth_Service.js'), service, { filename: 'Production/ProductionHealth_Service.js' });
const evaluate = input => JSON.parse(JSON.stringify(vm.runInContext(
  'ProductionHealthService.evaluate(' + JSON.stringify(input) + ')', service)));
const thresholds = JSON.parse(vm.runInContext('JSON.stringify(ProductionHealthService.thresholds)', service));
const NOW = Date.parse('2026-10-21T12:00:00.000Z');
const ago = ms => new Date(NOW - ms).toISOString();
const run = (tasks, renders) => evaluate({ now: NOW, productionTasks: tasks || [], renderJobs: renders || [], publishingJobs: [] });
const codes = result => result.findings.map(item => item.code);
const task = overrides => Object.assign({ id: 'PRD-1', scriptId: 'SCR-1', status: 'PREPARING', preparedScenes: [], attempts: 0,
  errorMessage: '', renderJobId: '', createdAt: ago(DAY), updatedAt: ago(MIN) }, overrides);
const render = overrides => Object.assign({ id: 'RND-1', renderId: 'cr-0000', scriptId: 'SCR-1', status: 'QUEUED',
  videoUrl: '', providerResponse: {}, createdAt: ago(10 * MIN), updatedAt: ago(MIN) }, overrides);

test('Healthy and ordinary queue tasks produce no findings', () => {
  const tasks = ['PREPARING', 'READY', 'PAUSED', 'CANCELLED'].map((status, i) => task({ id: 'PRD-' + i, status }))
    .concat([task({ id: 'PRD-S', status: 'SUBMITTED', renderJobId: 'RND-1' })]);
  assert.deepEqual(run(tasks, [render({ renderId: 'cr-1', providerResponse: { cloudRun: { executionName: 'x' } } })]).findings, []);
});

test('A task stuck in SUBMITTING is flagged once it outlives an execution, and critical after an hour', () => {
  assert.deepEqual(run([task({ status: 'SUBMITTING', updatedAt: ago(thresholds.taskSubmittingWarningMs - MIN) })]).findings, []);
  const warn = run([task({ status: 'SUBMITTING', updatedAt: ago(thresholds.taskSubmittingWarningMs + MIN) })]);
  assert.deepEqual(codes(warn), ['TASK_STUCK_SUBMITTING']);
  assert.equal(warn.findings[0].severity, 'warning');
  assert.equal(warn.findings[0].doNotRerender, true);
  assert.match(warn.findings[0].recovery, /Do not submit it again/);
  assert.deepEqual(warn.findings[0].subject, { taskId: 'PRD-1', scriptId: 'SCR-1' });
  const critical = run([task({ status: 'SUBMITTING', updatedAt: ago(thresholds.taskSubmittingCriticalMs + MIN) })]);
  assert.equal(critical.findings[0].severity, 'critical');
});

test('A recently failed task is flagged with its own message and the way to resume', () => {
  const result = run([task({ status: 'FAILED', preparedScenes: [1], attempts: 1, errorMessage: 'Stopped by the queue: script is not approved.' })]);
  assert.deepEqual(codes(result), ['TASK_FAILED']);
  assert.match(result.findings[0].message, /Stopped by the queue: script is not approved/);
  assert.match(result.findings[0].recovery, /Resume/);
});

test('A failed task older than a week is history, not a finding', () => {
  assert.deepEqual(run([task({ status: 'FAILED', updatedAt: ago(thresholds.taskFailedWindowMs + DAY) })]).findings, []);
});

test('A task that exhausted its retries is reported separately and warns against resuming repeatedly', () => {
  const result = run([task({ status: 'FAILED', preparedScenes: [1], attempts: 4, errorMessage: 'Scene 2 was interrupted 3 times.' })]);
  assert.deepEqual(codes(result), ['TASK_RETRIES_EXHAUSTED']);
  assert.equal(result.findings[0].doNotRerender, true);
  assert.match(result.findings[0].recovery, /Do not resume repeatedly/);
});

test('A submitted task whose render is missing needs reconciliation; one with its render does not', () => {
  const missing = run([task({ status: 'SUBMITTED', renderJobId: 'RND-GONE' })],
    [render({ id: 'RND-OTHER', renderId: 'cr-2', providerResponse: { cloudRun: { executionName: 'e' } } })]);
  assert.deepEqual(codes(missing), ['TASK_LINKED_RENDER_MISSING']);
  assert.equal(missing.findings[0].doNotRerender, true);
  assert.deepEqual(run([task({ status: 'SUBMITTED', renderJobId: 'RND-1' })], [render({ renderId: 'cr-9', providerResponse: { cloudRun: { executionName: 'e' } } })]).findings, []);
});

test('A Cloud Run render still QUEUED without the worker\'s confirmation is an uncertain submission', () => {
  assert.deepEqual(run([], [render({ createdAt: ago(thresholds.submissionUnconfirmedMs - MIN) })]).findings, []);
  const result = run([], [render({ createdAt: ago(thresholds.submissionUnconfirmedMs + MIN) })]);
  assert.deepEqual(codes(result), ['RENDER_SUBMISSION_UNCONFIRMED']);
  assert.equal(result.findings[0].severity, 'warning');
  assert.equal(result.findings[0].doNotRerender, true);
  assert.match(result.findings[0].recovery, /Do not re-render/);
  const hours = run([], [render({ createdAt: ago(thresholds.renderStuckCriticalMs + MIN) })]);
  assert.deepEqual(codes(hours), ['RENDER_SUBMISSION_UNCONFIRMED'], 'one finding, not a second "stuck" one for the same render');
  assert.equal(hours.findings[0].severity, 'critical');
});

test('The uncertain-submission finding is not raised for confirmed or non-Cloud-Run renders', () => {
  const old = ago(2 * HOUR);
  assert.deepEqual(codes(run([], [render({ createdAt: old, providerResponse: { cloudRun: { executionName: 'projects/p/executions/e' } } })])),
    ['RENDER_STUCK_ACTIVE'], 'a confirmed render that is merely slow is a stuck render, not an unconfirmed one');
  assert.deepEqual(codes(run([], [render({ createdAt: old, renderId: 'creatomate-abc' })])), ['RENDER_STUCK_ACTIVE'],
    'a Creatomate render legitimately waits in QUEUED');
  assert.deepEqual(run([], [render({ createdAt: old, status: 'RENDERING', providerResponse: { cloudRun: { operationName: 'op' } } })]).findings.length, 1);
});

test('Task messages are redacted and short', () => {
  const long = 'x'.repeat(500);
  const result = run([task({ status: 'FAILED', errorMessage: 'Provider said Bearer abc.def-123 and sk-secret_value_12345 ' + long })]);
  const text = JSON.stringify(result);
  assert.doesNotMatch(text, /secret_value|abc\.def-123/);
  assert.ok(result.findings[0].message.length < 300);
});

test('Findings that forbid re-rendering say what not to do', () => {
  const result = run([
    task({ id: 'A', status: 'SUBMITTING', updatedAt: ago(2 * HOUR) }),
    task({ id: 'B', status: 'FAILED', preparedScenes: [1], attempts: 5 }),
    task({ id: 'C', status: 'SUBMITTED', renderJobId: 'RND-NONE' })
  ], [render({ createdAt: ago(HOUR) })]);
  assert.ok(result.findings.length >= 4);
  for (const item of result.findings) {
    if (item.doNotRerender) assert.match(item.recovery, /[Dd]o not/, item.code + ' must say what not to do');
  }
});

test('Malformed task input never throws', () => {
  assert.equal(evaluate({ now: NOW, productionTasks: 'nope' }).status, 'ok');
  assert.deepEqual(run([null, {}, { id: 'T' }, task({ status: 'SUBMITTING', updatedAt: 'garbage' })]).findings, []);
});

test('Evaluating never modifies its input', () => {
  service.input = { now: NOW, productionTasks: [task({ status: 'SUBMITTING', updatedAt: ago(2 * HOUR) })], renderJobs: [render({ createdAt: ago(HOUR) })] };
  assert.equal(vm.runInContext(
    'const before = JSON.stringify(input); ProductionHealthService.evaluate(input); JSON.stringify(input) === before', service), true);
});

// ---- through the controller, on the real task repository ----
function fakeSheet() {
  const rows = [];
  return {
    rows,
    getLastRow: () => rows.length, getLastColumn: () => (rows[0] ? rows[0].length : 0), clear() { rows.length = 0; }, setFrozenRows() {},
    getRange(row, col, numRows = 1, numCols = 1) {
      return {
        getValues: () => Array.from({ length: numRows }, (_, r) => Array.from({ length: numCols }, (_, c) => (rows[row - 1 + r] || [])[col - 1 + c] ?? '')),
        getDisplayValues: () => Array.from({ length: numRows }, (_, r) => Array.from({ length: numCols }, (_, c) => String((rows[row - 1 + r] || [])[col - 1 + c] ?? ''))),
        getDisplayValue: () => String((rows[row - 1] || [])[col - 1] ?? ''),
        setValues(values) { values.forEach((vals, r) => { rows[row - 1 + r] = rows[row - 1 + r] || []; vals.forEach((v, c) => { rows[row - 1 + r][col - 1 + c] = v; }); }); return this; },
        setFontWeight() { return this; }
      };
    }
  };
}
function controllerSandbox(options = {}) {
  const sheet = fakeSheet();
  const renders = options.renders || [];
  const context = vm.createContext({
    Utilities: { getUuid: randomUUID }, Logger: { log() {} }, SHEETS: {},
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet, insertSheet: () => sheet }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    LoggingService: { STATUS: { WARNING: 'Warning' }, started() {}, success() {}, failure() {}, log() {} },
    MediaWorkerCallbackInbox: { processPending: () => ({}), processPendingLocked: () => ({}), recentReceipts: () => [] },
    RenderJobRepository: { getAll: () => renders, getById: id => renders.find(job => job.id === id) || null, update: job => job },
    PublishingJobRepository: { getAll: () => [] },
    SeoRepository: { getById: () => null },
    RenderQualityService: { evaluate: () => ({ passed: true }) },
    RenderReviewService: { get: () => ({ approved: false }) },
    Secrets: { getVideoProvider: () => 'cloud-run' }, CreatomateProviderAdapter: {}
  });
  for (const file of ['Production/ProductionError_Service.js', 'Production/ProductionTask_Repository.js',
    'Production/ProductionHealth_Service.js', 'App/ProductionController.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }
  const call = expr => JSON.parse(JSON.stringify(vm.runInContext(expr, context, { timeout: 10000 }) ?? null));
  return { call, sheet, addTask(data) { context.__t = data; return call('ProductionTaskRepository.save(ProductionTaskRepository.create(__t))'); },
    breakTaskSheet() { vm.runInContext('ProductionTaskRepository.getAll = function () { throw new Error("Production Tasks sheet unreadable"); }', context); } };
}

test('The Production page listing carries queue findings from the real task repository', () => {
  const s = controllerSandbox();
  s.addTask({ id: 'PRD-STUCK', scriptId: 'SCR-1', status: 'SUBMITTING', preparedScenes: [1, 2, 3, 4], nextScene: 5, attempts: 4, updatedAt: ago(30 * MIN) });
  const response = s.call('ProductionController.listJobs()');
  assert.equal(response.success, true);
  assert.equal(response.data.health.findings[0].code, 'TASK_STUCK_SUBMITTING');
  assert.equal(response.data.health.findings[0].subject.taskId, 'PRD-STUCK');
});

test('Reading the health panel is read-only: it never settles, submits or rewrites a task', () => {
  const s = controllerSandbox();
  s.addTask({ id: 'PRD-STUCK', scriptId: 'SCR-1', status: 'SUBMITTING', preparedScenes: [1, 2, 3, 4], nextScene: 5, attempts: 4, updatedAt: ago(30 * MIN) });
  const before = JSON.stringify(s.sheet.rows);
  s.call('ProductionController.listJobs()');
  s.call('ProductionController.listJobs()');
  assert.equal(JSON.stringify(s.sheet.rows), before, 'the Production Tasks sheet must be byte-for-byte unchanged');
});

test('An unreadable Production Tasks sheet does not hide the render findings', () => {
  const s = controllerSandbox({ renders: [{ id: 'RND-OLD', renderId: 'cr-abc', scriptId: 'SCR-1', status: 'RENDERING', videoUrl: '',
    providerResponse: { cloudRun: { executionName: 'e' } }, createdAt: ago(2 * HOUR), updatedAt: ago(MIN) }] });
  s.breakTaskSheet();
  const response = s.call('ProductionController.listJobs()');
  assert.equal(response.success, true);
  assert.deepEqual(response.data.health.findings.map(f => f.code), ['RENDER_STUCK_ACTIVE']);
});

console.log(`Production health (queue): ${passed}/${passed} passed.`);
