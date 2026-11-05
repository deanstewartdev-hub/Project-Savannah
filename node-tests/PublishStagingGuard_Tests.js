'use strict';
// S9 regression: in a staging project, publish() must refuse BEFORE any publishing record is written and
// before any YouTube upload, while the non-staging path is unchanged and preview stays read-only.
// Loads the real Utils/EnvironmentGuard.js and App/ProductionController.js into a VM with stubs for the
// Apps Script services they call. No network, no YouTube, no Apps Script.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function test(name, run) { run(); console.log('PASS ' + name); }

const RENDER_ID = 'RND-PUBGUARD-1';
const ATTEMPT = 'PUB-1A2B3C4D';
const HASH = 'hash-of-reviewed-details';

// environment: 'staging' sets SAVANNAH_ENVIRONMENT; anything else (or undefined) is production-like.
function load({ environment, qualityError = null } = {}) {
  let vmContext = null;
  const calls = { save: [], upload: [], previewUpload: 0, assertUsable: 0 };
  const properties = { SAVANNAH_ENVIRONMENT: environment };
  const renderJob = {
    id: RENDER_ID, status: 'SUCCEEDED', videoUrl: 'https://example.test/video.mp4', seoPackId: 'SEO-1', scriptId: 'SCR-1',
    requestPayload: { music: { id: 'track-1', title: 'Track', licence: 'CC0-1.0', attributionRequired: false, attribution: '' } }
  };
  const seoPack = {
    titleOptions: ['Title A', 'Title B'], description: 'Desc', hashtags: ['#a'], tags: ['t'], keywords: ['k'],
    thumbnailText: 'T', pinnedComment: 'P'
  };
  const publishing = [];
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: name => properties[name] || null }) },
    LockService: { getScriptLock: () => ({ tryLock() { return true; }, waitLock() {}, releaseLock() {} }) },
    Utilities: { getUuid: () => '00000000-0000-4000-8000-00000000abcd' },
    Logger: { log() {} },
    LoggingService: { log() {}, started() {}, success() {}, STATUS: { WARNING: 'Warning' } },
    ProductionErrorService: {
      normalise: caught => ({ message: String(caught && caught.message || caught) }),
      recordOccurrence: normalised => normalised
    },
    MediaWorkerCallbackInbox: { processPendingLocked() { return {}; }, processPending() { return {}; }, recentReceipts() { return []; } },
    RenderJobRepository: { getById: id => (id === RENDER_ID ? renderJob : null) },
    RenderQualityService: { assertPublishable() { if (qualityError) throw new Error(qualityError); } },
    RenderReviewService: { assertApproved() { return { approved: true }; } },
    VideoLinkService: { assertUsable() { calls.assertUsable++; } },
    SeoRepository: { getById: id => (id === 'SEO-1' ? seoPack : null) },
    PublishingScheduleService: { assertAvailable: () => ({ scheduled: false }) },
    PublishingJobRepository: {
      getAll: () => publishing.slice(),
      save: job => { calls.save.push(job); publishing.push(job); return job; },
      update: job => job
    },
    PublishingJobModel: {
      create: data => Object.assign({ status: 'PENDING' }, data),
      update: (job, changes) => Object.assign({}, job, changes)
    },
    YouTubeService: {
      previewUpload: (renderJob, seo, source) => {
        calls.previewUpload++;
        return { renderJobId: renderJob.id, uploadAttemptId: source.uploadAttemptId, title: 'Title A', description: 'Desc',
          tags: ['t'], privacyStatus: 'private', publishAt: '', music: renderJob.requestPayload.music, metadataHash: HASH };
      },
      // The real YouTubeService.upload calls assertNotStaging_ first; the stub records any call that reaches it.
      // Records the call and fails, so no test ever reaches YouTube.
      // Mirrors the real upload's first step: the staging guard, then the recorded call.
      upload: (renderJob, seo, options) => {
        vm.runInContext('assertNotStaging_("YouTube upload")', vmContext);
        calls.upload.push(options);
        throw new Error('stub upload: no YouTube contact in tests');
      }
    }
  });
  vmContext = context;
  const guard = read('Utils/EnvironmentGuard.js');
  const controller = read('App/ProductionController.js');
  vm.runInContext(guard, context, { filename: 'Utils/EnvironmentGuard.js' });
  vm.runInContext(controller, context, { filename: 'App/ProductionController.js' });
  return { context, calls, publishing };
}

