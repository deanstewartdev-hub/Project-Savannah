'use strict';
// Browser-to-worker tests for the initial render workflow: Create Short, a retry, a prepared task, and the duplicate and
// recovery paths. The Apps Script code runs in a vm with its real controller and its real provider. Each "page" is a
// fresh vm context on a shared sheet, so it behaves as a separate tab or a refresh. Every worker call is answered by the
// real dispatcher HTTP app (media-worker/test/helpers/workerRequest.mjs), in a fresh process, with state on disk.
// Nothing here reaches Cloud Run or a paid service: the job client only counts starts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const WORKER_HELPER = path.join(root, 'media-worker', 'harness', 'workerRequest.mjs');
const SECRET = 'submit-secret-for-tests';
const CALLBACK = 'https://script.google.com/macros/s/TEST/exec';
const TRACK_ID = 'scott-buckley-beyond-these-walls';
const IMAGE = 'europe-west2-docker.pkg.dev/p/r/media-worker@sha256:verified';
const MANIFEST = { tracks: [{
  id: TRACK_ID, file: 'music/scott-buckley-beyond-these-walls.mp3', title: 'Beyond These Walls', licence: 'CC-BY-4.0',
  sourceUrl: 'https://www.scottbuckley.com.au/library/beyond-these-walls/',
  termsUrl: 'https://www.scottbuckley.com.au/library/beyond-these-walls/',
  verifiedBy: 'integration-test', verifiedOn: '2026-11-03', attributionRequired: true,
  attribution: "'Beyond These Walls' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au.",
  monetizationAllowed: true
}] };
function words(count) { return Array.from({ length: count }, (_, i) => 'word' + i).join(' '); }
const SCRIPT = { id: 'SCR-1', title: 'Test', status: 'APPROVED', scenes: [
  { narration: words(30) + '.', visualDirection: 'A clear scene.' },
  { narration: words(30) + '.', visualDirection: 'Another scene.' },
  { narration: words(30) + '.', visualDirection: 'A third scene.' }] };

const tempDirs = [];
process.on('exit', () => { for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true }); });
const clone = value => JSON.parse(JSON.stringify(value));

function newWorld(label) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'savannah-render-' + label + '-'));
  tempDirs.push(stateDir);
  return {
    stateDir,
    config: {
      environment: 'production', serviceName: 'savannah-media-worker-dispatcher', jobRequestPrefix: 'job-requests/',
      jobSubmitSecret: SECRET, project: 'p', region: 'europe-west2', renderJobName: 'savannah-render-job',
      allowedRenderImages: [IMAGE], callbackUrlAllowlist: [CALLBACK + '?route=media-worker-callback'], requireSubmitIntent: false
    },
    faults: { refuseNext: null, dropNextResponse: false },
    calls: 0
  };
}

// One real HTTP request to the worker, served by a fresh process. Returns the worker's status and body.
function workerAnswer(world, request) {
  const input = JSON.stringify({ stateDir: world.stateDir, config: world.config, manifest: MANIFEST, request });
  const result = spawnSync(process.execPath, [WORKER_HELPER], { input, encoding: 'utf8', timeout: 60000 });
  if (result.status !== 0 || !result.stdout) throw new Error('worker process failed: ' + (result.stderr || result.error || 'no output'));
  return JSON.parse(result.stdout.trim());
}

function executions(world) {
  const file = path.join(world.stateDir, 'executions.log');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0;
}

// The shared "sheet": render rows and production tasks. Every page reads and writes the same arrays.
function newSheet(tasks = []) { return { rows: [], tasks }; }

