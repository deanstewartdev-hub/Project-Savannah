'use strict';
// The whole 3-step staging procedure, run locally end to end:
//   stagingSeedRenderJobs  ->  run-staging-callbacks.cjs  ->  REAL CallbackBridge doPost
//   -> shared spreadsheet -> REAL MediaWorkerCallbackInbox -> stagingVerifyRun.
// Only the HTTP hop and Google services are faked. Proves the procedure itself is
// correct before anyone runs it against Google.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const runner = require('./staging/run-staging-callbacks.cjs');
const { payloadFor } = require('./staging/send-synthetic-callback.cjs');
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }

const SECRET = 'staging-only-shared-secret';
const STAGING_ENV = { SAVANNAH_STAGING_BRIDGE_URL: 'https://script.google.com/macros/s/AKfycbSTAGINGbridge/exec', SAVANNAH_STAGING_CALLBACK_SECRET: SECRET };

function spreadsheet() {
  const sheets = {};
  function sheet(name) {
    const data = [];
    return {
      name, data,
      getLastRow: () => data.length,
      setFrozenRows() {},
      getRange: (row, col, nr, nc) => ({
        getValues: () => data.slice(row - 1, row - 1 + (nr || 1)).map(r => r.slice(col - 1, col - 1 + (nc || 1))),
        getDisplayValues: () => data.slice(row - 1, row - 1 + (nr || 1)).map(r => r.slice(col - 1, col - 1 + (nc || 1)).map(String)),
        setValues: values => values.forEach((v, i) => {
          while (data.length < row + i) data.push(new Array(7).fill(''));
          v.forEach((cell, j) => { data[row - 1 + i][col - 1 + j] = cell; });
        }),
        setValue: value => { data[row - 1][col - 1] = value; }
      })
    };
  }
  return {
    sheets,
    getSheetByName: name => sheets[name] || null,
    insertSheet: name => (sheets[name] = sheet(name))
  };
}

function world(options) {
  const opts = options || {};
  const mainSheet = spreadsheet();
  const otherSheet = spreadsheet();
  const bridgeTarget = opts.bridgeWritesElsewhere ? otherSheet : mainSheet;

  // --- the standalone bridge project, real code ---
  const bridge = vm.createContext({
    Logger: { log() {} }, Utilities: { getUuid: randomUUID },
    PropertiesService: { getScriptProperties: () => ({ getProperty: n => ({ MEDIA_WORKER_SHARED_SECRET: SECRET, RENDER_JOBS_SPREADSHEET_ID: 'sheet-id' })[n] || null }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    SpreadsheetApp: { openById: () => bridgeTarget },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ setMimeType: () => ({ text }) }) }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'CallbackBridge/CallbackBridge.js'), 'utf8'), bridge, { filename: 'CallbackBridge.js' });
  const transport = async (target, scenario, renderId) => {
    const payload = payloadFor(scenario, renderId);
    const secret = scenario === 'bad-secret' ? 'wrong' : target.secret;
    bridge.__event = { parameter: { route: 'media-worker-callback', secret }, postData: { contents: JSON.stringify(payload) } };
    return { response: JSON.parse(vm.runInContext('doPost(__event)', bridge).text) };
  };

  // --- the main project (staging copy), real inbox + verifier, in-memory Render Jobs ---
  const props = Object.assign({}, opts.mainProps === undefined ? { SAVANNAH_ENVIRONMENT: 'staging' } : opts.mainProps);
  const jobs = {};
  const main = vm.createContext({
    Logger: { log() {} }, Utilities: { getUuid: randomUUID },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => mainSheet },
    RenderJobRepository: {
      getByRenderId: id => Object.values(jobs).find(j => j.renderId === id) || null,
      getById: id => jobs[id] || null,
      update: j => (jobs[j.id] = JSON.parse(JSON.stringify(j)))
    },
    ProductionTaskRepository: { getAll: () => opts.tasks || [] },
    ProductionController: {},
    Secrets: { getVideoProvider: () => 'cloud-run' }
  });
  for (const file of ['Models/RenderJob.js', 'Production/VideoLink_Service.js', 'Production/MediaWorkerCallbackInbox_Service.js',
    'Production/ProductionQueue_Service.js', 'Production/StagingVerification_Service.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), main, { filename: file });
  }
  const inbox = vm.runInContext('MediaWorkerCallbackInbox', main);
  const queue = vm.runInContext('ProductionQueueService', main);
  const model = vm.runInContext('RenderJobModel', main);
  const env = {
    property: n => (n in props ? props[n] : null), setProperty: (n, v) => { props[n] = v; },
    uuid: randomUUID, now: () => Date.now(),
    createRenderJob: (id, renderId) => {
      if (jobs[id]) throw new Error('Render job already exists.');
      jobs[id] = JSON.parse(JSON.stringify(model.create({ id, renderId, scriptId: 'SCR-STAGING', templateId: 'cloud-run-worker', status: 'RENDERING', progress: 10 })));
    },
    renderJob: id => (jobs[id] ? JSON.parse(JSON.stringify(jobs[id])) : null),
    receipts: () => JSON.parse(JSON.stringify(inbox.recentReceipts(500))),
    drain: () => inbox.processPending(),
    listJobs: () => ({ success: true, data: { health: { status: 'ok', counts: { total: 0 } } } }),
    listReady: () => ({ success: true, data: {} }),
    queueStatus: () => ({ actionableTasks: (opts.tasks || []).length }),
    queueTick: () => JSON.parse(JSON.stringify(queue.processNext())),
    qualityPasses: job => job.status === 'SUCCEEDED' && !!job.videoUrl, // stand-in for RenderQualityService
    publishingJobs: () => [],
    readiness: () => ({ status: 'WARNINGS', checks: [{ id: 'callback-url', level: 'warn' }] })
  };
  const service = vm.runInContext('StagingVerificationService', main);
  return {
    seed: () => JSON.parse(JSON.stringify(service.seed(env))),
    verify: () => JSON.parse(JSON.stringify(service.verify(env))),
    runCallbacks: argv => runner.run(argv, STAGING_ENV, transport),
    jobs, mainSheet, props
  };
}

