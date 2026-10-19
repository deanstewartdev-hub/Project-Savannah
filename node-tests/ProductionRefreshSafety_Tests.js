'use strict';
// Regression tests: callback state must win over stale manual/automatic polling.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
let passed = 0;

function test(name, run) {
  run();
  passed++;
  console.log('PASS ' + name);
}

function fixture(options = {}) {
  const original = {
    id: 'RND-RACE', renderId: 'cloud-run-job-race', scriptId: 'SCR-RACE',
    templateId: 'cloud-run-worker', seoPackId: 'SEO-RACE', status: options.status || 'RENDERING',
    progress: 35, videoUrl: options.videoUrl || '', snapshotUrl: '',
    errorMessage: '', requestPayload: {}, providerResponse: {},
    version: 1, createdAt: '2026-10-19T01:00:00.000Z',
    updatedAt: '2026-10-19T01:01:00.000Z'
  };
  let current = JSON.parse(JSON.stringify(original));
  let writes = 0, polls = 0, locks = 0, releases = 0;
  const clone = value => JSON.parse(JSON.stringify(value));
  const response = options.response || {
    status: 'failed', progress: 35, url: '', error_message: 'Stale failure',
    reconciliation: { reason: 'CLOUD_RUN_EXECUTION_FAILED' }
  };
  const context = vm.createContext({
    Utilities: { getUuid: () => 'race-test-id' }, Logger: { log() {} },
    LockService: { getScriptLock: () => ({
      tryLock: () => { locks++; return true; },
      releaseLock: () => { releases++; }
    }) },
    LoggingService: { started() {}, success() {}, failure() {} },
    ProductionErrorService: {
      normalise: caught => ({ message: String(caught.message || caught), statusCode: 400 }),
      recordOccurrence: issue => issue
    },
    RenderJobRepository: {
      getById: id => id === 'RND-RACE' ? clone(current) : null,
      getAll: () => [clone(current)],
      update: value => { writes++; current = clone(value); return clone(current); }
    },
    VideoProcessingProvider: { forJob: () => ({
      getRender() {
        polls++;
        if (options.onPoll) options.onPoll({
          complete: () => {
            current = Object.assign({}, current, {
              status: 'SUCCEEDED', progress: 100, videoUrl: 'https://example.com/completed.mp4',
              providerResponse: { status: 'succeeded', url: 'https://example.com/completed.mp4' },
              errorMessage: '', version: current.version + 1,
              updatedAt: '2026-10-19T01:02:00.000Z'
            });
          },
          fail: () => {
            current = Object.assign({}, current, {
              status: 'FAILED', errorMessage: 'Callback failure',
              version: current.version + 1, updatedAt: '2026-10-19T01:02:00.000Z'
            });
          },
          advanceActive: () => {
            current = Object.assign({}, current, {
              status: 'RENDERING', progress: 85,
              providerResponse: { newerState: 'worker running' },
              version: current.version + 1, updatedAt: '2026-10-19T01:02:00.000Z'
            });
          }
        });
        if (options.throwPoll) throw new Error('Temporary provider outage');
        return clone(response);
      }
    }) },
    RenderQualityService: {}, RenderReviewService: {},
    PublishingJobRepository: {},
    SeoRepository: {}, ScriptsRepository: {},
    ProductionTaskRepository: {}, ProductionQueueService: {},
    Secrets: {},
    SHEETS: {}
  });
  for (const source of ['Models/RenderJob.js', 'App/ProductionController.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, source), 'utf8'), context, { filename: source });
  }
  return {
    call: code => vm.runInContext(code, context, { timeout: 10000 }),
    current: () => clone(current),
    writes: () => writes, polls: () => polls,
    locks: () => locks, releases: () => releases
  };
}

test('Manual refresh preserves a completed callback arriving during provider polling', () => {
  const f = fixture({ onPoll: events => events.complete() });
  const result = f.call('ProductionController.refresh({jobId:"RND-RACE"})');
  assert.equal(result.success, true);
  assert.equal(result.data.job.status, 'SUCCEEDED');
  assert.equal(result.data.job.videoUrl, 'https://example.com/completed.mp4');
  assert.equal(f.writes(), 0);
  assert.equal(f.locks(), f.releases());
});

test('Automatic refresh preserves a completed callback arriving during provider polling', () => {
  const f = fixture({ onPoll: events => events.complete() });
  const result = f.call('ProductionController.refreshActive()');
  assert.equal(result.success, true);
  assert.equal(result.data.jobs[0].status, 'SUCCEEDED');
  assert.equal(f.current().videoUrl, 'https://example.com/completed.mp4');
  assert.equal(f.writes(), 0);
});

test('Provider error during automatic refresh cannot overwrite a completed callback', () => {
  const f = fixture({ onPoll: events => events.complete(), throwPoll: true });
  const result = f.call('ProductionController.refreshActive()');
  assert.equal(result.success, true);
  assert.equal(result.data.jobs[0].status, 'SUCCEEDED');
  assert.equal(f.current().errorMessage, '');
  assert.equal(f.writes(), 0);
});

test('Automatic refresh preserves a terminal failed callback rather than stale success', () => {
  const f = fixture({
    onPoll: events => events.fail(),
    response: { status: 'succeeded', progress: 100, url: 'https://example.com/old.mp4' }
  });
  const result = f.call('ProductionController.refreshActive()');
  assert.equal(result.success, true);
  assert.equal(result.data.jobs[0].status, 'FAILED');
  assert.equal(f.current().videoUrl, '');
  assert.equal(f.writes(), 0);
});

test('A newer active update is not overwritten by an old provider response', () => {
  const f = fixture({ onPoll: events => events.advanceActive() });
  const result = f.call('ProductionController.refresh({jobId:"RND-RACE"})');
  assert.equal(result.success, true);
  assert.equal(result.data.job.status, 'RENDERING');
  assert.equal(result.data.job.progress, 85);
  assert.equal(result.data.job.providerResponse.newerState, 'worker running');
  assert.equal(f.current().version, 2);
  assert.equal(f.writes(), 0);
});

test('Manual refresh can still persist a normal current provider result', () => {
  const f = fixture({
    response: { status: 'rendering', progress: 62, url: '',
      cloudRun: { lastObservedState: 'RUNNING' } }
  });
  const result = f.call('ProductionController.refresh({jobId:"RND-RACE"})');
  assert.equal(result.success, true);
  assert.equal(result.data.job.status, 'RENDERING');
  assert.equal(result.data.job.progress, 62);
  assert.equal(result.data.job.version, 2);
  assert.equal(f.writes(), 1);
});

test('Automatic refresh can still persist an active provider result', () => {
  const f = fixture({
    response: { status: 'rendering', progress: 57, url: '', error_message: '' }
  });
  const result = f.call('ProductionController.refreshActive()');
  assert.equal(result.success, true);
  assert.equal(result.data.jobs[0].progress, 57);
  assert.equal(f.writes(), 1);
});

test('Provider outage updates error only for a still-current active job', () => {
  const f = fixture({ throwPoll: true });
  const result = f.call('ProductionController.refreshActive()');
  assert.equal(result.success, true);
  assert.equal(result.data.jobs[0].status, 'RENDERING');
  assert.match(result.data.jobs[0].errorMessage, /Temporary provider outage/);
  assert.equal(f.writes(), 1);
});

test('Terminal completed or failed jobs skip manual status polling', () => {
  for (const status of ['SUCCEEDED', 'FAILED', 'CANCELLED']) {
    const f = fixture({ status });
    const result = f.call('ProductionController.refresh({jobId:"RND-RACE"})');
    assert.equal(result.success, true);
    assert.equal(result.data.job.status, status);
    assert.equal(f.polls(), 0);
    assert.equal(f.writes(), 0);
  }
});

test('Existing video evidence is protected even if a row remains active', () => {
  const f = fixture({ videoUrl: 'https://example.com/existing.mp4' });
  const result = f.call('ProductionController.refresh({jobId:"RND-RACE"})');
  assert.equal(result.success, true);
  assert.equal(result.data.job.videoUrl, 'https://example.com/existing.mp4');
  assert.equal(f.polls(), 0);
  assert.equal(f.writes(), 0);
});

console.log('Production refresh safety: ' + passed + '/' + passed + ' passed.');
