'use strict';
// Regression tests: ProductionHealthService surfaces stuck and uncertain production states
// and never advises a blind re-render or re-upload.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'Production/ProductionHealth_Service.js'), 'utf8'),
  context, { filename: 'Production/ProductionHealth_Service.js' });
// The service returns objects created in the vm context; round-trip so deep equality is realm-safe.
const evaluate = input => JSON.parse(JSON.stringify(vm.runInContext(
  'ProductionHealthService.evaluate(' + JSON.stringify(input) + ')', context)));
const thresholds = JSON.parse(vm.runInContext('JSON.stringify(ProductionHealthService.thresholds)', context));

const NOW = Date.parse('2026-10-21T12:00:00.000Z');
const ago = ms => new Date(NOW - ms).toISOString();
const MIN = 60 * 1000, HOUR = 60 * MIN;
function render(overrides) {
  return Object.assign({ id: 'RND-1', scriptId: 'SCR-1', status: 'RENDERING', videoUrl: '',
    providerResponse: {}, createdAt: ago(5 * MIN), updatedAt: ago(MIN) }, overrides);
}
function upload(overrides) {
  return Object.assign({ id: 'PUB-1', renderJobId: 'RND-1', scriptId: 'SCR-1', status: 'PUBLISHED',
    youtubeVideoId: '', youtubeUrl: '', createdAt: ago(HOUR), updatedAt: ago(HOUR) }, overrides);
}
const run = (renderJobs, publishingJobs) => evaluate({ now: NOW, renderJobs: renderJobs || [], publishingJobs: publishingJobs || [] });
const codes = result => result.findings.map(item => item.code);

test('Healthy production state reports ok with no findings', () => {
  const result = run([render({ status: 'SUCCEEDED', videoUrl: 'https://example.com/v.mp4' })], [upload({ youtubeVideoId: 'V1' })]);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.counts, { critical: 0, warning: 0, total: 0 });
});
test('A recent active render is not flagged', () => {
  assert.deepEqual(codes(run([render({ createdAt: ago(thresholds.renderStuckWarningMs - MIN) })])), []);
});
test('A render active past the warning threshold is a warning, and never advises re-rendering', () => {
  const result = run([render({ createdAt: ago(thresholds.renderStuckWarningMs + MIN) })]);
  assert.deepEqual(codes(result), ['RENDER_STUCK_ACTIVE']);
  assert.equal(result.findings[0].severity, 'warning');
  assert.equal(result.findings[0].doNotRerender, true);
  assert.equal(result.status, 'attention');
});
test('A render active for hours is critical', () => {
  const result = run([render({ createdAt: ago(thresholds.renderStuckCriticalMs + MIN) })]);
  assert.equal(result.findings[0].severity, 'critical');
  assert.equal(result.status, 'critical');
});
test('Stuck age uses createdAt, so polling that refreshes updatedAt cannot hide a stuck render', () => {
  const result = run([render({ createdAt: ago(2 * HOUR), updatedAt: ago(MIN) })]);
  assert.deepEqual(codes(result), ['RENDER_STUCK_ACTIVE']);
});
test('Delivery recovery required is critical, forbids re-rendering and points at the recovery tool', () => {
  const result = run([render({ providerResponse: { reconciliation: { reason: 'DELIVERY_RECOVERY_REQUIRED' } } })]);
  assert.deepEqual(codes(result), ['RENDER_DELIVERY_RECOVERY_REQUIRED']);
  assert.equal(result.findings[0].doNotRerender, true);
  assert.match(result.findings[0].recovery, /Do not re-render/);
  assert.match(result.findings[0].recovery, /recover-delivery/);
});
test('A delivered success wins over stale recovery metadata', () => {
  const result = run([render({ status: 'SUCCEEDED', videoUrl: 'https://example.com/v.mp4',
    providerResponse: { reconciliation: { reason: 'DELIVERY_RECOVERY_REQUIRED' } } })]);
  assert.deepEqual(result.findings, []);
});
test('A render marked SUCCEEDED without a video URL is critical', () => {
  const result = run([render({ status: 'SUCCEEDED', videoUrl: '  ' })]);
  assert.deepEqual(codes(result), ['RENDER_SUCCEEDED_WITHOUT_VIDEO']);
  assert.equal(result.findings[0].severity, 'critical');
  assert.equal(result.findings[0].doNotRerender, true);
});
test('Ordinary FAILED and CANCELLED renders are not health findings', () => {
  assert.deepEqual(run([render({ status: 'FAILED' }), render({ id: 'RND-2', status: 'CANCELLED' })]).findings, []);
});

