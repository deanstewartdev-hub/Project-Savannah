'use strict';
// Signed video link expiry + safe same-artifact link refresh after completion.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }

function load(files, globals) {
  const context = vm.createContext(Object.assign({ Utilities: { getUuid: randomUUID }, Logger: { log() {} } }, globals || {}));
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  return context;
}
const link = vm.runInContext('VideoLinkService', load(['Production/VideoLink_Service.js']));

const RENDER = 'cr-0f1e2d3c-4b5a-4968-8776-655443322110';
const PATH = 'renders/' + RENDER + '/final.mp4';
function signed(date, expires, extra) {
  return 'https://storage.googleapis.com/savannah-media/' + PATH + '?X-Goog-Algorithm=GOOG4-RSA-SHA256' +
    '&X-Goog-Date=' + date + '&X-Goog-Expires=' + expires + '&X-Goog-SignedHeaders=host&X-Goog-Signature=' + (extra || 'abc');
}
const OLD = signed('20261010T120000Z', 604800);   // expires 2026-10-17T12:00Z
const NEW = signed('20261021T120000Z', 604800, 'def');
const NOW = Date.parse('2026-10-21T12:00:00Z');

// ---------- expiry parsing and publish guard ----------

test('expiry is read from X-Goog-Date + X-Goog-Expires', () => {
  assert.equal(new Date(link.expiresAt(OLD)).toISOString(), '2026-10-17T12:00:00.000Z');
});

test('unsigned or unparseable URLs have no known expiry and are not blocked', () => {
  assert.equal(link.expiresAt('https://example.test/v.mp4'), null);
  assert.equal(link.expiresAt('https://x/?X-Goog-Date=bad&X-Goog-Expires=60'), null);
  link.assertUsable('https://example.test/v.mp4', NOW);
});

test('expired link is refused with a recovery hint, not a re-render', () => {
  assert.throws(() => link.assertUsable(OLD, NOW), e => e.name === 'VideoLinkExpired' &&
    /expired on 2026-10-17/.test(e.message) && /No re-render is needed/.test(e.message) && /Delivery-only recovery/.test(e.message));
});

test('link expiring within 30 minutes is refused; fresh link passes', () => {
  const almost = signed('20261014T121000Z', 604800); // expires 2026-10-21T12:10Z
  assert.throws(() => link.assertUsable(almost, NOW), /expires too soon/);
  link.assertUsable(NEW, NOW);
});

test('publish() checks the link before recording any upload attempt', () => {
  const source = fs.readFileSync(path.join(root, 'App/ProductionController.js'), 'utf8');
  const publish = source.slice(source.indexOf('function publish(request)'));
  const guard = publish.indexOf('VideoLinkService.assertUsable(renderJob.videoUrl)');
  assert.ok(guard > 0, 'publish() must check the link.');
  assert.ok(guard < publish.indexOf('PublishingJobRepository.save'), 'Link must be checked before an attempt row is created.');
  assert.ok(guard < publish.indexOf('YouTubeService.upload'), 'Link must be checked before uploading.');
});

// ---------- same-artifact refresh rules ----------

function succeeded(overrides) {
  return Object.assign({ id: 'RND-LINK1', renderId: RENDER, scriptId: 'SCR-1', templateId: 'cloud-run-worker',
    status: 'SUCCEEDED', progress: 100, videoUrl: OLD, version: 2, createdAt: '2026-10-10T11:00:00.000Z',
    providerResponse: { status: 'succeeded', url: OLD, video: { url: OLD, gcsPath: PATH }, probe: { durationSeconds: 41, reportUrl: 'https://old-report' } }
  }, overrides || {});
}
function recovery(overrides) {
  return Object.assign({ jobId: RENDER, status: 'completed', video: { url: NEW, gcsPath: PATH }, probe: { durationSeconds: 41, reportUrl: 'https://new-report' } }, overrides || {});
}

test('refresh is recognised only for the same artifact of a SUCCEEDED render', () => {
  assert.equal(link.isSameArtifactRefresh(succeeded(), recovery()), true);
  assert.equal(link.isSameArtifactRefresh(succeeded({ status: 'FAILED' }), recovery()), false, 'FAILED must stay failed');
  assert.equal(link.isSameArtifactRefresh(succeeded({ status: 'CANCELLED' }), recovery()), false);
  assert.equal(link.isSameArtifactRefresh(succeeded(), recovery({ status: 'failed' })), false);
  assert.equal(link.isSameArtifactRefresh(succeeded(), recovery({ video: { url: NEW, gcsPath: 'renders/other/final.mp4' } })), false, 'different artifact');
  assert.equal(link.isSameArtifactRefresh(succeeded(), recovery({ video: { url: NEW } })), false, 'no gcsPath');
  assert.equal(link.isSameArtifactRefresh(succeeded({ providerResponse: { video: { url: OLD } } }), recovery()), false, 'stored path unknown');
  assert.equal(link.isSameArtifactRefresh(succeeded(), recovery({ video: { url: 'http://insecure', gcsPath: PATH } })), false);
  assert.equal(link.isSameArtifactRefresh(succeeded(), recovery({ video: { url: OLD, gcsPath: PATH } })), false, 'same URL is a duplicate, not a refresh');
});

