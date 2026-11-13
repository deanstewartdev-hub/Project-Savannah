'use strict';
// Render New Version: version numbering, duplicate and concurrent protection, original-row
// preservation, failed re-renders, the cost confirmation, the removed client bypass, and the
// upload guard. Runs the real ProductionController against an in-memory render store.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const SCRIPT_ID = 'SCR-VERSIONED';
const COST = 1;

function fixture(options = {}) {
  const rows = [];
  const publishingJobs = options.publishingJobs || [];
  const worker = { calls: [], fail: null, nested: null, reviewLookups: [] };
  let lockHeld = false;
  const provider = {
    reserveRenderId: () => 'cr-' + randomUUID(),
    submitRender(scriptArg, seoPack, opts) {
      worker.calls.push(opts.renderId);
      if (worker.nested) worker.nested(); // simulates a second request arriving while this one runs
      if (worker.fail) throw worker.fail;
      return { render: { id: opts.renderId, status: 'RENDERING', progress: 0 }, payload: { provider: 'test' } };
    }
  };
  const context = vm.createContext({
    Utilities: { getUuid: randomUUID }, Logger: { log() {} },
    LockService: { getScriptLock: () => ({
      tryLock: () => { if (lockHeld) return false; lockHeld = true; return true; },
      releaseLock: () => { lockHeld = false; }
    }) },
    ScriptsRepository: { getScriptById: id => options.noScript ? null : ({ id, status: options.status || 'APPROVED' }) },
    SeoRepository: { getByScriptId: () => ({ id: 'SEO-1' }) },
    PublishingJobRepository: { getAll: () => publishingJobs },
    Secrets: { getCreatomateTemplateId: () => 'tpl' },
    VideoProcessingProvider: { get: () => provider, forJob: () => provider },
    CreatomateProviderAdapter: {},
    RenderQualityService: { evaluate: () => ({ passed: true }) },
    // Review records are keyed by render job ID. Approval given to one job must not carry to another.
    RenderReviewService: { get: id => { worker.reviewLookups.push(id); return { approved: (options.approvedJobIds || []).indexOf(id) !== -1 }; } },
    MediaWorkerCallbackInbox: { processPending: () => ({}), processPendingLocked: () => ({}) },
    RenderJobRepository: {
      getAll: () => rows.map(r => JSON.parse(JSON.stringify(r))),
      getById: id => { const r = rows.find(x => x.id === id); return r ? JSON.parse(JSON.stringify(r)) : null; },
      save(job) { rows.push(JSON.parse(JSON.stringify(job))); return job; },
      update(job) { const i = rows.findIndex(x => x.id === job.id); rows[i] = JSON.parse(JSON.stringify(job)); return job; }
    }
  });
  for (const file of ['Models/RenderJob.js', 'Production/ProductionError_Service.js', 'App/ProductionController.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }
  // Public actions return { success, data, error } rather than throwing; unwrap so the tests see
  // exactly what a caller in the UI would see.
  const call = expr => {
    const result = vm.runInContext(expr, context);
    if (result && typeof result === "object" && "success" in result) {
      if (result.success === false) throw new Error(result.error && result.error.message || "Production request failed.");
      return result.data;
    }
    return result;
  };
  return { rows, worker, call, seedRow: row => rows.push(Object.assign({
    id: 'RND-' + randomUUID().slice(0, 8).toUpperCase(), scriptId: SCRIPT_ID, seoPackId: 'SEO-1', templateId: 'x',
    status: 'SUCCEEDED', progress: 100, renderId: 'cr-' + randomUUID(), videoUrl: 'https://storage.example/final.mp4',
    requestPayload: {}, providerResponse: {}, version: 1
  }, row)) };
}

const newVersion = (f, clientRequestId, extra) => f.call(
  'ProductionController.renderNewVersion(' + JSON.stringify(Object.assign({ scriptId: SCRIPT_ID, clientRequestId, confirmedMaxCostGbp: COST }, extra || {})) + ')');
const versionOf = row => (row.requestPayload && row.requestPayload.version) || 1;

const cases = [
  ['the first new version is version 2 and the original row is version 1', () => {
    const f = fixture();
    f.seedRow({ id: 'RND-ORIGINAL', requestPayload: {} });
    newVersion(f, 'req-aaaaaaaa');
    assert.equal(f.rows.length, 2);
    assert.equal(versionOf(f.rows[0]), 1);
    assert.equal(versionOf(f.rows[1]), 2);
    assert.equal(f.rows[1].requestPayload.clientRequestId, 'req-aaaaaaaa');
  }],
  ['versions are sequential across several completed renders', () => {
    const f = fixture();
    f.seedRow({ requestPayload: {} });
    newVersion(f, 'req-bbbbbbbb');
    f.rows[1].status = 'SUCCEEDED'; f.rows[1].videoUrl = 'https://storage.example/v2.mp4';
    newVersion(f, 'req-cccccccc');
    assert.deepEqual(f.rows.map(versionOf), [1, 2, 3]);
  }],
  ['each new render gets its own unique render ID', () => {
    const f = fixture();
    f.seedRow({});
    newVersion(f, 'req-dddddddd');
    f.rows[1].status = 'SUCCEEDED'; f.rows[1].videoUrl = 'https://storage.example/v2.mp4';
    newVersion(f, 'req-eeeeeeee');
    const ids = f.rows.map(r => r.renderId);
    assert.equal(new Set(ids).size, ids.length);
  }],
  ['a repeated request with the same client request ID returns the first row and calls the worker once', () => {
    const f = fixture();
    f.seedRow({});
    const first = newVersion(f, 'req-ffffffff');
    const second = newVersion(f, 'req-ffffffff');
    assert.equal(f.worker.calls.length, 1, 'one worker call');
    assert.equal(f.rows.length, 2, 'one new row');
    assert.equal(second.duplicate, true);
    assert.equal(second.job.id, first.job.id);
  }],
  ['a fresh request is refused while a render for the script is active', () => {
    const f = fixture();
    f.seedRow({});
    f.seedRow({ status: 'RENDERING', requestPayload: { version: 2 } });
    assert.throws(() => newVersion(f, 'req-gggggggg'), /active render/);
    assert.equal(f.worker.calls.length, 0);
  }],
  ['a concurrent second request is refused while the first holds the script lock', () => {
    const f = fixture();
    f.seedRow({});
    let nestedError = null;
    f.worker.nested = () => {
      try { newVersion(f, 'req-hhhhhhhh'); } catch (caught) { nestedError = caught; }
    };
    newVersion(f, 'req-iiiiiiii');
    assert.equal(f.worker.calls.length, 1, 'only the first request reaches the worker');
    assert.ok(nestedError && /Another production action is running/.test(nestedError.message), 'the concurrent request is refused by the lock');
  }],
  ['the original completed row is identical before and after a new version', () => {
    const f = fixture();
    f.seedRow({ id: 'RND-KEEP', requestPayload: { provider: 'original' }, providerResponse: { note: 'kept' } });
    const before = JSON.stringify(f.rows[0]);
    newVersion(f, 'req-jjjjjjjj');
    assert.equal(JSON.stringify(f.rows[0]), before);
  }],
  ['the version marker and client request ID survive the worker payload merge', () => {
    const f = fixture();
    f.seedRow({});
    newVersion(f, 'req-kkkkkkkk');
    assert.equal(f.rows[1].requestPayload.version, 2);
    assert.equal(f.rows[1].requestPayload.clientRequestId, 'req-kkkkkkkk');
    assert.equal(f.rows[1].requestPayload.provider, 'test', 'worker payload kept');
  }],
  ['a failed new version leaves the completed version and its URL unchanged', () => {
    const f = fixture();
    f.seedRow({ videoUrl: 'https://storage.example/original.mp4' });
    f.worker.fail = new Error('worker rejected the job');
    assert.throws(() => newVersion(f, 'req-llllllll'));
    assert.equal(f.rows[0].videoUrl, 'https://storage.example/original.mp4');
    assert.equal(f.rows[0].status, 'SUCCEEDED');
    assert.equal(f.rows[1].status, 'FAILED');
    assert.equal(versionOf(f.rows[1]), 2);
  }],
  ['retrying a failed version takes the next version number', () => {
    const f = fixture();
    f.seedRow({});
    f.worker.fail = new Error('worker rejected the job');
    assert.throws(() => newVersion(f, 'req-mmmmmmmm'));
    f.worker.fail = null;
    f.call('ProductionController.retry({ jobId: "' + f.rows[1].id + '", clientRequestId: "rq-retry-0001" })');
    const retried = f.rows[f.rows.length - 1];
    assert.equal(versionOf(retried), 3, 'the next version number: a failed attempt is never re-rendered under its own number');
    assert.equal(f.rows.filter(r => versionOf(r) === 2).length, 1, 'the failed attempt keeps version 2');
  }],
  ['a new version is refused without the cost confirmation, before any row is written', () => {
    const f = fixture();
    f.seedRow({});
    assert.throws(() => f.call('ProductionController.renderNewVersion({scriptId:"' + SCRIPT_ID + '",clientRequestId:"req-nnnnnnnn"})'), /Confirm the maximum cost/);
    assert.throws(() => newVersion(f, 'req-oooooooo', { confirmedMaxCostGbp: 5 }), /Confirm the maximum cost/);
    assert.equal(f.rows.length, 1);
    assert.equal(f.worker.calls.length, 0);
  }],
  ['a malformed client request ID is refused', () => {
    const f = fixture();
    f.seedRow({});
    assert.throws(() => newVersion(f, 'x'), /request ID is required/);
    assert.equal(f.worker.calls.length, 0);
  }],
  ['a new version needs a completed render first', () => {
    const f = fixture();
    f.seedRow({ status: 'FAILED', videoUrl: '' });
    assert.throws(() => newVersion(f, 'req-pppppppp'), /needs a completed render first/);
    assert.equal(f.worker.calls.length, 0);
  }],
  ['the client forceRerender flag is ignored: a completed script cannot be re-rendered through submit', () => {
    const f = fixture();
    f.seedRow({});
    assert.throws(() => f.call('ProductionController.submit({scriptId:"' + SCRIPT_ID + '",forceRerender:true,clientRequestId:"rq-direct-0004"})'), /Render New Version/);
    assert.equal(f.worker.calls.length, 0);
  }],
  ['a protected upload of the script blocks a new version', () => {
    const f = fixture({ publishingJobs: [{ scriptId: SCRIPT_ID, status: 'PUBLISHED' }] });
    f.seedRow({});
    assert.throws(() => newVersion(f, 'req-qqqqqqqq'), /YouTube upload/);
    assert.equal(f.worker.calls.length, 0);
  }],
  ['version 2 does not inherit approval from version 1', () => {
    const f = fixture({ approvedJobIds: ['RND-V1'] });
    f.seedRow({ id: 'RND-V1' });
    newVersion(f, 'req-isolate01');
    const v2 = f.rows[1].id;
    assert.equal(f.call('RenderReviewService.get("RND-V1").approved'), true, 'version 1 stays approved');
    assert.equal(f.call('RenderReviewService.get("' + v2 + '").approved'), false, 'version 2 starts unapproved');
  }],
  ['review and quality are looked up by each render\'s own ID', () => {
    const f = fixture({ approvedJobIds: ['RND-V1'] });
    f.seedRow({ id: 'RND-V1' });
    newVersion(f, 'req-isolate02');
    f.call('RenderReviewService.get("RND-V1")');
    assert.ok(f.worker.reviewLookups.includes('RND-V1'));
    assert.ok(f.worker.reviewLookups.every(function (id) { return id === 'RND-V1' || id === f.rows[1].id; }));
  }],
  ['the original video URL is unchanged by a new version', () => {
    const f = fixture();
    f.seedRow({ id: 'RND-V1', videoUrl: 'https://storage.example/v1.mp4' });
    newVersion(f, 'req-isolate03');
    assert.equal(f.rows[0].videoUrl, 'https://storage.example/v1.mp4');
    assert.notEqual(f.rows[1].videoUrl, 'https://storage.example/v1.mp4');
  }],
  ['an unapproved script cannot get a new version', () => {
    const f = fixture({ status: 'PENDING_APPROVAL' });
    f.seedRow({});
    assert.throws(() => newVersion(f, 'req-rrrrrrrr'), /approved script/);
    assert.equal(f.worker.calls.length, 0);
  }]
];

let failed = 0;
for (const [name, run] of cases) {
  try { run(); console.log('PASS ' + name); } catch (error) { failed++; console.log('FAIL ' + name + ': ' + error.message); }
}
console.log('Render new version: ' + (cases.length - failed) + '/' + cases.length + ' passed.');
if (failed > 0) process.exit(1);