test('An uncertain upload is critical and forbids both re-rendering and uploading again', () => {
  const result = run([], [upload({ status: 'RECONCILE' })]);
  assert.deepEqual(codes(result), ['UPLOAD_UNCERTAIN']);
  assert.equal(result.findings[0].severity, 'critical');
  assert.equal(result.findings[0].doNotRerender, true);
  assert.equal(result.findings[0].doNotUploadAgain, true);
  assert.match(result.findings[0].recovery, /YouTube Studio/);
});
test('An upload in progress is fine until it outlives an execution', () => {
  assert.deepEqual(run([], [upload({ status: 'UPLOADING', createdAt: ago(thresholds.uploadStuckWarningMs - MIN) })]).findings, []);
  const stuck = run([], [upload({ status: 'UPLOADING', createdAt: ago(thresholds.uploadStuckWarningMs + MIN) })]);
  assert.deepEqual(codes(stuck), ['UPLOAD_STUCK_UPLOADING']);
  assert.equal(stuck.findings[0].severity, 'warning');
  assert.equal(stuck.findings[0].doNotUploadAgain, true);
});
test('A failed upload that recorded a YouTube video is critical (ID or URL)', () => {
  for (const evidence of [{ youtubeVideoId: 'V1' }, { youtubeUrl: 'https://youtu.be/V1' }]) {
    const result = run([], [upload(Object.assign({ status: 'FAILED' }, evidence))]);
    assert.deepEqual(codes(result), ['UPLOAD_FAILED_WITH_VIDEO_EVIDENCE']);
    assert.equal(result.findings[0].doNotUploadAgain, true);
  }
});
test('A plain failed upload and a published upload are not findings', () => {
  assert.deepEqual(run([], [upload({ status: 'FAILED' }), upload({ id: 'PUB-2', youtubeVideoId: 'V2' })]).findings, []);
});

test('Two different YouTube videos for one script is a critical duplicate', () => {
  const result = run([], [
    upload({ id: 'PUB-1', renderJobId: 'RND-1', youtubeVideoId: 'V1' }),
    upload({ id: 'PUB-2', renderJobId: 'RND-2', youtubeVideoId: 'V2' })
  ]);
  assert.deepEqual(codes(result), ['DUPLICATE_YOUTUBE_UPLOADS']);
  assert.equal(result.findings[0].severity, 'critical');
  assert.deepEqual(result.findings[0].subject, { scriptId: 'SCR-1' });
  assert.match(result.findings[0].message, /V1/);
  assert.match(result.findings[0].message, /V2/);
  assert.match(result.findings[0].recovery, /has not deleted anything/);
});
test('The same video recorded twice, or different scripts, is not a duplicate', () => {
  assert.deepEqual(run([], [
    upload({ id: 'PUB-1', youtubeVideoId: 'V1' }), upload({ id: 'PUB-2', youtubeVideoId: 'V1' })
  ]).findings, []);
  assert.deepEqual(run([], [
    upload({ id: 'PUB-1', scriptId: 'SCR-1', youtubeVideoId: 'V1' }),
    upload({ id: 'PUB-2', scriptId: 'SCR-2', youtubeVideoId: 'V2' })
  ]).findings, []);
});