// One page: a fresh vm context with the real controller and provider, on the shared sheet and world.
function openPage(world, sheet) {
  const context = vm.createContext({
    Utilities: { getUuid: randomUUID },
    Logger: { log() {} },
    LoggingService: { started() {}, success() {}, failure() {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    Secrets: {
      getMediaWorkerUrl: () => 'https://worker.example',
      getMediaWorkerJobSubmitSecret: () => SECRET,
      getMediaWorkerSharedSecret: () => 'callback-secret-for-tests',
      getMediaWorkerCallbackUrl: () => CALLBACK,
      getVideoProvider: () => 'cloud-run',
      getCreatomateTemplateId: () => 'tpl'
    },
    UrlFetchApp: {
      fetch(url, options) {
        const urlPath = url.replace('https://worker.example', '');
        // Faults apply only to the render submission itself (POST /jobs), never to the health check that runs first.
        const isSubmission = urlPath === '/jobs' && String(options.method || '').toLowerCase() === 'post';
        if (isSubmission) world.calls += 1;
        if (isSubmission && world.faults.refuseNext) {
          const status = world.faults.refuseNext;
          world.faults.refuseNext = null;
          return { getResponseCode: () => status, getContentText: () => JSON.stringify({ error: 'refused by test' }) };
        }
        // Health checks carry no headers; every other request carries the submit secret, as request_ sends it.
        const headers = options.headers ? { Authorization: options.headers.Authorization } : {};
        const answer = workerAnswer(world, {
          method: String(options.method || 'get').toUpperCase(), path: urlPath,
          headers: headers, body: options.payload
        });
        if (isSubmission && world.faults.dropNextResponse) {
          // The worker has already acted; the reply is lost on the way back.
          world.faults.dropNextResponse = false;
          throw new Error('Timeout: the media worker did not answer');
        }
        return { getResponseCode: () => answer.status, getContentText: () => answer.body };
      }
    },
    ScriptsRepository: { getScriptById: id => (id === SCRIPT.id ? clone(SCRIPT) : null) },
    SeoRepository: { getByScriptId: () => ({ id: 'SEO-1' }) },
    PublishingJobRepository: { getAll: () => [] },
    CreatomateProviderAdapter: {},
    RenderJobRepository: {
      getAll: () => clone(sheet.rows),
      getById: id => clone(sheet.rows.find(row => row.id === id) || null),
      getByRenderId: id => clone(sheet.rows.find(row => row.renderId === id) || null),
      save(job) { sheet.rows.push(clone(job)); return clone(job); },
      update(job) {
        const index = sheet.rows.findIndex(row => row.id === job.id);
        if (index === -1) throw new Error('render row not found');
        sheet.rows[index] = clone(job);
        return clone(job);
      }
    },
    ProductionTaskRepository: {
      getById: id => clone(sheet.tasks.find(task => task.id === id) || null),
      update: (task, changes) => Object.assign({}, task, changes || {}, { id: task.id, updatedAt: new Date().toISOString() }),
      persist(task) {
        const index = sheet.tasks.findIndex(row => row.id === task.id);
        if (index === -1) sheet.tasks.push(clone(task)); else sheet.tasks[index] = clone(task);
        return clone(task);
      }
    }
  });
  for (const file of [
    'Utils/EnvironmentGuard.js', 'Production/VideoProcessingProvider.js',
    'Models/RenderJob.js', 'Production/ProductionError_Service.js', 'App/ProductionController.js'
  ]) {
    vm.runInContext(read(file), context, { filename: file });
  }
  const call = expression => vm.runInContext(expression, context);
  return {
    submit: (requestId, scriptId = 'SCR-1') => call('ProductionController.submit(' + JSON.stringify({ scriptId, clientRequestId: requestId }) + ')'),
    retry: request => call('ProductionController.retry(' + JSON.stringify(request) + ')'),
    submitPrepared: taskId => call('ProductionController.submitPrepared(' + JSON.stringify({ taskId }) + ')')
  };
}

const cases = [
  ['Create Short with a request ID starts one render, as version 1, with its intent recorded', () => {
    const world = newWorld('first'), sheet = newSheet();
    const result = openPage(world, sheet).submit('rq-first-0001');
    assert.equal(result.success, true, result.error && result.error.message);
    assert.equal(sheet.rows.length, 1);
    assert.equal(sheet.rows[0].status, 'RENDERING');
    assert.equal(sheet.rows[0].requestPayload.version, 1);
    assert.equal(sheet.rows[0].requestPayload.clientRequestId, 'rq-first-0001');
    assert.equal(executions(world), 1);
    assert.ok(fs.readdirSync(path.join(world.stateDir, 'state')).some(name => name.startsWith('submit-intents%2F')),
      'the worker recorded the submit intent');
  }],
  ['a double click (same request ID) starts nothing new', () => {
    const world = newWorld('double'), sheet = newSheet(), page = openPage(world, sheet);
    page.submit('rq-double-0001');
    const second = page.submit('rq-double-0001');
    assert.equal(second.success, true);
    assert.equal(second.data.duplicate, true);
    assert.equal(sheet.rows.length, 1, 'no second row');
    assert.equal(executions(world), 1, 'no second execution');
  }],
  ['two tabs and a refresh reuse the request ID: each new page starts nothing', () => {
    const world = newWorld('tabs'), sheet = newSheet();
    openPage(world, sheet).submit('rq-tabs-0001');
    const otherTab = openPage(world, sheet).submit('rq-tabs-0001');
    const afterRefresh = openPage(world, sheet).submit('rq-tabs-0001');
    assert.equal(otherTab.data.duplicate, true);
    assert.equal(afterRefresh.data.duplicate, true);
    assert.equal(sheet.rows.length, 1);
    assert.equal(executions(world), 1);
  }],
  ['an interrupted request (worker started it, reply lost) stays active: the same ID replays, a new ID is refused', () => {
    const world = newWorld('interrupted'), sheet = newSheet(), page = openPage(world, sheet);
    world.faults.dropNextResponse = true;
    const lost = page.submit('rq-lost-0001');
    assert.equal(lost.success, false);
    assert.equal(lost.outcomeUnknown, true, 'the page must keep its request ID');
    assert.match(lost.error.message, /Do not re-render/);
    assert.equal(sheet.rows[0].status, 'QUEUED');
    assert.equal(executions(world), 1);
    const replay = page.submit('rq-lost-0001');
    assert.equal(replay.data.duplicate, true);
    const other = page.submit('rq-other-0002');
    assert.equal(other.success, false);
    assert.match(other.error.message, /already has an active render/);
    assert.equal(executions(world), 1, 'still exactly one execution');
  }],
  ['recovery when the local row is lost: the worker recognises the request and adopts its job, with no second render', () => {
    const world = newWorld('recovery'), first = newSheet();
    openPage(world, first).submit('rq-recover-0001');
    const emptied = newSheet();
    const recovered = openPage(world, emptied).submit('rq-recover-0001');
    assert.equal(recovered.success, true);
    assert.equal(recovered.data.duplicate, true);
    assert.equal(emptied.rows.length, 1);
    assert.equal(emptied.rows[0].status, 'QUEUED', 'the adopted job stays active until it is reconciled');
    assert.equal(emptied.rows[0].renderId, first.rows[0].renderId, 'adopts the worker\'s job ID');
    assert.equal(executions(world), 1);
    const blocked = openPage(world, emptied).submit('rq-recover-0002');
    assert.equal(blocked.success, false, 'the adopted row blocks any other render');
    assert.equal(executions(world), 1);
  }],
  ['a different request for a version the worker already claimed is refused, and starts nothing', () => {
    const world = newWorld('claimed'), first = newSheet();
    openPage(world, first).submit('rq-claimed-0001');
    const emptied = newSheet();
    const refused = openPage(world, emptied).submit('rq-claimed-0002');
    assert.equal(refused.success, false);
    assert.equal(emptied.rows[0].status, 'FAILED');
    assert.equal(emptied.rows[0].renderId, '', 'the refused row must not hold a job ID');
    assert.equal(executions(world), 1);
  }],
  ['a failed first attempt does not block the owner: a new request renders as version 2, and the failed ID is not replayed', () => {
    const world = newWorld('failed'), sheet = newSheet(), page = openPage(world, sheet);
    world.faults.refuseNext = 400;
    const failed = page.submit('rq-failed-0001');
    assert.equal(failed.success, false);
    assert.notEqual(failed.outcomeUnknown, true, 'a refusal before the start is definite');
    assert.equal(sheet.rows[0].status, 'FAILED');
    assert.equal(executions(world), 0);
    const callsBefore = world.calls;
    const replayed = page.submit('rq-failed-0001');
    assert.equal(replayed.success, false, 'a failed request is not started again under its own ID');
    assert.match(replayed.error.message, /already failed/);
    assert.equal(world.calls, callsBefore, 'the worker is not called for a failed request');
    const fresh = page.submit('rq-failed-0002');
    assert.equal(fresh.success, true, fresh.error && fresh.error.message);
    assert.equal(sheet.rows[sheet.rows.length - 1].requestPayload.version, 2);
    assert.equal(executions(world), 1);
  }],
  ['requireSubmitIntent can be enabled: a first render with its fields starts, and the worker refuses a request without them', () => {
    const world = newWorld('required'); world.config.requireSubmitIntent = true;
    const sheet = newSheet();
    const result = openPage(world, sheet).submit('rq-required-0001');
    assert.equal(result.success, true, result.error && result.error.message);
    assert.equal(executions(world), 1);
    const bare = workerAnswer(world, {
      method: 'POST', path: '/jobs', headers: { Authorization: 'Bearer ' + SECRET },
      body: JSON.stringify({ jobId: 'cr-' + randomUUID(), beats: [{ text: 'Blue walls.', visualQuery: 'blue' }],
        musicTrackId: TRACK_ID, callbackUrl: CALLBACK })
    });
    assert.equal(bare.status, 400, 'a request without the intent fields is refused');
    assert.equal(executions(world), 1);
  }],
  ['a prepared task is submitted once: its request ID comes from its claim, and a new claim while a render is active is refused', () => {
    const world = newWorld('prepared');
    const now = new Date().toISOString();
    const sheet = newSheet([{ id: 'PRD-ABCDEF12', scriptId: 'SCR-1', status: 'READY', preparedScenes: [1, 2, 3, 4],
      sourceRenderJobId: '', createdAt: now, updatedAt: now }]);
    const page = openPage(world, sheet);
    const submitted = page.submitPrepared('PRD-ABCDEF12');
    assert.equal(submitted.success, true, submitted.error && submitted.error.message);
    assert.equal(sheet.tasks[0].status, 'SUBMITTED');
    assert.match(sheet.rows[0].requestPayload.clientRequestId, /^task-PRD-ABCDEF12-[0-9a-z]+$/);
    assert.equal(executions(world), 1);
    sheet.tasks[0].status = 'READY';
    const again = page.submitPrepared('PRD-ABCDEF12');
    assert.equal(again.success, false);
    assert.match(again.error.message, /already has an active render/);
    assert.equal(executions(world), 1, 'still exactly one execution');
  }],
  ['the Photogenic first render, with two earlier failed records for the same script, starts as version 2 and no older record blocks it', () => {
    // The two 10 November renders were recorded without a version, failed, and had no intent. Rows without a stored
    // version count as version 1, so the next render is version 2, and nothing claims version 2 yet.
    const world = newWorld('photogenic');
    const sheet = newSheet();
    sheet.rows.push(
      { id: 'JOB-OLD-A', scriptId: 'SCR-1', renderId: 'cr-9b3bed34-8889-4fbe-82db-c0055881e083', status: 'FAILED',
        errorMessage: 'earlier attempt', requestPayload: { preparationStatus: 'assets-ready' } },
      { id: 'JOB-OLD-B', scriptId: 'SCR-1', renderId: 'cr-8556be9c-679e-4161-9328-c5e9e85a808b', status: 'FAILED',
        errorMessage: 'earlier attempt', requestPayload: { preparationStatus: 'assets-ready' } });
    const result = openPage(world, sheet).submit('rq-photogenic-0001');
    assert.equal(result.success, true, result.error && result.error.message);
    assert.equal(sheet.rows[sheet.rows.length - 1].requestPayload.version, 2);
    assert.equal(executions(world), 1);
  }],
  ['the worker still accepts a request without the intent fields while requireSubmitIntent is off (rollout order: worker first)', () => {
    const world = newWorld('rollout-old-client');
    const answer = workerAnswer(world, {
      method: 'POST', path: '/jobs', headers: { Authorization: 'Bearer ' + SECRET },
      body: JSON.stringify({ jobId: 'cr-' + randomUUID(), beats: [{ text: 'Blue walls.', visualQuery: 'blue' }],
        musicTrackId: TRACK_ID, callbackUrl: CALLBACK + '?route=media-worker-callback' })
    });
    assert.equal(answer.status, 202, 'the currently deployed Apps Script keeps working: ' + answer.body);
    assert.equal(executions(world), 1);
  }],
  ['rollback rehearsal: turning requireSubmitIntent back off accepts the older client again, and a new request still starts once', () => {
    const world = newWorld('rollback');
    world.config.requireSubmitIntent = true;
    const bare = () => workerAnswer(world, {
      method: 'POST', path: '/jobs', headers: { Authorization: 'Bearer ' + SECRET },
      body: JSON.stringify({ jobId: 'cr-' + randomUUID(), beats: [{ text: 'Blue walls.', visualQuery: 'blue' }],
        musicTrackId: TRACK_ID, callbackUrl: CALLBACK + '?route=media-worker-callback' })
    });
    assert.equal(bare().status, 400, 'with the flag on, the older client is refused');
    world.config.requireSubmitIntent = false;
    assert.equal(bare().status, 202, 'with the flag back off, the older client is accepted');
    const sheet = newSheet();
    const result = openPage(world, sheet).submit('rq-rollback-0001');
    assert.equal(result.success, true, 'the new client still renders after rollback');
    assert.equal(executions(world), 2, 'exactly one execution per accepted request');
  }],
  ['a retry without a request ID is refused before anything is read or started', () => {
    const world = newWorld('retry'), sheet = newSheet();
    const result = openPage(world, sheet).retry({ jobId: 'JOB-NONE' });
    assert.equal(result.success, false);
    assert.match(result.error.message, /request ID is required/);
    assert.equal(world.calls, 0);
    assert.equal(executions(world), 0);
  }]
];

let failed = 0;
for (const [name, run] of cases) {
  try { run(); console.log('PASS ' + name); } catch (error) {
    failed++;
    const where = String(error.stack || '').split('\n').slice(1, 4).map(line => '    ' + line.trim()).join('\n');
    console.log('FAIL ' + name + ': ' + error.message + '\n' + where);
  }
}
console.log('Initial render workflow (browser to worker): ' + (cases.length - failed) + '/' + cases.length + ' passed.');
if (failed > 0) process.exit(1);
