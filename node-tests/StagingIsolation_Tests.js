'use strict';
// Staging must never spend money, publish, or touch production data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }

const props = value => ({ getScriptProperties: () => ({ getProperty: n => (n === 'SAVANNAH_ENVIRONMENT' ? value : null) }) });
function guardContext(value, extra) {
  const context = vm.createContext(Object.assign({ PropertiesService: props(value) }, extra || {}));
  vm.runInContext(fs.readFileSync(path.join(root, 'Utils/EnvironmentGuard.js'), 'utf8'), context);
  return context;
}

test('guard refuses every paid/irreversible action in staging, and is a no-op otherwise', () => {
  const staging = guardContext('staging');
  assert.throws(() => vm.runInContext('assertNotStaging_("YouTube upload")', staging),
    e => e.name === 'StagingIsolationError' && /Refused in staging: YouTube upload/.test(e.message));
  for (const value of [null, '', 'production', 'Staging ']) {
    vm.runInContext('assertNotStaging_("YouTube upload")', guardContext(value));
  }
});

// [file, label passed to the guard, the outbound call it must precede]
const CALL_SITES = [
  ['AI/AI_OpenAI.js', 'OpenAI text generation', 'UrlFetchApp.fetch("https://api.openai.com/v1/responses"'],
  ['Production/VisualAsset_Service.js', 'OpenAI image generation', 'UrlFetchApp.fetch(IMAGE_URL'],
  ['Production/Voiceover_Service.js', 'OpenAI voiceover generation', 'UrlFetchApp.fetch(SPEECH_URL'],
  ['Production/Creatomate_Service.js', 'Creatomate rendering', 'UrlFetchApp.fetch(API_BASE + path'],
  ['Production/VideoProcessingProvider.js', 'Cloud Run render submission', 'request_("post", "/jobs", {'],
  ['Production/YouTube_Service.js', 'YouTube upload', 'YouTube.Videos.insert(']
];

test('each of the six paid or irreversible call sites is guarded, immediately before the call', () => {
  for (const [file, label, call] of CALL_SITES) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const guard = source.indexOf('assertNotStaging_("' + label + '")');
    const site = source.indexOf(call);
    assert.ok(guard !== -1, file + ': guard missing');
    assert.ok(site !== -1, file + ': call site not found (update this test if it moved)');
    assert.ok(guard < site, file + ': guard must come before the call');
    const between = source.slice(guard, site);
    assert.equal((between.match(/\n  function /g) || []).length, 0, file + ': guard and call are in different functions');
  }
});

test('YouTube upload in staging stops before downloading the video or calling YouTube', () => {
  const calls = [];
  const context = guardContext('staging', {
    UrlFetchApp: { fetch: () => { calls.push('download'); throw new Error('must not download'); } },
    YouTube: { Videos: { insert: () => { calls.push('insert'); }, list: () => { calls.push('list'); return { items: [] }; } },
      Channels: { list: () => ({ items: [{ id: 'C' }] }) } },
    Utilities: { getUuid: randomUUID }, Logger: { log() {} }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'Production/YouTube_Service.js'), 'utf8'), context);
  context.__job = { id: 'RND-1', status: 'SUCCEEDED', videoUrl: 'https://example.test/v.mp4' };
  context.__seo = { titleOptions: ['T'], description: 'D', tags: [], hashtags: [] };
  assert.throws(() => vm.runInContext('YouTubeService.upload(__job, __seo, { publishingJobId: "PUB-1" })', context), /Refused in staging/);
  assert.deepEqual(calls, []);
});

test('staging tools refuse a production-named spreadsheet even with the staging property set', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, 'Production/StagingVerification_Service.js'), 'utf8'), context);
  const service = vm.runInContext('StagingVerificationService', context);
  const writes = [];
  const env = {
    property: n => (n === 'SAVANNAH_ENVIRONMENT' ? 'staging' : null), setProperty: () => writes.push('prop'),
    spreadsheetName: () => 'Project Savannah', prepareSheets: () => writes.push('prepare'),
    uuid: randomUUID, now: () => Date.now(), createRenderJob: () => writes.push('job')
  };
  assert.throws(() => service.seed(env), /spreadsheet whose name contains STAGING/);
  assert.throws(() => service.verify(env), /spreadsheet whose name contains STAGING/);
  assert.deepEqual(writes, [], 'Nothing may be written when refused.');
});

test('staging sender and runner hard-refuse the production deployment ID from HANDOFF.md', () => {
  const handoff = fs.readFileSync(path.join(root, 'HANDOFF.md'), 'utf8');
  const productionId = /Apps Script production Deployment ID:\*\*\s*`(AKfycb[^`]+)`/.exec(handoff)[1];
  const { stagingTarget, Refused } = require('./staging/send-synthetic-callback.cjs');
  assert.throws(() => stagingTarget({ SAVANNAH_STAGING_BRIDGE_URL: 'https://script.google.com/macros/s/' + productionId + '/exec',
    SAVANNAH_STAGING_CALLBACK_SECRET: 'x' }), e => e instanceof Refused && /PRODUCTION/.test(e.message));
});

console.log(`Staging isolation: ${passed}/${passed} passed.`);