test('Every finding that concerns an upload forbids a blind re-render and re-upload', () => {
  const result = run(
    [render({ id: 'RND-9', createdAt: ago(5 * HOUR) })],
    [upload({ id: 'PUB-A', status: 'RECONCILE' }),
      upload({ id: 'PUB-B', status: 'UPLOADING', createdAt: ago(HOUR) }),
      upload({ id: 'PUB-C', status: 'FAILED', youtubeVideoId: 'VX' }),
      upload({ id: 'PUB-D', renderJobId: 'RND-3', youtubeVideoId: 'V1' }),
      upload({ id: 'PUB-E', renderJobId: 'RND-4', youtubeVideoId: 'V2' })]);
  assert.ok(result.findings.length >= 5);
  for (const item of result.findings) {
    assert.equal(item.doNotRerender, true, item.code + ' must forbid re-rendering');
    assert.match(item.recovery, /[Dd]o not/, item.code + ' must say what not to do');
    if (item.subject.publishingJobId || item.code === 'DUPLICATE_YOUTUBE_UPLOADS') {
      assert.equal(item.doNotUploadAgain, true, item.code + ' must forbid uploading again');
    }
  }
});

test('Findings are ordered critical first, then oldest first', () => {
  const result = run(
    [render({ id: 'RND-W', createdAt: ago(thresholds.renderStuckWarningMs + 5 * MIN) })],
    [upload({ id: 'PUB-NEW', status: 'RECONCILE', createdAt: ago(HOUR) }),
      upload({ id: 'PUB-OLD', status: 'RECONCILE', createdAt: ago(5 * HOUR) })]);
  assert.deepEqual(result.findings.map(item => item.subject.publishingJobId || item.subject.renderJobId),
    ['PUB-OLD', 'PUB-NEW', 'RND-W']);
});
test('Output is capped at 50 findings but the counts stay exact', () => {
  const many = Array.from({ length: 60 }, (_, i) => render({ id: 'RND-' + i, createdAt: ago(2 * HOUR) }));
  const result = run(many);
  assert.equal(result.findings.length, 50);
  assert.equal(result.truncated, 10);
  assert.equal(result.counts.total, 60);
});
test('Malformed input never throws and never mutates its input', () => {
  assert.equal(evaluate(null).status, 'ok');
  assert.equal(evaluate({ renderJobs: 'nope', publishingJobs: {} }).status, 'ok');
  const result = run([null, {}, render({ id: 'RND-BAD', createdAt: 'not a date' }), render({ id: '', status: 'RENDERING' })],
    [null, { id: 'PUB-X' }, upload({ status: 'RECONCILE', createdAt: 'garbage' })]);
  assert.deepEqual(codes(result), ['UPLOAD_UNCERTAIN']);
  // Evaluate inside the same realm and compare the live input object before and after.
  context.input = { now: NOW, renderJobs: [render({ createdAt: ago(5 * HOUR) })], publishingJobs: [upload({ status: 'RECONCILE' })] };
  assert.equal(vm.runInContext(
    'const before = JSON.stringify(input); ProductionHealthService.evaluate(input); JSON.stringify(input) === before', context), true);
});
test('Findings never contain credentials or provider response bodies', () => {
  const result = run([render({ createdAt: ago(5 * HOUR), providerResponse: { token: 'sk-secret_value_12345', video: { url: 'https://signed.example/v?X-Goog-Signature=abc' } } })]);
  assert.doesNotMatch(JSON.stringify(result), /secret_value|X-Goog-Signature|signed\.example/);
});