const argvFrom = command => command.split(' ').slice(2);
const results = report => Object.fromEntries(report.checks.map(c => [c.id, c.result]));

(async () => {
  await test('Full staging procedure passes end to end against the real bridge and inbox', async () => {
    const w = world();
    const seeded = w.seed();
    assert.match(seeded.command, /^node node-tests\/staging\/run-staging-callbacks\.cjs --i-am-targeting-staging( cr-[0-9a-f-]{36}){5}$/);
    const bridgeChecks = await w.runCallbacks(argvFrom(seeded.command));
    assert.equal(bridgeChecks.filter(r => !r.ok).length, 0, JSON.stringify(bridgeChecks.filter(r => !r.ok)));
    assert.equal(bridgeChecks.length, 12);
    const report = w.verify();
    assert.equal(report.status, 'PASSED', JSON.stringify(report.checks.filter(c => c.result !== 'PASS'), null, 2));
    assert.deepEqual(results(report), { C1: 'PASS', C2: 'PASS', C3: 'PASS', C4: 'PASS', C5: 'PASS', C6: 'PASS', C7: 'PASS',
      C8: 'PASS', C9: 'PASS', C10: 'PASS', C11: 'PASS', C12: 'PASS' });
  });

  await test('Re-running stagingVerifyRun is safe and still passes', async () => {
    const w = world();
    const seeded = w.seed();
    await w.runCallbacks(argvFrom(seeded.command));
    w.verify();
    const again = w.verify();
    assert.equal(again.status, 'PASSED', JSON.stringify(again.checks.filter(c => c.result !== 'PASS')));
  });

  await test('Bridge pointed at a different spreadsheet fails C1 with a clear explanation', async () => {
    const w = world({ bridgeWritesElsewhere: true });
    const seeded = w.seed();
    await w.runCallbacks(argvFrom(seeded.command));
    const report = w.verify();
    assert.equal(report.status, 'FAILED');
    const c1 = report.checks.find(c => c.id === 'C1');
    assert.equal(c1.result, 'FAIL');
    assert.match(c1.detail, /RENDER_JOBS_SPREADSHEET_ID points at another spreadsheet/);
  });

  await test('Seeding and verifying refuse without SAVANNAH_ENVIRONMENT=staging (production safety)', async () => {
    for (const mainProps of [{}, { SAVANNAH_ENVIRONMENT: 'production' }]) {
      const w = world({ mainProps });
      assert.throws(() => w.seed(), /Refused: this is not marked as a staging project/);
      assert.throws(() => w.verify(), /Refused/);
      assert.deepEqual(Object.keys(w.jobs), [], 'Nothing may be written when refused.');
    }
  });

  await test('Queue check is skipped, not run, when paid scene preparation is waiting', async () => {
    const w = world({ tasks: [{ id: 'TSK-1', status: 'PREPARING' }] });
    const seeded = w.seed();
    await w.runCallbacks(argvFrom(seeded.command));
    const report = w.verify();
    assert.equal(results(report).C10, 'SKIP');
    assert.equal(report.status, 'PASSED');
  });

  await test('Runner refuses bad input before sending anything', async () => {
    const w = world();
    const ids = Array.from({ length: 5 }, () => 'cr-' + randomUUID());
    await assert.rejects(() => w.runCallbacks(ids), /--i-am-targeting-staging/);
    await assert.rejects(() => w.runCallbacks(['--i-am-targeting-staging'].concat(ids.slice(0, 4))), /five cr-<uuid>/);
    await assert.rejects(() => w.runCallbacks(['--i-am-targeting-staging', ids[0], ids[0], ids[1], ids[2], ids[3]]), /all be different/);
    await assert.rejects(() => runner.run(['--i-am-targeting-staging'].concat(ids),
      { SAVANNAH_STAGING_BRIDGE_URL: 'https://script.google.com/macros/s/AKfycbzfD4HhW82TJyrdl5wteB1L84uiQJqb_hANd106zLDOOpY4HKqclGv67noe-kpQn2vDDw/exec', SAVANNAH_STAGING_CALLBACK_SECRET: 'x' },
      async () => { throw new Error('must not send'); }), /PRODUCTION/);
  });

  console.log(`Staging flow end to end: ${passed}/${passed} passed.`);
})().catch(error => { console.error(error); process.exit(1); });
