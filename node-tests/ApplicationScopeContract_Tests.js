/****************************************************
 * Project Savannah - application global-scope contract (refactoring safety net)
 *
 * Apps Script runs every pushed server file in one shared global scope. Splitting a file is
 * therefore only behaviour-preserving if (a) every public name still exists with the same shape,
 * (b) no name is declared twice, and (c) nothing depends on the order files happen to load in.
 *
 * This suite proves all three offline, with inert stand-ins for the Google services:
 *   1. every file loads in push order with no load-time failure;
 *   2. every global in node-tests/fixtures/public-interface.json (captured BEFORE the refactor)
 *      still exists, with the same type and - for objects - at least the same public members;
 *   3. no top-level name is declared in two files;
 *   4. loading the files in REVERSE order exposes exactly the same interface (order independence).
 *
 * Additions are allowed (new helper modules); removals and reshaping are not. The fixture is only
 * regenerated deliberately: node node-tests/ApplicationScopeContract_Tests.js --update
 *
 * Run with: node node-tests/ApplicationScopeContract_Tests.js
 ****************************************************/
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pushedServerFiles, topLevelDeclarations, loadScope, describeGlobal, root } = require('./lib/appsScriptGlobalScope.cjs');

const FIXTURE = path.join(__dirname, 'fixtures', 'public-interface.json');

function interfaceOf(files) {
  const { context, failures } = loadScope(files);
  const names = new Set();
  for (const file of files) {
    for (const d of topLevelDeclarations(fs.readFileSync(path.join(root, file), 'utf8'))) names.add(d.name);
  }
  const shape = {};
  for (const name of [...names].sort()) {
    const d = describeGlobal(context, name);
    if (d) shape[name] = JSON.parse(JSON.stringify(d));
  }
  return { shape, failures };
}

function runApplicationScopeContractTests() {
  const results = [];
  const test = (name, fn) => {
    try { fn(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: String(error && error.message || error) }); }
  };

  const files = pushedServerFiles();
  const forward = interfaceOf(files);
  const backward = interfaceOf([...files].reverse());

  if (process.argv.includes('--update')) {
    fs.writeFileSync(FIXTURE, JSON.stringify({ files: files.length, globals: forward.shape }, null, 1) + '\n');
    console.log(`Wrote ${FIXTURE} (${Object.keys(forward.shape).length} globals from ${files.length} files).`);
    return null;
  }

  test('pushed server files are discovered from .claspignore', () => {
    if (files.length < 60) throw new Error(`Only ${files.length} pushed server files found.`);
    for (const must of ['Main.js', 'Config.js', 'App/ProductionController.js', 'Scripts/Script_Engine.js']) {
      if (!files.includes(must)) throw new Error(`${must} is not in the pushed set.`);
    }
  });

  test('every file loads in push order with no load-time failure', () => {
    if (forward.failures.length) throw new Error(forward.failures.map(f => `${f.file}: ${f.error}`).join('; '));
  });

  test('every file loads in reverse order with no load-time failure', () => {
    if (backward.failures.length) throw new Error(backward.failures.map(f => `${f.file}: ${f.error}`).join('; '));
  });

  test('no top-level name is declared in two files', () => {
    const owner = new Map();
    const clashes = [];
    for (const file of files) {
      for (const d of topLevelDeclarations(fs.readFileSync(path.join(root, file), 'utf8'))) {
        if (owner.has(d.name) && owner.get(d.name) !== file) clashes.push(`${d.name} (${owner.get(d.name)} and ${file})`);
        else owner.set(d.name, file);
      }
    }
    if (clashes.length) throw new Error(clashes.join('; '));
  });

  test('push order and reverse order expose exactly the same interface', () => {
    const a = JSON.stringify(forward.shape);
    const b = JSON.stringify(backward.shape);
    if (a !== b) {
      const diff = Object.keys({ ...forward.shape, ...backward.shape })
        .filter(k => JSON.stringify(forward.shape[k]) !== JSON.stringify(backward.shape[k]));
      throw new Error('Load order changes the interface of: ' + diff.join(', '));
    }
  });

  const baseline = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).globals;
  test('no baseline global has been removed or changed type', () => {
    const problems = [];
    for (const [name, want] of Object.entries(baseline)) {
      const got = forward.shape[name];
      if (!got) problems.push(`${name} is missing`);
      else if (got.type !== want.type) problems.push(`${name} is now ${got.type}, was ${want.type}`);
    }
    if (problems.length) throw new Error(problems.join('; '));
  });

  test('no baseline object has lost a public member', () => {
    const problems = [];
    for (const [name, want] of Object.entries(baseline)) {
      const got = forward.shape[name];
      if (!got || !want.keys) continue;
      const missing = want.keys.filter(k => !(got.keys || []).includes(k));
      if (missing.length) problems.push(`${name} lost: ${missing.join(', ')}`);
    }
    if (problems.length) throw new Error(problems.join('; '));
  });

  const failed = results.filter(r => !r.passed);
  for (const r of results) console.log(`${r.passed ? 'PASS' : 'FAIL'} ${r.name}${r.passed ? '' : ' - ' + r.error}`);
  console.log(`Application scope contract: ${results.length - failed.length}/${results.length} passed ` +
    `(${Object.keys(forward.shape).length} globals, ${files.length} files).`);
  return { total: results.length, passed: failed.length === 0 };
}

const outcome = runApplicationScopeContractTests();
if (outcome && !outcome.passed) process.exitCode = 1;
