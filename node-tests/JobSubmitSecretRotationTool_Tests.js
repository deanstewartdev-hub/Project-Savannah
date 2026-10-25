'use strict';
// tools/security/job-submit-secret-rotation.cjs: creates and checks the production dispatcher
// secret for a rotation without printing it or writing to Google Cloud.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run, fingerprint } = require('../tools/security/job-submit-secret-rotation.cjs');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'savannah-rotation-test-'));
const file = path.join(dir, 'sub', 'job-submit-secret');
const clipboard = [];
const copy = text => clipboard.push(text);

test('"new" writes a 43-character base64url secret with no newline and never puts it in the message', () => {
  const message = run(['new'], { file });
  const secret = fs.readFileSync(file, 'utf8');
  assert.match(secret, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(secret, secret.trim());
  assert.equal(message.includes(secret), false);
  assert.match(message, new RegExp('fingerprint ' + fingerprint(secret)));
});

test('"new" refuses to replace an in-progress rotation secret', () => {
  const existing = fs.readFileSync(file, 'utf8');
  assert.throws(() => run(['new'], { file }), /already exists/);
  assert.equal(fs.readFileSync(file, 'utf8'), existing);
});

test('"copy" copies the exact file bytes and does not print them', () => {
  const secret = fs.readFileSync(file, 'utf8');
  const message = run(['copy'], { file, copy });
  assert.equal(clipboard[clipboard.length - 1], secret);
  assert.equal(message.includes(secret), false);
});

test('"verify" reports a match, a mismatch and surrounding whitespace by fingerprint only', () => {
  const secret = fs.readFileSync(file, 'utf8');
  const match = run(['verify', '2'], { file, accessSecretVersion: () => secret });
  assert.match(match, /version 2: MATCHES/);
  assert.equal(match.includes(secret), false);
  assert.match(run(['verify', 'latest'], { file, accessSecretVersion: () => 'some-other-value' }), /DIFFERS FROM/);
  const crlf = run(['verify', '2'], { file, accessSecretVersion: () => secret + '\r\n' });
  assert.match(crlf, /DIFFERS FROM/);
  assert.match(crlf, /surrounding whitespace/);
});

test('"verify" requires a version, and nothing works before "new"', () => {
  assert.throws(() => run(['verify'], { file, accessSecretVersion: () => '' }), /Usage/);
  assert.throws(() => run(['verify', '1; rm -rf'], { file, accessSecretVersion: () => '' }), /Usage/);
  const missing = path.join(dir, 'missing');
  assert.throws(() => run(['copy'], { file: missing, copy }), /Run this tool with "new" first/);
  assert.throws(() => run(['unknown'], { file }), /Usage/);
});

test('"check-clipboard" confirms the property copied back from Apps Script, by fingerprint only', () => {
  const secret = fs.readFileSync(file, 'utf8');
  const ok = run(['check-clipboard'], { file, readClipboard: () => secret + '\r\n' });
  assert.match(ok, /Clipboard MATCHES/);
  assert.equal(ok.includes(secret), false);
  assert.match(run(['check-clipboard'], { file, readClipboard: () => 'the-old-value' }), /DIFFERS FROM/);
  const spaced = run(['check-clipboard'], { file, readClipboard: () => ' ' + secret });
  assert.match(spaced, /DIFFERS FROM/);
  assert.match(spaced, /surrounding whitespace/);
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(`Job submit secret rotation tool: ${passed}/${passed} passed.`);
