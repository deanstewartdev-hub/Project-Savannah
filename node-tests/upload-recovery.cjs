'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }
function fixture(options = {}) {
  let job = options.initialJob || null, inserts = 0, pages = 0, releases = 0, updateFailed = false;
  const history = options.history || [];
  const blob = { getBytes: () => [1], setName() { return this; }, setContentType() { return this; } };
  const context = vm.createContext({
    Logger: { log() {} },
    Utilities: { getUuid: randomUUID },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => releases++ }) },
    RenderJobRepository: {
      getById: () => ({ id: 'RND-TEST', scriptId: 'SCR-TEST', seoPackId: 'SEO-TEST',
        status: 'SUCCEEDED', videoUrl: 'https://example.com/video.mp4', updatedAt: new Date().toISOString() }),
      getAll: () => [{ id: 'RND-TEST', scriptId: 'SCR-TEST', seoPackId: 'SEO-TEST',
        status: 'SUCCEEDED', videoUrl: 'https://example.com/video.mp4', updatedAt: new Date().toISOString() }]
    },
    RenderQualityService: { assertPublishable() {}, evaluate: () => ({ passed: true }) },
    RenderReviewService: { assertApproved() {}, get: () => ({ approved: true }) },
    SeoRepository: { getById: () => ({ titleOptions: ['Test Short'], description: 'Description', tags: options.tags || [], hashtags: [] }) },
    PublishingJobRepository: {
      getByRenderJobId: () => job, getAll: () => history.concat(job ? [job] : []),
      save(value) { job = value; return value; },
      update(value) {
        if (options.allWritesFail || (options.persistenceFailure && value.status === 'PUBLISHED' && !updateFailed)) { updateFailed = true; throw new Error('Sheet unavailable'); }
        const index = history.findIndex(entry => entry.id === value.id);
        if (index >= 0) history[index] = value;
        else job = value;
        return value;
      }
    },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => options.downloadFailure ? 500 : 200, getBlob: () => blob }) },
    YouTube: {
      Channels: { list: () => ({ items: [{ id: 'CHANNEL', contentDetails: { relatedPlaylists: { uploads: 'UPLOADS' } } }] }) },
      PlaylistItems: { list: () => { pages++; return { items: [{ contentDetails: { videoId: 'VIDEO' } }], nextPageToken: options.morePages ? 'next' : '' }; } },
      Videos: {
        insert(resource) {
          inserts++;
          assert.ok(resource.snippet.tags.some(tag => tag === 'savannah-upload-' + job.id));
          const tagLength = resource.snippet.tags.reduce((sum, tag) => sum + tag.length + (/\s/.test(tag) ? 2 : 0), resource.snippet.tags.length - 1);
          assert.ok(tagLength <= 500);
          if (options.insertFailure) throw new Error('Network timeout');
          if (options.noId) return {};
          return { id: 'VIDEO', status: resource.status };
        },
        list: () => ({ items: options.matches === false ? [] : Array.from({ length: options.duplicates ? 2 : 1 }, (_, i) => ({
          id: 'VIDEO' + i, snippet: { channelId: options.wrongChannel ? 'OTHER' : 'CHANNEL',
            tags: ['savannah-upload-' + (options.matchesJobId || job.id)] },
          status: { privacyStatus: 'private', uploadStatus: 'processed' }, processingDetails: { processingStatus: 'succeeded' }
        })) })
      }
    }
  });
  for (const file of ['Models/PublishingJob.js', 'Production/PublishingSchedule_Service.js', 'Production/ProductionError_Service.js', 'Production/YouTube_Service.js', 'App/ProductionController.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  return {
    call: expression => vm.runInContext(expression, context, { timeout: 10000 }),
    job: () => job, history: () => history.slice(), inserts: () => inserts,
    pages: () => pages, releases: () => releases
  };
}
const publish = 'ProductionController.publish({renderJobId:"RND-TEST"})';
const reconcile = 'ProductionController.reconcilePublication({renderJobId:"RND-TEST"})';
test('Timeout leaves reconciliation state and blocks a second insert', () => {
  const f = fixture({ insertFailure: true });
  const response = f.call(publish);
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'PRODUCTION_UPLOAD_UNCERTAIN');
  assert.equal(f.job().status, 'RECONCILE');
  assert.equal(f.call(publish).success, false);
  assert.equal(f.inserts(), 1);
  assert.equal(f.releases(), 2);
});
test('Missing video ID is uncertain rather than retryable', () => {
  const f = fixture({ noId: true }); f.call(publish); assert.equal(f.job().status, 'RECONCILE');
});
test('Failure before submission is safely retryable', () => {
  const f = fixture({ downloadFailure: true }); f.call(publish);
  assert.equal(f.job().status, 'FAILED'); assert.equal(f.inserts(), 0);
});
test('Persistence failure after accepted upload blocks duplicate upload', () => {
  const f = fixture({ persistenceFailure: true }); f.call(publish);
  assert.equal(f.job().status, 'RECONCILE'); f.call(publish); assert.equal(f.inserts(), 1);
});
test('Reconciliation reconnects an owned tagged upload without inserting', () => {
  const f = fixture({ insertFailure: true }); f.call(publish);
  assert.equal(f.call(reconcile).success, true); assert.equal(f.job().status, 'PUBLISHED');
  assert.equal(f.job().youtubeVideoId, 'VIDEO0'); assert.equal(f.inserts(), 1);
  assert.equal(f.call(publish).success, false);
});
test('No match never unlocks another upload; lookup is bounded', () => {
  const f = fixture({ insertFailure: true, matches: false, morePages: true }); f.call(publish);
  assert.equal(f.call(reconcile).success, false); assert.equal(f.job().status, 'RECONCILE'); assert.equal(f.pages(), 5);
});
test('Multiple matching videos require human reconciliation', () => {
  const f = fixture({ insertFailure: true, duplicates: true }); f.call(publish);
  assert.equal(f.call(reconcile).success, false); assert.equal(f.job().status, 'RECONCILE');
});
test('Matching tags on another channel cannot reconcile the upload', () => {
  const f = fixture({ insertFailure: true, wrongChannel: true }); f.call(publish);
  assert.equal(f.call(reconcile).success, false); assert.equal(f.job().status, 'RECONCILE');
});
test('Retry requires explicit confirmation and the reconciliation state', () => {
  const f = fixture({ insertFailure: true }); f.call(publish);
  assert.equal(f.call('ProductionController.abandonPublication({renderJobId:"RND-TEST"})').success, false);
  assert.equal(f.job().status, 'RECONCILE');
  assert.equal(f.call('ProductionController.abandonPublication({renderJobId:"RND-TEST",confirmNoUpload:true})').success, true);
  assert.equal(f.job().status, 'FAILED');
});
for (const state of ['PUBLISHED', 'RECONCILE', 'UPLOADING']) {
  test('Older ' + state + ' upload blocks retry even when latest attempt is FAILED', () => {
    const f = fixture({
      history: [{ id: 'PUB-OLDER', renderJobId: 'RND-TEST', status: state }],
      initialJob: { id: 'PUB-NEWER', renderJobId: 'RND-TEST', status: 'FAILED' }
    });
    const result = f.call(publish);
    assert.equal(result.success, false);
    assert.equal(f.inserts(), 0, 'A protected earlier upload must not be inserted again');
    assert.equal(f.job().status, 'FAILED', 'The latest record must not be overwritten on guard failure');
  });
}
test('Older FAILED attempts do not block a safe retry when no upload is protected', () => {
  const f = fixture({
    history: [{ id: 'PUB-OLDER', renderJobId: 'RND-TEST', status: 'FAILED' }],
    initialJob: { id: 'PUB-NEWER', renderJobId: 'RND-TEST', status: 'FAILED' }
  });
  assert.equal(f.call(publish).success, true);
  assert.equal(f.inserts(), 1);
  assert.equal(f.job().status, 'PUBLISHED');
});
function historicalJob(id, status, updatedAt, overrides = {}) {
  return Object.assign({
    id, renderJobId: 'RND-TEST', scriptId: 'SCR-TEST', seoPackId: 'SEO-TEST',
    title: 'Test Short', privacyStatus: 'private', status, providerResponse: {},
    updatedAt, createdAt: updatedAt, version: 1
  }, overrides);
}
test('Production listing prefers older published record to a newer failed attempt', () => {
  const now = new Date().toISOString();
  const f = fixture({
    history: [historicalJob('PUB-OLDER', 'PUBLISHED', '2026-01-01T00:00:00.000Z',
      { youtubeVideoId: 'EXISTING', youtubeUrl: 'https://youtu.be/EXISTING' })],
    initialJob: historicalJob('PUB-NEWER', 'FAILED', now)
  });
  const response = f.call('ProductionController.listJobs()');
  assert.equal(response.success, true);
  const entry = response.data.jobs[0];
  assert.equal(entry.publishingJob.id, 'PUB-OLDER');
  assert.equal(entry.publishingHistory.showingEarlierAttempt, true);
  assert.equal(entry.publishingHistory.latestStatus, 'FAILED');
  assert.equal(entry.publishingHistory.attemptCount, 2);
  assert.equal(f.inserts(), 0);
});
test('Production listing prefers unresolved older upload over a newer failed attempt', () => {
  const now = new Date().toISOString();
  const f = fixture({
    history: [historicalJob('PUB-OLDER', 'RECONCILE', now)],
    initialJob: historicalJob('PUB-NEWER', 'FAILED', now)
  });
  const response = f.call('ProductionController.listJobs()');
  assert.equal(response.success, true);
  assert.equal(response.data.jobs[0].publishingJob.id, 'PUB-OLDER');
  assert.equal(response.data.jobs[0].publishingHistory.unresolvedCount, 1);
});
test('Reconcile action targets selected older publishing ID, not the newer failure', () => {
  const now = new Date().toISOString();
  const f = fixture({
    history: [historicalJob('PUB-OLDER', 'RECONCILE', now)],
    initialJob: historicalJob('PUB-NEWER', 'FAILED', now),
    matchesJobId: 'PUB-OLDER'
  });
  const response = f.call('ProductionController.reconcilePublication({renderJobId:"RND-TEST",publishingJobId:"PUB-OLDER"})');
  assert.equal(response.success, true);
  assert.equal(f.history()[0].status, 'PUBLISHED');
  assert.equal(f.job().status, 'FAILED');
  assert.equal(f.inserts(), 0);
  assert.equal(f.call(publish).success, false);
});
test('Confirming no upload clears only the selected older uncertain attempt', () => {
  const now = new Date().toISOString();
  const f = fixture({
    history: [historicalJob('PUB-OLDER', 'RECONCILE', now)],
    initialJob: historicalJob('PUB-NEWER', 'FAILED', now)
  });
  const response = f.call('ProductionController.abandonPublication({renderJobId:"RND-TEST",publishingJobId:"PUB-OLDER",confirmNoUpload:true})');
  assert.equal(response.success, true);
  assert.equal(f.history()[0].status, 'FAILED');
  assert.equal(f.job().status, 'FAILED');
  assert.equal(f.call(publish).success, true);
  assert.equal(f.inserts(), 1);
});
test('Selected upload attempt must belong to the requested render', () => {
  const now = new Date().toISOString();
  const f = fixture({
    history: [historicalJob('PUB-OTHER', 'RECONCILE', now, { renderJobId: 'RND-OTHER' })],
    initialJob: historicalJob('PUB-NEWER', 'FAILED', now)
  });
  const response = f.call('ProductionController.abandonPublication({renderJobId:"RND-TEST",publishingJobId:"PUB-OTHER",confirmNoUpload:true})');
  assert.equal(response.success, false);
  assert.equal(f.history()[0].status, 'RECONCILE');
  assert.equal(f.inserts(), 0);
});
test('Rerender is blocked when an older upload requires reconciliation', () => {
  const now = new Date().toISOString();
  const f = fixture({
    history: [historicalJob('PUB-OLDER', 'RECONCILE', now)],
    initialJob: historicalJob('PUB-NEWER', 'FAILED', now)
  });
  const response = f.call('ProductionController.retry({jobId:"RND-TEST"})');
  assert.equal(response.success, false);
  assert.equal(f.inserts(), 0);
});
for (const evidence of [{ youtubeVideoId: 'VIDEO-REMOTE' }, { youtubeUrl: 'https://youtu.be/VIDEO-REMOTE' }]) {
  test('Failed attempt with remote evidence blocks another YouTube insert', () => {
    const f = fixture({ initialJob: historicalJob('PUB-FAILED', 'FAILED',
      new Date().toISOString(), evidence) });
    assert.equal(f.call(publish).success, false);
    assert.equal(f.inserts(), 0);
    const retryResult = f.call('ProductionController.retry({jobId:"RND-TEST"})');
    assert.equal(retryResult.success, false);
    assert.match(retryResult.error.message, /Resolve the existing YouTube upload/);
  });
}
test('Production listing surfaces older failed upload with remote evidence', () => {
  const now = new Date().toISOString();
  const f = fixture({
    history: [historicalJob('PUB-OLDER', 'FAILED', '2026-01-01T00:00:00.000Z',
      { youtubeVideoId: 'VIDEO-REMOTE' })],
    initialJob: historicalJob('PUB-NEWER', 'FAILED', now)
  });
  const response = f.call('ProductionController.listJobs()');
  assert.equal(response.success, true);
  assert.equal(response.data.jobs[0].publishingJob.id, 'PUB-OLDER');
  assert.equal(response.data.jobs[0].publishingHistory.showingEarlierAttempt, true);
  assert.equal(response.data.jobs[0].publishingHistory.unresolvedCount, 1);
});
test('Tagged owned upload can reconcile a FAILED attempt that has remote evidence', () => {
  const f = fixture({
    history: [historicalJob('PUB-OLDER', 'FAILED', new Date().toISOString(),
      { youtubeVideoId: 'VIDEO-REMOTE' })],
    initialJob: historicalJob('PUB-NEWER', 'FAILED', new Date().toISOString()),
    matchesJobId: 'PUB-OLDER'
  });
  const result = f.call('ProductionController.reconcilePublication({renderJobId:"RND-TEST",publishingJobId:"PUB-OLDER"})');
  assert.equal(result.success, true);
  assert.equal(f.history()[0].status, 'PUBLISHED');
  assert.equal(f.history()[0].youtubeVideoId, 'VIDEO0');
  assert.equal(f.inserts(), 0);
  assert.equal(f.call(publish).success, false);
});
test('Missing tagged video never releases FAILED upload evidence automatically', () => {
  const f = fixture({
    history: [historicalJob('PUB-OLDER', 'FAILED', new Date().toISOString(),
      { youtubeVideoId: 'VIDEO-REMOTE' })],
    initialJob: historicalJob('PUB-NEWER', 'FAILED', new Date().toISOString()),
    matches: false
  });
  const result = f.call('ProductionController.reconcilePublication({renderJobId:"RND-TEST",publishingJobId:"PUB-OLDER"})');
  assert.equal(result.success, false);
  assert.equal(f.history()[0].youtubeVideoId, 'VIDEO-REMOTE');
  assert.equal(f.call(publish).success, false);
  assert.equal(f.inserts(), 0);
});
test('Explicit no-upload confirmation archives and clears contradictory remote evidence', () => {
  const f = fixture({
    history: [historicalJob('PUB-OLDER', 'FAILED', new Date().toISOString(), {
      youtubeVideoId: 'VIDEO-REMOTE', youtubeUrl: 'https://youtu.be/VIDEO-REMOTE',
      providerResponse: { publishAt: '2026-12-10T12:00:00.000Z' }
    })],
    initialJob: historicalJob('PUB-NEWER', 'FAILED', new Date().toISOString())
  });
  const command = 'ProductionController.abandonPublication({renderJobId:"RND-TEST",publishingJobId:"PUB-OLDER",confirmNoUpload:true})';
  assert.equal(f.call(command.replace('confirmNoUpload:true', 'confirmNoUpload:false')).success, false);
  assert.equal(f.history()[0].youtubeVideoId, 'VIDEO-REMOTE');
  assert.equal(f.call(publish).success, false);
  assert.equal(f.call(command).success, true);
  const cleared = f.history()[0];
  assert.equal(cleared.status, 'FAILED');
  assert.equal(cleared.youtubeVideoId, '');
  assert.equal(cleared.youtubeUrl, '');
  assert.equal(cleared.providerResponse.manualReconciliation.previousYoutubeVideoId, 'VIDEO-REMOTE');
  assert.equal(cleared.providerResponse.manualReconciliation.previousYoutubeUrl, 'https://youtu.be/VIDEO-REMOTE');
  assert.equal(cleared.providerResponse.manualReconciliation.previousStatus, 'FAILED');
  assert.ok(cleared.providerResponse.manualReconciliation.confirmedAt);
  assert.equal(cleared.providerResponse.publishAt, '2026-12-10T12:00:00.000Z');
  assert.equal(f.call(publish).success, true);
  assert.equal(f.inserts(), 1);
});
test('Manual confirmation also archives YouTube evidence in a RECONCILE attempt', () => {
  const f = fixture({
    history: [historicalJob('PUB-OLDER', 'RECONCILE', new Date().toISOString(),
      { youtubeVideoId: 'REMOTE' })],
    initialJob: historicalJob('PUB-NEWER', 'FAILED', new Date().toISOString())
  });
  const result = f.call('ProductionController.abandonPublication({renderJobId:"RND-TEST",publishingJobId:"PUB-OLDER",confirmNoUpload:true})');
  assert.equal(result.success, true);
  assert.equal(f.history()[0].status, 'FAILED');
  assert.equal(f.history()[0].youtubeVideoId, '');
  assert.equal(f.history()[0].providerResponse.manualReconciliation.previousYoutubeVideoId, 'REMOTE');
  assert.equal(f.call(publish).success, true);
});
test('Complete persistence outage leaves UPLOADING blocked', () => {
  const f = fixture({ allWritesFail: true }); f.call(publish);
  assert.equal(f.job().status, 'UPLOADING'); f.call(publish); assert.equal(f.inserts(), 1);
});
test('Successful scheduled upload stays private and retains its schedule', () => {
  const f = fixture({ tags: Array(30).fill('Long descriptive topic tag') });
  const when = new Date(Date.now() + 3600000).toISOString();
  assert.equal(f.call(`ProductionController.publish({renderJobId:"RND-TEST",privacyStatus:"public",publishAt:${JSON.stringify(when)}})`).success, true);
  assert.equal(f.job().status, 'PUBLISHED'); assert.equal(f.job().privacyStatus, 'private');
  assert.equal(f.job().providerResponse.publishAt, when);
});
console.log(`Upload recovery: ${passed}/${passed} passed.`);
