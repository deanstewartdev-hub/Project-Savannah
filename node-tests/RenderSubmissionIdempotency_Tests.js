'use strict';
// Regression tests: a render submission interrupted after the worker accepted the job must
// never look like a failed submit that invites a second paid render.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const CR_ID = /^cr-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function words(count) { return Array.from({ length: count }, (_, i) => 'word' + i).join(' '); }
const script = { id: 'SCR-1', title: 'Test', scenes: [
  { narration: words(30) + '.', visualDirection: 'A clear scene.' },
  { narration: words(30) + '.', visualDirection: 'Another scene.' },
  { narration: words(30) + '.', visualDirection: 'A third scene.' }] };

// --- Provider: CloudRunFFmpegProvider.submitRender and request_ ---
function providerFixture(options = {}) {
  const posts = [];
  const context = vm.createContext({
    Utilities: { getUuid: randomUUID },
    Secrets: {
      getMediaWorkerUrl: () => options.noWorkerUrl ? '' : 'https://worker.example',
      getMediaWorkerJobSubmitSecret: () => 'submit-secret-for-tests',
      getMediaWorkerSharedSecret: () => 'callback-secret-for-tests',
      getMediaWorkerCallbackUrl: () => options.noCallbackUrl ? '' : 'https://script.google.com/macros/s/TEST/exec',
      getVideoProvider: () => 'cloud-run'
    },
    UrlFetchApp: {
      fetch(url, request) {
        posts.push(JSON.parse(request.payload));
        if (options.fetchThrows) throw new Error('Timeout: ' + url);
        const reply = options.reply || {};
        const body = reply.raw !== undefined ? reply.raw : JSON.stringify(reply.json || { jobId: posts[posts.length - 1].jobId });
        return { getResponseCode: () => reply.status || 202, getContentText: () => body };
      }
    }
  });
  vm.runInContext(read('Production/VideoProcessingProvider.js'), context, { filename: 'Production/VideoProcessingProvider.js' });
  context.script = script;
  const submit = renderId => {
    context.renderId = renderId;
    return vm.runInContext('CloudRunFFmpegProvider.submitRender(script, null, renderId === undefined ? undefined : { renderId: renderId })', context);
  };
  const failure = renderId => {
    try { submit(renderId); } catch (caught) { return caught; }
    assert.fail('submitRender was expected to throw');
  };
  return { submit, failure, posts, call: expr => vm.runInContext(expr, context) };
}

test('A reserved render ID has the dispatcher job ID shape and is unique each time', () => {
  const f = providerFixture();
  const a = f.call('CloudRunFFmpegProvider.reserveRenderId()'), b = f.call('CloudRunFFmpegProvider.reserveRenderId()');
  assert.match(a, CR_ID); assert.match(b, CR_ID); assert.notEqual(a, b);
});
test('submitRender sends the reserved ID to the worker and returns it', () => {
  const f = providerFixture();
  const reserved = f.call('CloudRunFFmpegProvider.reserveRenderId()');
  const result = f.submit(reserved);
  assert.equal(f.posts.length, 1);
  assert.equal(f.posts[0].jobId, reserved);
  assert.equal(result.render.id, reserved);
});
test('A malformed reserved ID is ignored and a valid one is generated', () => {
  for (const bad of ['', 'not-an-id', 'cr-123', '../cr-00000000-0000-0000-0000-000000000000']) {
    const f = providerFixture();
    f.submit(bad);
    assert.match(f.posts[0].jobId, CR_ID);
    assert.notEqual(f.posts[0].jobId, bad);
  }
});
test('Without options, submitRender still generates its own ID (backwards compatible)', () => {
  const f = providerFixture();
  assert.match(f.submit(undefined).render.id, CR_ID);
});
test('A network failure is annotated as outcome-unknown without changing the error', () => {
  const caught = providerFixture({ fetchThrows: true }).failure();
  assert.equal(caught.outcomeUnknown, true);
  assert.match(caught.message, /Timeout/);
});
test('Definitive rejections are not outcome-unknown: 4xx and the dispatcher JSON 502', () => {
  for (const reply of [
    { status: 400, json: { error: 'beats are invalid' } },
    { status: 401, json: { error: 'unauthorised' } },
    { status: 502, json: { jobId: 'x', error: 'Failed to start render job', message: 'PERMISSION_DENIED' } }]) {
    const caught = providerFixture({ reply }).failure();
    assert.equal(caught.outcomeUnknown, false, 'HTTP ' + reply.status + ' means nothing started');
    assert.equal(caught.httpStatus, reply.status);
  }
});
test('Ambiguous server responses are outcome-unknown: 503, and a 502 that is not the dispatcher', () => {
  for (const reply of [
    { status: 503, raw: 'Service Unavailable' },
    { status: 504, raw: '' },
    { status: 502, raw: '<html>Bad Gateway</html>' },
    { status: 502, json: { error: 'something else' } }]) {
    const caught = providerFixture({ reply }).failure();
    assert.equal(caught.outcomeUnknown, true, 'HTTP ' + reply.status + ' could have started a render');
  }
});
test('A 202 that does not echo the job ID is outcome-unknown', () => {
  const caught = providerFixture({ reply: { status: 202, json: { jobId: 'cr-someone-else' } } }).failure();
  assert.equal(caught.outcomeUnknown, true);
});
test('Configuration errors raised before any request are not outcome-unknown', () => {
  for (const options of [{ noWorkerUrl: true }, { noCallbackUrl: true }]) {
    const f = providerFixture(options);
    const caught = f.failure();
    assert.notEqual(caught.outcomeUnknown, true);
    assert.equal(f.posts.length, 0, 'No request may be made');
  }
});

