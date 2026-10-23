'use strict';
// tools/staging/new-staging-secret.cjs: creates a staging secret without printing it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run } = require('../tools/staging/new-staging-secret.cjs');
const { stagingTarget, Refused } = require('./staging/send-synthetic-callback.cjs');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'savannah-secret-test-'));
const file = path.join(dir, 'sub', 'callback-secret');
const clipboard = [];
const copy = text => clipboard.push(text);

test('creates a 64-character secret, copies it, saves it, and never puts it in the message', () => {
  const message = run([], { file, copy });
  const secret = fs.readFileSync(file, 'utf8');
  assert.match(secret, /^[0-9a-f]{64}$/);
  assert.equal(clipboard[0], secret);
  assert.equal(message.includes(secret), false);
});

test('refuses to overwrite an existing secret; --copy re-copies; --replace makes a new one', () => {
  const first = fs.readFileSync(file, 'utf8');
  assert.throws(() => run([], { file, copy }), /already exists/);
  run(['--copy'], { file, copy });
  assert.equal(clipboard[clipboard.length - 1], first);
  run(['--replace'], { file, copy });
  assert.notEqual(fs.readFileSync(file, 'utf8'), first);
});

test('the staging sender can read the secret from the file, and still refuses without one', () => {
  const url = 'https://script.google.com/macros/s/AKfycbSTAGINGtest/exec';
  const target = stagingTarget({ SAVANNAH_STAGING_BRIDGE_URL: url, SAVANNAH_STAGING_SECRET_FILE: file });
  assert.equal(target.secret, fs.readFileSync(file, 'utf8'));
  assert.throws(() => stagingTarget({ SAVANNAH_STAGING_BRIDGE_URL: url, SAVANNAH_STAGING_SECRET_FILE: path.join(dir, 'missing') }), Refused);
});

test('--from-clipboard saves a secret already configured elsewhere and reports only its fingerprint', () => {
  const existing = 'a'.repeat(32) + 'b'.repeat(32);
  const message = run(['--from-clipboard'], { file, copy, readClipboard: () => existing + '\r\n' });
  assert.equal(fs.readFileSync(file, 'utf8'), existing);
  assert.equal(message.includes(existing), false);
  assert.match(message, /fingerprint [0-9a-f]{12}/);
  assert.throws(() => run(['--from-clipboard'], { file, copy, readClipboard: () => 'not a secret!' }), /secret-like/);
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(`Staging secret tool: ${passed}/${passed} passed.`);
