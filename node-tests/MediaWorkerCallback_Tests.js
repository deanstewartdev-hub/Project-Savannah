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