// --- Controller: submitCore_ ---
function controllerFixture(options = {}) {
  const saves = [], updates = [];
  let stored = null;
  const reserved = options.reserve === false ? null : 'cr-' + randomUUID();
  let submitOptions = null;
  const provider = {
    submitRender(scriptArg, seoPack, opts) {
      submitOptions = opts;
      if (options.fail) throw options.fail;
      return { render: { id: (opts && opts.renderId) || 'creatomate-1', status: 'RENDERING', progress: 5 }, payload: { provider: 'test' } };
    }
  };
  if (reserved) provider.reserveRenderId = () => reserved;
  const context = vm.createContext({
    Utilities: { getUuid: randomUUID }, Logger: { log() {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ScriptsRepository: { getScriptById: id => ({ id, status: 'APPROVED' }) },
    SeoRepository: { getByScriptId: () => ({ id: 'SEO-1' }) },
    PublishingJobRepository: { getAll: () => [] },
    Secrets: { getCreatomateTemplateId: () => 'tpl' },
    VideoProcessingProvider: { get: () => provider, forJob: () => provider },
    CreatomateProviderAdapter: {},
    RenderJobRepository: {
      getAll: () => stored ? [stored] : [],
      save(job) { saves.push(JSON.parse(JSON.stringify(job))); stored = job; return job; },
      update(job) { updates.push(JSON.parse(JSON.stringify(job))); stored = job; return job; }
    }
  });
  for (const file of ['Models/RenderJob.js', 'Production/ProductionError_Service.js', 'App/ProductionController.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }
  return {
    submit: () => vm.runInContext('ProductionController.submit({scriptId:"SCR-1"})', context),
    reserved, saves, updates, stored: () => stored, submitOptions: () => submitOptions
  };
}

test('The reserved render ID is saved on the row before the worker is asked to start', () => {
  const f = controllerFixture();
  const result = f.submit();
  assert.equal(result.success, true);
  assert.equal(f.saves.length, 1);
  assert.equal(f.saves[0].renderId, f.reserved, 'the first save, which precedes the network call, must carry the ID');
  assert.equal(f.saves[0].status, 'QUEUED');
  assert.equal(f.submitOptions().renderId, f.reserved);
  assert.equal(f.stored().renderId, f.reserved);
  assert.equal(f.stored().status, 'RENDERING');
});
test('An unconfirmed submission stays active under its ID and says not to re-render', () => {
  const unknown = Object.assign(new Error('Timeout'), { outcomeUnknown: true });
  const f = controllerFixture({ fail: unknown });
  const result = f.submit();
  assert.equal(result.success, false);
  assert.match(result.error.message, /Do not re-render/);
  assert.equal(f.stored().status, 'QUEUED', 'must not be marked FAILED');
  assert.equal(f.stored().renderId, f.reserved, 'the ID must be kept so the callback and status checks can find it');
  assert.match(f.stored().errorMessage, /Do not re-render/);
});
test('While a submission is unconfirmed, the script cannot be rendered a second time', () => {
  const unknown = Object.assign(new Error('Timeout'), { outcomeUnknown: true });
  const f = controllerFixture({ fail: unknown });
  f.submit();
  const second = f.submit();
  assert.equal(second.success, false);
  assert.match(second.error.message, /already has an active render/);
  assert.equal(f.saves.length, 1, 'no second render row may be created');
});
test('A definitive failure still marks the job FAILED and clears the unused ID', () => {
  const f = controllerFixture({ fail: Object.assign(new Error('bad request'), { outcomeUnknown: false, httpStatus: 400 }) });
  const result = f.submit();
  assert.equal(result.success, false);
  assert.equal(f.stored().status, 'FAILED');
  assert.equal(f.stored().renderId, '');
});
test('An error with no annotation (for example local validation) is a definitive failure', () => {
  const f = controllerFixture({ fail: new Error('The script has no scenes.') });
  f.submit();
  assert.equal(f.stored().status, 'FAILED');
  assert.equal(f.stored().renderId, '');
});
test('A provider without ID reservation (Creatomate) keeps the original behaviour', () => {
  const ok = controllerFixture({ reserve: false });
  assert.equal(ok.submit().success, true);
  assert.equal(ok.saves[0].renderId, '');
  assert.equal(ok.stored().renderId, 'creatomate-1');
  const failed = controllerFixture({ reserve: false, fail: Object.assign(new Error('Timeout'), { outcomeUnknown: true }) });
  failed.submit();
  assert.equal(failed.stored().status, 'FAILED', 'without a reserved ID there is nothing to reconcile against');
});

console.log(`Render submission idempotency: ${passed}/${passed} passed.`);
