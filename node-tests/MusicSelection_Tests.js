'use strict';
// Music selection and credit, end to end through the main app's code: the render request carries only
// a verified track ID, the render row keeps the track's summary, a render with no verified music
// record cannot be uploaded, and the required credit is always in the YouTube description. Runs the
// real VideoProcessingProvider.js and YouTube_Service.js against stubbed Apps Script services.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }

const CREDIT = "'Beyond These Walls' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au";
const TRACK_ID = 'scott-buckley-beyond-these-walls';

// Loads the two files with stubs for the Apps Script globals they touch. `worker` decides what the
// dispatcher returns; `youtube` records what would reach YouTube.
function load(options = {}) {
  const calls = { workerBodies: [], fetchUrls: [], insertResources: [] };
  const worker = options.worker || { status: 202, body: null };
  const blob = {
    getBytes: () => [1, 2, 3],
    setName() { return this; },
    setContentType() { return this; }
  };
  const context = vm.createContext({
    Utilities: {
      getUuid: () => '00000000-0000-4000-8000-000000000001',
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      computeDigest: (algorithm, text) => Array.from(require('node:crypto').createHash('sha256').update(text).digest(), (byte) => (byte << 24) >> 24)
    },
    Secrets: {
      getMediaWorkerUrl: () => 'https://dispatcher.example.test',
      getMediaWorkerCallbackUrl: () => 'https://script.example.test/exec',
      getMediaWorkerJobSubmitSecret: () => 'submit-secret',
      getMediaWorkerSharedSecret: () => 'callback-secret',
      getVideoProvider: () => 'cloud-run'
    },
    UrlFetchApp: {
      fetch(url, fetchOptions) {
        calls.fetchUrls.push(String(url));
        if (/\/health$/.test(String(url))) {
          const health = options.oldDispatcher ? { status: 'ok' } : { status: 'ok', musicProtocol: 'verified-v1' };
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify(health) };
        }
        if (String(url).indexOf('/jobs') !== -1 && fetchOptions && fetchOptions.payload) {
          calls.workerBodies.push(JSON.parse(fetchOptions.payload));
        }
        if (String(url).indexOf('/jobs') !== -1) {
          const body = worker.body === null ? '' : JSON.stringify(worker.body);
          return { getResponseCode: () => worker.status, getContentText: () => body };
        }
        // Video download for the upload.
        return { getResponseCode: () => 200, getBlob: () => blob };
      }
    },
    YouTube: {
      Videos: { insert(resource) { calls.insertResources.push(resource); return { id: 'vid123' }; } }
    },
    assertNotStaging_: () => {},
    Logger: { log() {} }
  });
  vm.runInContext(read('Production/VideoProcessingProvider.js'), context, { filename: 'VideoProcessingProvider.js' });
  vm.runInContext(read('Production/YouTube_Service.js'), context, { filename: 'YouTube_Service.js' });
  return { context, calls };
}

const SCRIPT = { id: 'SCR-MUSIC', title: 'Chefchaouen', scenes: [] };
const SCENES = Array.from({ length: 4 }, (_, i) => ({
  narration: Array.from({ length: 25 }, () => 'word').join(' '),
  visualDirection: 'blue street ' + i
}));
const SCRIPT_WITH_SCENES = Object.assign({}, SCRIPT, { scenes: SCENES });
const SEO = { id: 'SEO-1', titleOptions: ['A title'], description: 'Owner text', hashtags: ['travel'], tags: ['travel'] };

const GOOD_RESPONSE = {
  jobId: 'cr-00000000-0000-4000-8000-000000000001',
  status: 'queued',
  music: {
    id: TRACK_ID, title: 'Beyond These Walls', licence: 'CC-BY-4.0',
    attributionRequired: true, attribution: CREDIT, sourceUrl: 'https://www.scottbuckley.com.au/library/beyond-these-walls/'
  }
};