test('refresh changes only link fields and keeps probe evidence', () => {
  const changes = link.refreshChanges(succeeded(), recovery());
  assert.deepEqual(Object.keys(changes).sort(), ['providerResponse', 'videoUrl']);
  assert.equal(changes.videoUrl, NEW);
  assert.equal(changes.providerResponse.video.url, NEW);
  assert.equal(changes.providerResponse.video.gcsPath, PATH);
  assert.equal(changes.providerResponse.probe.durationSeconds, 41);
  assert.equal(changes.providerResponse.probe.reportUrl, 'https://new-report');
  assert.ok(changes.providerResponse.linkRefreshedAt);
});

// ---------- inbox consumer applies a refresh ----------

const HEADERS = ['Receipt ID', 'Render ID', 'Status', 'Payload JSON', 'Received At', 'Handled At', 'Result'];
function inboxRun(job, body) {
  const data = [HEADERS.slice(), [randomUUID(), body.jobId, body.status, JSON.stringify(body), new Date(), '', '']];
  const sheet = { getLastRow: () => data.length, getRange: (r, c, nr, nc) => ({
    getValues: () => data.slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc)),
    getDisplayValues: () => data.slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc).map(String)),
    setValues: v => v.forEach((row, i) => row.forEach((cell, j) => { data[r - 1 + i][c - 1 + j] = cell; })),
    setValue: v => { data[r - 1][c - 1] = v; }
  }) };
  let stored = JSON.parse(JSON.stringify(job));
  const writes = [];
  const context = load(['Models/RenderJob.js', 'Production/VideoLink_Service.js', 'Production/MediaWorkerCallbackInbox_Service.js'], {
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet }) },
    RenderJobRepository: { getByRenderId: id => (id === stored.renderId ? JSON.parse(JSON.stringify(stored)) : null),
      update: j => { writes.push(j); stored = JSON.parse(JSON.stringify(j)); return j; } }
  });
  vm.runInContext('MediaWorkerCallbackInbox.processPending()', context);
  return { result: data[1][6], job: stored, writes };
}

test('inbox: delivery recovery refreshes an expired link on a SUCCEEDED render', () => {
  const r = inboxRun(succeeded(), recovery());
  assert.equal(r.result, 'LINK_REFRESHED');
  assert.equal(r.job.status, 'SUCCEEDED');
  assert.equal(r.job.videoUrl, NEW);
  assert.equal(r.job.version, 3);
  assert.equal(r.writes.length, 1);
});

test('inbox: a different artifact or a FAILED render is still ignored', () => {
  const other = inboxRun(succeeded(), recovery({ video: { url: NEW, gcsPath: 'renders/x/final.mp4' } }));
  assert.equal(other.result, 'IGNORED_TERMINAL');
  assert.equal(other.writes.length, 0);
  const failed = inboxRun(succeeded({ status: 'FAILED', videoUrl: '' }), recovery());
  assert.equal(failed.result, 'IGNORED_TERMINAL');
  assert.equal(failed.job.status, 'FAILED');
});

test('inbox: replaying the same recovery receipt is a no-op', () => {
  const first = inboxRun(succeeded(), recovery());
  const replay = inboxRun(first.job, recovery());
  assert.equal(replay.result, 'IGNORED_TERMINAL');
  assert.equal(replay.writes.length, 0);
});

// ---------- legacy route applies a refresh ----------

test('legacy callback route: same-artifact refresh updates the link, others are ignored', () => {
  function legacy(job, body) {
    let stored = JSON.parse(JSON.stringify(job));
    const writes = [];
    const context = load(['Models/RenderJob.js', 'Production/VideoLink_Service.js', 'Production/MediaWorkerCallback_Service.js'], {
      Secrets: { getMediaWorkerSharedSecret: () => 's' },
      VideoProcessingProvider: { isCloudRunRenderId: id => id.startsWith('cr-') },
      LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
      RenderJobRepository: { getByRenderId: id => (id === stored.renderId ? JSON.parse(JSON.stringify(stored)) : null),
        update: j => { writes.push(j); stored = JSON.parse(JSON.stringify(j)); return j; } }
    });
    context.event = { parameter: { secret: 's' }, postData: { contents: JSON.stringify(body) } };
    return { response: vm.runInContext('MediaWorkerCallbackService.handle(event)', context), job: stored, writes };
  }
  const ok = legacy(succeeded(), recovery());
  assert.equal(ok.response.refreshed, true);
  assert.equal(ok.job.videoUrl, NEW);
  assert.equal(ok.job.status, 'SUCCEEDED');
  const other = legacy(succeeded(), recovery({ video: { url: NEW, gcsPath: 'renders/x/final.mp4' } }));
  assert.equal(other.response.ignored, true);
  assert.equal(other.writes.length, 0);
});

console.log(`Video link lifetime and refresh: ${passed}/${passed} passed.`);