const publishRequest = { renderJobId: RENDER_ID, timezoneOffsetMinutes: 0, uploadAttemptId: ATTEMPT, approvedMetadataHash: HASH };

test('staging: publish is refused before any publishing record is written and before any upload', () => {
  const { context, calls, publishing } = load({ environment: 'staging' });
  const result = JSON.parse(JSON.stringify(vm.runInContext('ProductionController.publish(' + JSON.stringify(publishRequest) + ')', context)));
  assert.equal(result.success, false, 'the staging publish must not succeed');
  assert.match(JSON.stringify(result), /Refused in staging: YouTube upload/);
  assert.equal(calls.save.length, 0, 'no publishing record may be written in staging');
  assert.equal(publishing.length, 0);
  assert.equal(calls.upload.length, 0, 'no YouTube upload may be reached in staging');
});

test('staging: the refusal is recorded only as a refusal, not as a FAILED publishing row', () => {
  const { context, calls } = load({ environment: 'staging' });
  vm.runInContext('ProductionController.publish(' + JSON.stringify(publishRequest) + ')', context);
  assert.equal(calls.save.length, 0);
});

test('staging: preview is read-only and still returns the reviewed details', () => {
  const { context, calls, publishing } = load({ environment: 'staging' });
  const result = JSON.parse(JSON.stringify(vm.runInContext('ProductionController.previewPublish({ renderJobId: "' + RENDER_ID + '", timezoneOffsetMinutes: 0 })', context)));
  assert.equal(result.success, true);
  assert.equal(result.data.metadataHash, HASH);
  assert.equal(calls.save.length, 0);
  assert.equal(publishing.length, 0);
});

test('staging: a wrong approved hash is still refused by the existing check, before the guard and before any record', () => {
  const { context, calls } = load({ environment: 'staging' });
  const bad = Object.assign({}, publishRequest, { approvedMetadataHash: 'some-other-hash' });
  const result = JSON.parse(JSON.stringify(vm.runInContext('ProductionController.publish(' + JSON.stringify(bad) + ')', context)));
  assert.equal(result.success, false);
  assert.match(JSON.stringify(result), /details changed after review/);
  assert.equal(calls.save.length, 0);
});

test('staging: an existing quality gate still fails first, with its own message', () => {
  const { context, calls } = load({ environment: 'staging', qualityError: 'Render quality check failed: test issue.' });
  const result = JSON.parse(JSON.stringify(vm.runInContext('ProductionController.publish(' + JSON.stringify(publishRequest) + ')', context)));
  assert.equal(result.success, false);
  assert.match(JSON.stringify(result), /Render quality check failed/);
  assert.doesNotMatch(JSON.stringify(result), /Refused in staging/);
  assert.equal(calls.save.length, 0);
});

test('production (not staging): publish still writes its record and reaches the upload step', () => {
  const { context, calls } = load({ environment: undefined });
  const result = JSON.parse(JSON.stringify(vm.runInContext('ProductionController.publish(' + JSON.stringify(publishRequest) + ')', context)));
  // The stub upload records the call, then throws. Reaching it proves the non-staging path is not refused by the new guard.
  assert.equal(calls.save.length, 1, 'the production path still writes the publishing record first');
  assert.equal(calls.upload.length, 1, 'the production path reaches the YouTube upload step');
  assert.equal(result.success, false, 'the stub upload throws, so the publish reports a failure after the record');
  assert.doesNotMatch(JSON.stringify(result), /Refused in staging/);
});
