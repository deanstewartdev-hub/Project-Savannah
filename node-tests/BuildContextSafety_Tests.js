'use strict';
// The media-worker folder holds a local service-account key (gitignored at the repo
// root). The repo-root .gitignore does not apply to a build context rooted at
// media-worker/, so the worker's own ignore files must keep credentials out of
// both Docker builds and `gcloud builds submit` uploads, and the image must only
// contain package files and src/.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const worker = path.resolve(__dirname, '..', 'media-worker');
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }

const CREDENTIAL_PATTERNS = ['gcp-key.json', 'gcp-key-b64.txt', 'b64-chunk-*.txt', '*.pem', '*-key.json'];
const lines = file => fs.readFileSync(path.join(worker, file), 'utf8').split(/\r?\n/).map(l => l.trim());

for (const file of ['.dockerignore', '.gcloudignore']) {
  test(file + ' excludes every credential file pattern', () => {
    const entries = lines(file);
    for (const pattern of CREDENTIAL_PATTERNS) assert.ok(entries.includes(pattern), file + ' is missing ' + pattern);
    assert.ok(entries.includes('node_modules') || entries.includes('node_modules/'), file + ' must exclude node_modules');
  });
}

test('the Dockerfile copies only package files and src/ into the image', () => {
  const copies = lines('Dockerfile').filter(l => /^COPY\b/i.test(l));
  assert.deepEqual(copies, ['COPY package.json package-lock.json* ./', 'COPY src ./src']);
});

test('the repo root .gitignore still keeps the local key files out of git', () => {
  const root = fs.readFileSync(path.join(worker, '..', '.gitignore'), 'utf8');
  for (const pattern of ['media-worker/gcp-key.json', 'media-worker/gcp-key-b64.txt', 'media-worker/b64-chunk-*.txt']) {
    assert.ok(root.includes(pattern), '.gitignore is missing ' + pattern);
  }
});

console.log(`Build context safety: ${passed}/${passed} passed.`);