test('the render request carries the verified track ID and never a path or track object', () => {
  const { context, calls } = load({ worker: { status: 202, body: GOOD_RESPONSE } });
  const result = vm.runInContext(`VideoProcessingProvider.get('cloud-run').submitRender(${JSON.stringify(SCRIPT_WITH_SCENES)}, ${JSON.stringify(SEO)}, { renderId: 'cr-00000000-0000-4000-8000-000000000001' })`, context);
  assert.equal(calls.workerBodies.length, 1);
  assert.equal(calls.workerBodies[0].musicTrackId, TRACK_ID);
  assert.equal(calls.workerBodies[0].musicTrackPath, undefined);
  assert.equal(calls.workerBodies[0].musicTrack, undefined);
  assert.equal(calls.workerBodies[0].legacyPlaceholderMusic, undefined);
  assert.equal(result.payload.music.id, TRACK_ID);
  assert.equal(result.payload.music.attribution, CREDIT);
  assert.equal(result.payload.music.attributionRequired, true);
});

test('a worker response without the confirmed track is treated as an unknown outcome, so no second render starts', () => {
  const { context } = load({ worker: { status: 202, body: { jobId: 'cr-00000000-0000-4000-8000-000000000001', status: 'queued' } } });
  assert.throws(
    () => vm.runInContext(`VideoProcessingProvider.get('cloud-run').submitRender(${JSON.stringify(SCRIPT_WITH_SCENES)}, ${JSON.stringify(SEO)}, { renderId: 'cr-00000000-0000-4000-8000-000000000001' })`, context),
    /did not confirm the music track/
  );
});

test('a worker refusal of an unknown track is a definite failure, not an unknown outcome', () => {
  const { context } = load({ worker: { status: 400, body: { error: 'musicTrackId "scott-buckley-beyond-these-walls" is not an approved track in the verified manifest.' } } });
  let caught = null;
  try {
    vm.runInContext(`VideoProcessingProvider.get('cloud-run').submitRender(${JSON.stringify(SCRIPT_WITH_SCENES)}, ${JSON.stringify(SEO)}, { renderId: 'cr-00000000-0000-4000-8000-000000000001' })`, context);
  } catch (error) { caught = error; }
  assert.ok(caught, 'the refusal is thrown');
  assert.equal(caught.outcomeUnknown, false, 'a 400 means nothing started, so the row may be marked FAILED');
  assert.match(caught.message, /not an approved track/);
});

test('an upload carries the required credit in the description, after the disclosure', () => {
  const { context, calls } = load();
  const renderJob = {
    id: 'RND-1', status: 'SUCCEEDED', videoUrl: 'https://storage.example.test/final.mp4',
    requestPayload: { music: { id: TRACK_ID, attributionRequired: true, attribution: CREDIT } }
  };
  vm.runInContext(`YouTubeService.upload(${JSON.stringify(renderJob)}, ${JSON.stringify(SEO)}, { title: 'A title', publishingJobId: 'PUB-1' })`, context);
  const description = calls.insertResources[0].snippet.description;
  assert.ok(description.indexOf('Music: ' + CREDIT) !== -1, 'the credit line is present');
  assert.ok(description.indexOf('Narration in this video was generated using an AI voice.') < description.indexOf('Music: '));
  assert.ok(description.indexOf('Music: ') < description.indexOf('#travel'));
});

test('a long owner description is shortened, but the credit is never cut off', () => {
  const { context, calls } = load();
  const renderJob = {
    id: 'RND-2', status: 'SUCCEEDED', videoUrl: 'https://storage.example.test/final.mp4',
    requestPayload: { music: { id: TRACK_ID, attributionRequired: true, attribution: CREDIT } }
  };
  const longSeo = Object.assign({}, SEO, { description: 'x'.repeat(6000) });
  vm.runInContext(`YouTubeService.upload(${JSON.stringify(renderJob)}, ${JSON.stringify(longSeo)}, { title: 'A title', publishingJobId: 'PUB-2' })`, context);
  const description = calls.insertResources[0].snippet.description;
  assert.ok(description.length <= 5000);
  assert.ok(description.indexOf('Music: ' + CREDIT) !== -1, 'the credit survives the shortening');
});