// ---------- video link lifetime (with VideoLinkService loaded, as in Apps Script) ----------
const linkContext = vm.createContext({});
for (const file of ['Production/VideoLink_Service.js', 'Production/ProductionHealth_Service.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), linkContext, { filename: file });
}
const runWithLinks = (renderJobs, publishingJobs) => JSON.parse(JSON.stringify(vm.runInContext(
  'ProductionHealthService.evaluate(' + JSON.stringify({ now: NOW, renderJobs, publishingJobs: publishingJobs || [] }) + ')', linkContext)));
const signedUrl = (date) => 'https://storage.googleapis.com/b/renders/x/final.mp4?X-Goog-Date=' + date + '&X-Goog-Expires=604800&X-Goog-Signature=s';

test('Expired link on an unpublished render warns, and says not to re-render', () => {
  const result = runWithLinks([render({ status: 'SUCCEEDED', videoUrl: signedUrl('20261010T120000Z') })]);
  assert.deepEqual(codes(result), ['RENDER_VIDEO_LINK_EXPIRED']);
  assert.equal(result.findings[0].severity, 'warning');
  assert.equal(result.findings[0].doNotRerender, true);
  assert.match(result.findings[0].recovery, /delivery recovery/);
});
test('Link expiring within 48 hours warns; a fresh link does not', () => {
  assert.deepEqual(codes(runWithLinks([render({ status: 'SUCCEEDED', videoUrl: signedUrl('20261015T120000Z') })])), ['RENDER_VIDEO_LINK_EXPIRING']);
  assert.deepEqual(codes(runWithLinks([render({ status: 'SUCCEEDED', videoUrl: signedUrl('20261021T110000Z') })])), []);
});
test('Expired link is not flagged once the render is on YouTube or uploading', () => {
  for (const status of ['PUBLISHED', 'UPLOADING', 'RECONCILE']) {
    const result = runWithLinks([render({ status: 'SUCCEEDED', videoUrl: signedUrl('20261010T120000Z') })], [upload({ status, createdAt: ago(MIN) })]);
    assert.equal(codes(result).includes('RENDER_VIDEO_LINK_EXPIRED'), false, status);
  }
});
test('Unsigned video URLs and missing VideoLinkService produce no link findings', () => {
  assert.deepEqual(codes(runWithLinks([render({ status: 'SUCCEEDED', videoUrl: 'https://example.com/v.mp4' })])), []);
  assert.deepEqual(codes(run([render({ status: 'SUCCEEDED', videoUrl: signedUrl('20261010T120000Z') })])), []);
});

// ---------- deliveries for render IDs no render job has ----------
const runReceipts = (renderJobs, callbackReceipts) => evaluate({ now: NOW, renderJobs, publishingJobs: [], callbackReceipts });
const UNKNOWN = 'cr-99999999-9999-4999-8999-999999999999';
const receiptRow = (overrides) => Object.assign({ renderId: UNKNOWN, status: 'completed', receivedAt: ago(20 * MIN), handled: false, result: '' }, overrides);

test('Completed delivery for an unknown render ID is critical and says not to re-render', () => {
  const result = runReceipts([render({ status: 'FAILED', renderId: '' })], [receiptRow()]);
  assert.deepEqual(codes(result), ['RENDER_DELIVERY_UNMATCHED']);
  const finding = result.findings[0];
  assert.equal(finding.severity, 'critical');
  assert.equal(finding.doNotRerender, true);
  assert.equal(finding.subject.renderId, UNKNOWN);
  assert.match(finding.recovery, /Unmatched delivery/);
});
test('Unmatched delivery is also flagged once the receipt is ORPHANED', () => {
  assert.deepEqual(codes(runReceipts([], [receiptRow({ handled: true, result: 'ORPHANED', receivedAt: ago(50 * HOUR) })])), ['RENDER_DELIVERY_UNMATCHED']);
});
test('Matched, recent, failed-status, rejected or duplicate receipts are not flagged twice or wrongly', () => {
  assert.deepEqual(codes(runReceipts([render({ renderId: UNKNOWN, status: 'SUCCEEDED', videoUrl: 'https://example.com/v.mp4' })], [receiptRow()])), []);
  assert.deepEqual(codes(runReceipts([], [receiptRow({ receivedAt: ago(5 * MIN) })])), [], 'normal fast-callback window');
  assert.deepEqual(codes(runReceipts([], [receiptRow({ status: 'failed' })])), []);
  assert.deepEqual(codes(runReceipts([], [receiptRow({ result: 'REJECTED_NO_VIDEO', handled: true })])), []);
  assert.equal(codes(runReceipts([], [receiptRow(), receiptRow()])).length, 1, 'one finding per render ID');
});
test('No receipts input keeps earlier behaviour', () => {
  assert.deepEqual(codes(evaluate({ now: NOW, renderJobs: [], publishingJobs: [] })), []);
});

console.log(`Production health: ${passed}/${passed} passed.`);
