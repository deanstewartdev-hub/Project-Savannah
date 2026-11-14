/****************************************************
 * Project Savannah - frontend application structure (refactoring safety net)
 *
 * The browser application object, SavannahApp, was defined in one 4,215-line script. This suite
 * proves that splitting it across several script files leaves the object identical:
 *   - the same sections and members, in the same order;
 *   - every function's source unchanged (compared by hash, ignoring indentation only);
 *   - every non-function value unchanged;
 *   - the same page-start listeners registered.
 *
 * It reads Frontend/Index.html to find the script files the page always loads, in the order the
 * page loads them, evaluates them against an inert document, and compares the result with
 * node-tests/fixtures/frontend-app-structure.json, captured before the split. No browser, no
 * server call.
 *
 * Run with: node node-tests/FrontendAppStructure_Tests.js
 * Regenerate (deliberately, never to make a failure pass): add --update
 ****************************************************/
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'frontend-app-structure.json');

// Script files Index.html includes unconditionally, in page order.
function alwaysLoadedScripts() {
  const index = fs.readFileSync(path.join(root, 'Frontend/Index.html'), 'utf8');
  const files = [];
  let depth = 0;
  const token = /<\?\s*if\b[^?]*\?>|<\?\s*\}\s*\?>|includeFrontend\(\s*"([^"]+)"/g;
  let match;
  while ((match = token.exec(index))) {
    if (/^<\?\s*if/.test(match[0])) depth += 1;
    else if (/^<\?\s*\}/.test(match[0])) depth -= 1;
    else if (depth === 0 && /^Frontend\/Assets\/Scripts\//.test(match[1])) files.push(match[1] + '.html');
  }
  return files;
}

function inert(name) {
  return new Proxy(function () {}, {
    get: (_t, prop) => (prop === Symbol.toPrimitive ? () => '' : prop === 'then' ? undefined : inert(name + '.' + String(prop))),
    apply: () => inert(name + '()'),
    construct: () => inert('new ' + name)
  });
}

function loadApp(files) {
  const listeners = [];
  const document = {
    addEventListener: type => { listeners.push(String(type)); },
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => inert('element'),
    body: inert('body'),
    documentElement: inert('documentElement')
  };
  const sandbox = { document, console, setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    google: inert('google'), localStorage: inert('localStorage'), navigator: inert('navigator'), location: inert('location') };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (/application\/json/i.test(match[1]) || !match[2].trim()) continue;
      vm.runInContext(match[2], context, { filename: file, timeout: 10000 });
    }
  }
  return { context, listeners };
}

// Indentation is the only thing a move between files may change.
const normaliseSource = source => source.split(/\r?\n/).map(line => line.trim()).join('\n');

function describe(value, seen) {
  if (typeof value === 'function') {
    const source = normaliseSource(Function.prototype.toString.call(value));
    return { function: createHash('sha256').update(source).digest('hex').slice(0, 24), parameters: value.length, lines: source.split('\n').length };
  }
  if (Array.isArray(value)) return value.map(item => describe(item, seen));
  if (value && typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    const out = {};
    for (const key of Object.keys(value)) out[key] = describe(value[key], seen);
    return out;
  }
  return value === undefined ? '[undefined]' : value;
}

function currentStructure() {
  const files = alwaysLoadedScripts();
  const { context, listeners } = loadApp(files);
  const app = vm.runInContext('typeof SavannahApp === "undefined" ? null : SavannahApp', context);
  if (!app) throw new Error('SavannahApp is not defined after loading: ' + files.join(', '));
  return { files, structure: { listeners, app: JSON.parse(JSON.stringify(describe(app, new Set()))) } };
}

function flatten(node, prefix, out) {
  if (node && typeof node === 'object' && !Array.isArray(node) && !('function' in node && 'parameters' in node)) {
    out.push([prefix + ' {keys}', Object.keys(node).join(',')]);
    for (const key of Object.keys(node)) flatten(node[key], prefix ? prefix + '.' + key : key, out);
  } else {
    out.push([prefix, JSON.stringify(node)]);
  }
  return out;
}

const { files, structure } = currentStructure();
if (process.argv.includes('--update')) {
  fs.writeFileSync(FIXTURE, JSON.stringify(structure, null, 1) + '\n');
  console.log('Wrote frontend-app-structure.json from ' + files.join(', '));
} else {
  const expected = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const want = new Map(flatten(expected, '', []));
  const got = new Map(flatten(structure, '', []));
  const problems = [];
  for (const [key, value] of want) {
    if (!got.has(key)) problems.push('missing: ' + key);
    else if (got.get(key) !== value) problems.push('changed: ' + key);
  }
  for (const key of got.keys()) if (!want.has(key)) problems.push('added: ' + key);
  const checks = [
    ['every always-loaded script file exists', files.every(file => fs.existsSync(path.join(root, file))) ? '' : 'a file named in Index.html is missing'],
    ['SavannahApp has the same sections, members and order', problems.filter(p => /\{keys\}/.test(p)).slice(0, 8).join('; ')],
    ['every function and value is unchanged', problems.filter(p => !/\{keys\}/.test(p)).slice(0, 8).join('; ')]
  ];
  let failed = 0;
  for (const [name, problem] of checks) {
    if (problem) { failed += 1; console.log('FAIL ' + name + ' - ' + problem); } else console.log('PASS ' + name);
  }
  const functions = [...got.values()].filter(v => /"function"/.test(v)).length;
  console.log('Frontend app structure: ' + (checks.length - failed) + '/' + checks.length + ' passed (' + functions + ' functions across ' + files.length + ' files).');
  if (failed) process.exitCode = 1;
}