test('a render with no verified music record is refused before any download or YouTube insert', () => {
  const { context, calls } = load();
  const legacyJob = { id: 'RND-LEGACY', status: 'SUCCEEDED', videoUrl: 'https://storage.example.test/final.mp4', requestPayload: { version: 1 } };
  assert.throws(
    () => vm.runInContext(`YouTubeService.upload(${JSON.stringify(legacyJob)}, ${JSON.stringify(SEO)}, { title: 'A title', publishingJobId: 'PUB-3' })`, context),
    /no verified music record/
  );
  assert.equal(calls.fetchUrls.length, 0, 'the MP4 is not downloaded');
  assert.equal(calls.insertResources.length, 0, 'nothing is sent to YouTube');
});

test('a track that requires credit but has none is refused before upload', () => {
  const { context, calls } = load();
  const job = {
    id: 'RND-3', status: 'SUCCEEDED', videoUrl: 'https://storage.example.test/final.mp4',
    requestPayload: { music: { id: TRACK_ID, attributionRequired: true, attribution: '' } }
  };
  assert.throws(
    () => vm.runInContext(`YouTubeService.upload(${JSON.stringify(job)}, ${JSON.stringify(SEO)}, { title: 'A title', publishingJobId: 'PUB-4' })`, context),
    /required credit text is missing/
  );
  assert.equal(calls.insertResources.length, 0);
});

test('a track that needs no credit uploads without a credit line', () => {
  const { context, calls } = load();
  const job = {
    id: 'RND-4', status: 'SUCCEEDED', videoUrl: 'https://storage.example.test/final.mp4',
    requestPayload: { music: { id: 'cc0-track', attributionRequired: false, attribution: '' } }
  };
  vm.runInContext(`YouTubeService.upload(${JSON.stringify(job)}, ${JSON.stringify(SEO)}, { title: 'A title', publishingJobId: 'PUB-5' })`, context);
  assert.equal(calls.insertResources.length, 1);
  assert.equal(calls.insertResources[0].snippet.description.indexOf('Music:'), -1);
});

test('a dispatcher that does not enforce verified music is never sent a render request', () => {
  const { context, calls } = load({ oldDispatcher: true, worker: { status: 202, body: GOOD_RESPONSE } });
  assert.throws(
    () => vm.runInContext(`VideoProcessingProvider.get('cloud-run').submitRender(${JSON.stringify(SCRIPT_WITH_SCENES)}, ${JSON.stringify(SEO)}, { renderId: 'cr-00000000-0000-4000-8000-000000000001' })`, context),
    /does not enforce verified music/
  );
  assert.equal(calls.workerBodies.length, 0, 'no job request is sent, so no placeholder render can start');
});

const REVIEW_JOB = {
  id: 'RND-R', status: 'SUCCEEDED', videoUrl: 'https://storage.example.test/final.mp4',
  requestPayload: { music: { id: TRACK_ID, title: 'Beyond These Walls', licence: 'CC-BY-4.0', attributionRequired: true,
    attribution: CREDIT, sourceUrl: 'https://www.scottbuckley.com.au/library/beyond-these-walls/' } }
};
// The review's upload attempt ID is allocated by the controller. The same ID is the publishing record ID and the
// tracking tag, so these tests use one ID for both review and upload.
const ATTEMPT = 'PUB-ABCDEF12';
const preview = (context, source) => vm.runInContext(`YouTubeService.previewUpload(${JSON.stringify(REVIEW_JOB)}, ${JSON.stringify(SEO)}, ${JSON.stringify(Object.assign({ uploadAttemptId: ATTEMPT }, source))})`, context);

test('the review shows the exact title, description, credit, tags and visibility the upload will use', () => {
  const { context, calls } = load();
  const plan = preview(context, { title: 'A title', privacyStatus: 'unlisted' });
  assert.equal(plan.title, 'A title');
  assert.equal(plan.privacyStatus, 'unlisted');
  assert.ok(plan.description.indexOf('Music: ' + CREDIT) !== -1);
  assert.equal(JSON.stringify(plan.tags), '["travel","savannah-upload-PUB-ABCDEF12"]');
  assert.equal(plan.music.credit, CREDIT);
  assert.match(plan.metadataHash, /^[0-9a-f]{64}$/);
  vm.runInContext(`YouTubeService.upload(${JSON.stringify(REVIEW_JOB)}, ${JSON.stringify(SEO)}, { title: 'A title', privacyStatus: 'unlisted', publishingJobId: '${ATTEMPT}' })`, context);
  assertSameMetadata(plan, calls.insertResources[0]);
  assert.equal(JSON.stringify(plan.tags), JSON.stringify(calls.insertResources[0].snippet.tags), 'the upload sends the reviewed tags, tracking tag included');
});

