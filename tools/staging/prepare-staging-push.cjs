#!/usr/bin/env node
'use strict';
// Builds a separate folder that clasp can push to the STAGING Apps Script project.
//
// Why: the repository's own .clasp.json points at the PRODUCTION script, so running
// "clasp push" in the repository folder would overwrite production. This tool copies
// exactly the files the repository's .claspignore would push into a new folder, binds
// that folder to the staging script ID you give it, and refuses the production ID.
// It never runs clasp and never contacts Google.
//
// Usage (Windows PowerShell or any shell):
//   node tools/staging/prepare-staging-push.cjs <STAGING_SCRIPT_ID>
// then follow the two commands it prints.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..', '..');
const MARKER = '.savannah-staging-push';
const SCRIPT_ID = /^[A-Za-z0-9_-]{40,80}$/;

class Refused extends Error {}

// Reads the "!" allow-list from .claspignore: top-level files and "dir/**" folders.
function allowList(repo) {
  const lines = fs.readFileSync(path.join(repo, '.claspignore'), 'utf8').split(/\r?\n/);
  const files = [], folders = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('!')) continue;
    const entry = line.slice(1);
    if (entry.endsWith('/**')) folders.push(entry.slice(0, -3));
    else files.push(entry);
  }
  return { files, folders };
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

// Same extensions clasp is configured to push (.clasp.json scriptExtensions/htmlExtensions).
const PUSHED = /\.(js|gs|html)$/;

function selectFiles(repo) {
  const { files, folders } = allowList(repo);
  const selected = files.filter(f => fs.existsSync(path.join(repo, f)));
  for (const folder of folders) {
    const base = path.join(repo, folder);
    if (!fs.existsSync(base)) continue;
    for (const full of walk(base)) {
      const relative = path.relative(repo, full).split(path.sep).join('/');
      if (PUSHED.test(relative)) selected.push(relative);
    }
  }
  return selected.sort();
}

function prepare(stagingScriptId, options) {
  const opts = options || {};
  const repo = opts.repo || REPO;
  const id = String(stagingScriptId || '').trim();
  if (!SCRIPT_ID.test(id)) {
    throw new Refused('That does not look like an Apps Script ID. In the STAGING spreadsheet open Extensions > ' +
      'Apps Script > Project Settings (gear icon) and copy "Script ID".');
  }
  const production = JSON.parse(fs.readFileSync(path.join(repo, '.clasp.json'), 'utf8')).scriptId;
  if (id === production) {
    throw new Refused('That is the PRODUCTION script ID (from this repository\'s .clasp.json). Use the STAGING project\'s Script ID.');
  }
  const out = opts.out || path.join(os.tmpdir(), 'savannah-staging-push');
  if (fs.existsSync(out)) {
    // Only ever delete a folder this tool created.
    if (!fs.existsSync(path.join(out, MARKER))) {
      throw new Refused(out + ' already exists and was not created by this tool. Remove it yourself or choose another location.');
    }
    fs.rmSync(out, { recursive: true, force: true });
  }
  fs.mkdirSync(out, { recursive: true });
  const files = selectFiles(repo);
  for (const relative of files) {
    const target = path.join(out, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repo, relative), target);
  }
  const clasp = JSON.parse(fs.readFileSync(path.join(repo, '.clasp.json'), 'utf8'));
  clasp.scriptId = id;
  clasp.rootDir = '';
  fs.writeFileSync(path.join(out, '.clasp.json'), JSON.stringify(clasp, null, 2));
  fs.copyFileSync(path.join(repo, '.claspignore'), path.join(out, '.claspignore'));
  fs.writeFileSync(path.join(out, MARKER), 'Staging push folder for script ' + id + '\n');
  return { out, files, scriptId: id };
}

if (require.main === module) {
  try {
    const result = prepare(process.argv[2]);
    console.log('Prepared ' + result.files.length + ' files for the STAGING project (script ID ending ...' + result.scriptId.slice(-6) + ').');
    console.log('\nNext, run these two commands:\n');
    console.log('  cd "' + result.out + '"');
    console.log('  npx @google/clasp push --force\n');
    console.log('Do NOT run clasp push in the repository folder: it is bound to production.');
  } catch (error) {
    if (error instanceof Refused) { console.error('REFUSED: ' + error.message); process.exit(2); }
    throw error;
  }
}

module.exports = { prepare, selectFiles, Refused };
