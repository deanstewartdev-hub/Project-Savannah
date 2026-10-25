#!/usr/bin/env node
'use strict';
// Helps rotate the PRODUCTION dispatcher secret (JOB_SUBMIT_SECRET in Secret Manager, and
// MEDIA_WORKER_JOB_SUBMIT_SECRET in the production main app) without ever printing it.
// The full, approval-gated procedure is RELEASE_READINESS.md section 10.
//
//   node tools/security/job-submit-secret-rotation.cjs new             create the new value (refuses to overwrite)
//   node tools/security/job-submit-secret-rotation.cjs copy            copy it to the clipboard (for the Apps Script property)
//   node tools/security/job-submit-secret-rotation.cjs verify <ver>    compare Secret Manager version <ver> with the file
//   node tools/security/job-submit-secret-rotation.cjs check-clipboard [ver]
//       compare the clipboard (copied out of the production Script properties) with the file,
//       or with Secret Manager version <ver> (use 1 before starting, to confirm today's value)
//
// The value lives in a private file in your user folder, outside the repository, with no
// trailing newline (the worker refuses a secret with surrounding whitespace at start-up).
// `gcloud secrets versions add job-submit-secret --data-file=<that file>` stores it byte for
// byte; piping it through PowerShell would append CRLF. Delete the folder once rotation is done.
// This tool never writes to Google Cloud or Apps Script itself.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT = 'savannah-media-worker';
const SECRET_NAME = 'job-submit-secret';

function secretPath(home) {
  return path.join(home || os.homedir(), '.savannah-rotation', 'job-submit-secret');
}

// First 12 hex characters of the SHA-256: lets two copies be compared without revealing either.
function fingerprint(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function copyToClipboard(text) {
  const command = process.platform === 'win32' ? 'clip' : process.platform === 'darwin' ? 'pbcopy' : 'xclip';
  const args = process.platform === 'linux' ? ['-selection', 'clipboard'] : [];
  const result = spawnSync(command, args, { input: text });
  if (result.status !== 0) throw new Error('Could not copy to the clipboard (' + command + ').');
}

function readClipboard() {
  const result = process.platform === 'win32'
    ? spawnSync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard -Raw'], { encoding: 'utf8' })
    : spawnSync(process.platform === 'darwin' ? 'pbpaste' : 'xclip', process.platform === 'darwin' ? [] : ['-selection', 'clipboard', '-o'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Could not read the clipboard.');
  return result.stdout;
}

// Raw bytes straight from gcloud's stdout - never through a PowerShell pipe, which would
// re-encode the value and append a newline.
// `version` is already validated as digits or "latest", so the one-string command (needed to
// reach gcloud.cmd through the shell on Windows) contains nothing caller-controlled beyond that.
function accessSecretVersion(version) {
  if (!/^(\d+|latest)$/.test(version)) throw new Error('Invalid secret version.');
  const command = 'gcloud secrets versions access ' + version + ' --secret=' + SECRET_NAME + ' --project=' + PROJECT;
  const result = spawnSync(command, { shell: true, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error('gcloud could not read ' + SECRET_NAME + ' version ' + version + ' (are you signed in as the owner?).');
  return result.stdout.toString('utf8');
}

function readSecretFile(file) {
  if (!fs.existsSync(file)) throw new Error('No rotation secret yet. Run this tool with "new" first.');
  return fs.readFileSync(file, 'utf8');
}

function run(argv, options) {
  const opts = options || {};
  const file = opts.file || secretPath();
  const mode = argv[0];

  if (mode === 'new') {
    if (fs.existsSync(file)) {
      throw new Error('A rotation secret already exists at ' + file + ' (fingerprint ' + fingerprint(readSecretFile(file)) +
        '). Finish or abandon that rotation and delete the file first; it was not replaced.');
    }
    const value = (opts.randomBytes || crypto.randomBytes)(32).toString('base64url');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value, { mode: 0o600, flag: 'wx' });
    return 'Created the new secret at ' + file + ' (fingerprint ' + fingerprint(value) + '). It was not printed.';
  }

  if (mode === 'copy') {
    const value = readSecretFile(file);
    (opts.copy || copyToClipboard)(value);
    return 'Copied the new secret (fingerprint ' + fingerprint(value) + ') to the clipboard. Paste it, then clear the clipboard.';
  }

  if (mode === 'verify') {
    const version = argv[1];
    if (!/^(\d+|latest)$/.test(version || '')) throw new Error('Usage: verify <version number|latest>');
    const local = readSecretFile(file);
    const remote = (opts.accessSecretVersion || accessSecretVersion)(version);
    const lines = [SECRET_NAME + ' version ' + version + ': ' + (remote === local ? 'MATCHES' : 'DIFFERS FROM') +
      ' the rotation file (file ' + fingerprint(local) + ', Secret Manager ' + fingerprint(remote) + ').'];
    if (remote !== remote.trim()) lines.push('WARNING: the Secret Manager value has surrounding whitespace; the worker will refuse to start with it.');
    return lines.join('\n');
  }

  if (mode === 'check-clipboard') {
    // Proves what the production MEDIA_WORKER_JOB_SUBMIT_SECRET property holds without any
    // Apps Script code: copy it out of Project Settings, then run this. With no version it is
    // compared with the rotation file (after pasting the new value); with a version (e.g. 1,
    // before starting) it is compared with that Secret Manager version instead.
    // Get-Clipboard -Raw can add a trailing line break of its own, so only that is ignored.
    const version = argv[1];
    if (version !== undefined && !/^(\d+|latest)$/.test(version)) throw new Error('Usage: check-clipboard [version number|latest]');
    const expected = version === undefined ? readSecretFile(file) : (opts.accessSecretVersion || accessSecretVersion)(version);
    const label = version === undefined ? 'the rotation file (file ' : SECRET_NAME + ' version ' + version + ' (Secret Manager ';
    const pasted = String((opts.readClipboard || readClipboard)() || '').replace(/\r?\n$/, '');
    const lines = ['Clipboard ' + (pasted === expected ? 'MATCHES' : 'DIFFERS FROM') + ' ' + label + fingerprint(expected) +
      ', clipboard ' + fingerprint(pasted) + '). Clear the clipboard now.'];
    if (pasted !== pasted.trim()) lines.push('WARNING: the copied value has surrounding whitespace; re-paste the property without it.');
    return lines.join('\n');
  }

  throw new Error('Usage: job-submit-secret-rotation.cjs new | copy | verify <version> | check-clipboard [version]');
}

module.exports = { run, fingerprint, secretPath };

if (require.main === module) {
  try {
    console.log(run(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