test('the review digest is stable for the same details and changes when any shown detail changes', () => {
  const { context } = load();
  const base = { title: 'A title', privacyStatus: 'private' };
  const hash = (source) => preview(context, source).metadataHash;
  assert.equal(hash(base), hash(Object.assign({}, base)));
  assert.notEqual(hash(base), hash(Object.assign({}, base, { title: 'Another title' })));
  assert.notEqual(hash(base), hash(Object.assign({}, base, { privacyStatus: 'public' })));
  assert.notEqual(hash(base), hash(Object.assign({}, base, { description: 'Different owner text' })));
  assert.notEqual(hash(base), hash(Object.assign({}, base, { publishAt: new Date(Date.now() + 3600000).toISOString() })));
});

// Compares every field the review shows with what the YouTube API receives.
function assertSameMetadata(plan, resource) {
  assert.equal(resource.snippet.title, plan.title, 'title');
  assert.equal(resource.snippet.description, plan.description, 'description');
  assert.equal(resource.status.privacyStatus, plan.privacyStatus, 'visibility');
  assert.equal(resource.status.publishAt || '', plan.publishAt || '', 'schedule');
  assert.equal(JSON.stringify(resource.snippet.tags), JSON.stringify(plan.tags), 'tags, tracking tag included');
}

// YouTube counts commas and quotes around tags containing spaces toward 500 characters.
function youtubeTagLength(tags) {
  return tags.reduce((length, tag) => length + tag.length + (/\s/.test(tag) ? 2 : 0), Math.max(0, tags.length - 1));
}

test('tag trimming: the review and the upload send the same tags, and the tracking tag is always kept', () => {
  const ownerTags = Array.from({ length: 40 }, (_, i) => 'owner tag number ' + i + ' with some padding words');
  const seo = Object.assign({}, SEO, { tags: ownerTags });
  const { context, calls } = load();
  const plan = vm.runInContext(`YouTubeService.previewUpload(${JSON.stringify(REVIEW_JOB)}, ${JSON.stringify(seo)}, ${JSON.stringify({ title: 'T', uploadAttemptId: ATTEMPT })})`, context);
  assert.ok(plan.tags.length < ownerTags.length, 'owner tags were trimmed to fit the limit');
  assert.equal(plan.tags[plan.tags.length - 1], 'savannah-upload-' + ATTEMPT, 'the tracking tag is last');
  assert.ok(youtubeTagLength(plan.tags) <= 500, 'the reviewed tags fit the 500-character limit');
  vm.runInContext(`YouTubeService.upload(${JSON.stringify(REVIEW_JOB)}, ${JSON.stringify(seo)}, { title: 'T', publishingJobId: '${ATTEMPT}' })`, context);
  assertSameMetadata(plan, calls.insertResources[0]);
  assert.ok(youtubeTagLength(calls.insertResources[0].snippet.tags) <= 500, 'the uploaded tags fit the limit');
});

test('the review digest changes with the upload attempt, so an approval cannot be reused for another record', () => {
  const { context } = load();
  const first = preview(context, { title: 'A', uploadAttemptId: 'PUB-AAAAAAAA' }).metadataHash;
  const second = preview(context, { title: 'A', uploadAttemptId: 'PUB-BBBBBBBB' }).metadataHash;
  assert.notEqual(first, second);
});

test('a review needs an upload attempt ID, and the upload needs its publishing record ID', () => {
  const { context, calls } = load();
  assert.throws(() => vm.runInContext(`YouTubeService.previewUpload(${JSON.stringify(REVIEW_JOB)}, ${JSON.stringify(SEO)}, { title: 'T' })`, context), /upload attempt ID/);
  assert.throws(() => vm.runInContext(`YouTubeService.upload(${JSON.stringify(REVIEW_JOB)}, ${JSON.stringify(SEO)}, { title: 'T' })`, context), /publishing record ID/);
  assert.equal(calls.insertResources.length, 0);
});

console.log(`Music selection and credit: ${passed}/${passed} passed.`);
