#!/usr/bin/env node
'use strict';

// Project Savannah: legacy media-worker callback terminal-state safety.
// Synthetic fixtures only: no spreadsheet, network, or live Google services.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'Production', 'MediaWorkerCallback_Service.js'), 'utf8');

function fixture(initialStatus, options = {}) {
  let row = {
    id: 'RND-SYNTHETIC',
    renderId: 'cr-11111111-1111-1111-1111-111111111111',
    status: initialStatus,
    videoUrl: initialStatus === 'SUCCEEDED' ? 'https://example.test/success.mp4' : '',
    providerResponse: { evidence: 'keep-this-original-result' },
    version: 3
  };
  const writes = [];
  let locks = 0;
  let releases = 0;
  const sandbox = {
    Secrets: { getMediaWorkerSharedSecret: () => 'synthetic-secret' },
    RenderJobRepository: {
      getByRenderId: (id) => id === row.renderId ? row : null,
      update: (updated) => { writes.push(updated); row = updated; return updated; }
    },
    RenderJobModel: { update: (job, changes) => ({ ...job, ...changes, version: job.version + 1 }) },
    VideoProcessingProvider: { isCloudRunRenderId: (id) => id.startsWith('cr-') },
    LockService: { getScriptLock: () => ({
      tryLock: () => { locks++; return options.lockAvailable !== false; },
      releaseLock: () => { releases++; }
    }) },
    Logger: { log: () => {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Production', 'VideoLink_Service.js'), 'utf8'), sandbox, { filename: 'VideoLink_Service.js' });
  vm.runInContext(source, sandbox, { filename: 'MediaWorkerCallback_Service.js' });
  return {
    handle: (status, more = {}) => {
      const event = {
        parameter: { secret: 'synthetic-secret' },
        postData: { contents: JSON.stringify({
          jobId: row.renderId, status, video: { url: 'https://example.test/new.mp4' },
          error: { message: 'delayed worker failure' }, ...more
        }) }
      };
      sandbox.event = event;
      return vm.runInContext('MediaWorkerCallbackService.handle(event)', sandbox);
    },
    handleRaw: (parameter, body) => {
      sandbox.event = { parameter, postData: { contents: JSON.stringify(Object.assign({ jobId: row.renderId, status: 'completed', video: { url: 'https://example.test/new.mp4' } }, body)) } };
      return vm.runInContext('MediaWorkerCallbackService.handle(event)', sandbox);
    },
    handleWithSecret: (secret) => {
      sandbox.event = { parameter: { secret }, postData: { contents: JSON.stringify({ jobId: row.renderId, status: 'completed', video: { url: 'https://example.test/new.mp4' } }) } };
      return vm.runInContext('MediaWorkerCallbackService.handle(event)', sandbox);
    },
    writes, getRow: () => row, getLocks: () => locks, getReleases: () => releases
  };
}

function runTests() {
  const cases = [
    ['delayed failure cannot overwrite a successful legacy render', () => {
      const f = fixture('SUCCEEDED');
      const original = JSON.stringify(f.getRow());
      const result = f.handle('failed');
      if (!result.success || !result.ignored || f.writes.length || JSON.stringify(f.getRow()) !== original) {
        throw new Error('Succeeded render changed after delayed failure.');
      }
      if (f.getLocks() !== 1 || f.getReleases() !== 1) throw new Error('Lock must be released.');
    }],
    ['duplicate completion preserves original video and metadata', () => {
      const f = fixture('SUCCEEDED');
      const original = JSON.stringify(f.getRow());
      const result = f.handle('completed');
      if (!result.success || f.writes.length || JSON.stringify(f.getRow()) !== original) {
        throw new Error('Duplicate completion must be a no-op.');
      }
    }],
    ['late completion after failed or cancelled requires manual reconciliation', () => {
      for (const status of ['FAILED', 'CANCELLED']) {
        const f = fixture(status);
        const original = JSON.stringify(f.getRow());
        const result = f.handle('completed');
        if (!result.success || !result.ignored || f.writes.length || JSON.stringify(f.getRow()) !== original) {
          throw new Error('Terminal ' + status + ' must not be overwritten.');
        }
      }
    }],
    ['active completion still persists once', () => {
      const f = fixture('RENDERING');
      const result = f.handle('completed');
      if (!result.success || f.writes.length !== 1 || f.getRow().status !== 'SUCCEEDED' ||
          f.getRow().videoUrl !== 'https://example.test/new.mp4' || f.getLocks() !== 1 || f.getReleases() !== 1) {
        throw new Error('Active callback did not save once and release lock.');
      }
    }],
    ['invalid callback status fails closed', () => {
      const f = fixture('RENDERING');
      const result = f.handle('not-a-status');
      if (result.success || f.writes.length || f.getLocks()) {
        throw new Error('Unknown callback status must be rejected before locking.');
      }
    }],
    ['completed callback without an https video never records SUCCEEDED', () => {
      for (const video of [{}, { url: '' }, { url: 'http://example.test/v.mp4' }, { url: '  ' }, 'not-an-object']) {
        const f = fixture('RENDERING');
        const result = f.handle('completed', { video });
        if (result.success || !/^Malformed/.test(result.error) || f.writes.length || f.getLocks()) {
          throw new Error('Accepted completion without a deliverable video: ' + JSON.stringify(video));
        }
        if (f.getRow().status !== 'RENDERING') throw new Error('Render must stay active for reconciliation.');
      }
    }],
    ['render that already has a video URL is not overwritten by a late failure', () => {
      const f = fixture('RENDERING');
      f.handle('completed');
      const withVideo = JSON.stringify(f.getRow());
      const stale = fixture('RENDERING');
      stale.getRow().videoUrl = 'https://example.test/already.mp4';
      const result = stale.handle('failed');
      if (!result.success || !result.ignored || stale.writes.length) {
        throw new Error('A render with media evidence was overwritten.');
      }
      if (!withVideo.includes('SUCCEEDED')) throw new Error('Control completion failed.');
    }],
    ['the secret in the JSON body is accepted and the render is recorded once', () => {
      const f = fixture('RENDERING');
      const result = f.handleRaw({}, { callbackSecret: 'synthetic-secret' });
      if (!result.success || f.writes.length !== 1 || f.getRow().status !== 'SUCCEEDED') {
        throw new Error('A correct body secret must be accepted.');
      }
    }],
    ['the body secret decides: a correct URL secret cannot override a wrong body secret', () => {
      const f = fixture('RENDERING');
      const result = f.handleRaw({ secret: 'synthetic-secret' }, { callbackSecret: 'wrong' });
      if (result.success || result.error !== 'Unauthorized.' || f.writes.length || f.getLocks()) {
        throw new Error('A wrong body secret must be refused even with a correct URL secret.');
      }
    }],
    ['a render submitted before the change (URL secret only) is still accepted during the transition', () => {
      const f = fixture('RENDERING');
      const result = f.handleRaw({ secret: 'synthetic-secret' }, {});
      if (!result.success || f.writes.length !== 1) {
        throw new Error('The transitional URL-secret fallback must still accept in-flight renders.');
      }
    }],
    ['a request with no secret at all is refused before any lookup', () => {
      const f = fixture('RENDERING');
      const result = f.handleRaw({}, {});
      if (result.success || result.error !== 'Unauthorized.' || f.writes.length || f.getLocks()) {
        throw new Error('A request with no secret must be refused.');
      }
    }],
    ['wrong, truncated or extended secrets are rejected before any lookup', () => {
      for (const secret of ['synthetic-secre', 'synthetic-secret-x', 'Synthetic-secret', '']) {
        const f = fixture('RENDERING');
        const result = f.handleWithSecret(secret);
        if (result.success || result.error !== 'Unauthorized.' || f.writes.length || f.getLocks()) {
          throw new Error('Accepted secret ' + JSON.stringify(secret));
        }
      }
    }],
    ['lock contention is retryable and writes nothing', () => {
      const f = fixture('RENDERING', { lockAvailable: false });
      const result = f.handle('completed');
      if (result.success || !/busy/i.test(result.error) || f.writes.length ||
          f.getReleases() !== 0) {
        throw new Error('Busy callback must fail without modifying a row.');
      }
    }]
  ];
  let passed = 0;
  for (const [name, fn] of cases) {
    try { fn(); passed++; console.log('PASS ' + name); }
    catch (error) { console.error('FAIL ' + name + ': ' + error.message); }
  }
  console.log('Legacy callback safety: ' + passed + '/' + cases.length + ' passed.');
  if (passed !== cases.length) process.exitCode = 1;
}

runTests();
