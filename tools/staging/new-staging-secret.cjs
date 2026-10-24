#!/usr/bin/env node
'use strict';
// Creates a STAGING-ONLY callback secret without ever printing it.
//
//   node tools/staging/new-staging-secret.cjs            create a new secret (refuses to overwrite)
//   node tools/staging/new-staging-secret.cjs --copy     copy the existing secret to the clipboard again
//   node tools/staging/new-staging-secret.cjs --replace  replace the existing secret with a new one
//
// The secret is copied to the clipboard (paste it into the staging bridge's and the staging
// main project's MEDIA_WORKER_SHARED_SECRET) and saved to a private file in your user folder,
// outside the repository. The staging sender reads it from there when you set
// SAVANNAH_STAGING_SECRET_FILE to that path. Delete the folder when staging is finished.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function secretPath(home) {
  return path.join(home || os.homedir(), '.savannah-staging', 'callback-secret');
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

// First 12 hex characters of the SHA-256: lets two copies be compared without revealing either.
function fingerprint(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function run(argv, options) {
  const opts = options || {};
  const file = opts.file || secretPath();
  const copy = opts.copy || copyToClipboard;
  const mode = argv.includes('--copy') ? 'copy' : argv.includes('--from-clipboard') ? 'import' :
    argv.includes('--replace') ? 'replace' : 'create';
  if (mode === 'import') {
    // Use the secret already configured in Apps Script: copy it there, then run this.
    const value = String((opts.readClipboard || readClipboard)() || '').trim();
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(value)) {
      throw new Error('The clipboard does not hold a secret-like value (32-128 letters/digits). Copy the MEDIA_WORKER_SHARED_SECRET value first.');
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value, { mode: 0o600 });
    return 'Saved the secret from the clipboard to ' + file + ' (fingerprint ' + fingerprint(value) + '). It was not printed.';
  }
  if (mode === 'copy') {
    if (!fs.existsSync(file)) throw new Error('No staging secret yet. Run this tool without --copy first.');
    copy(fs.readFileSync(file, 'utf8').trim());
    return 'The existing staging secret is on your clipboard again. It was not printed.';
  }
  if (mode === 'create' && fs.existsSync(file)) {
    throw new Error('A staging secret already exists at ' + file + '. Use --copy to copy it again, or --replace for a new one.');
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  copy(secret);
  return 'A new staging-only secret (64 characters) is on your clipboard and saved to ' + file + '. It was not printed.';
}

if (require.main === module) {
  try {
    console.log(run(process.argv.slice(2)));
  } catch (error) {
    console.error('REFUSED: ' + error.message);
    process.exit(2);
  }
}

module.exports = { run, secretPath, fingerprint };
