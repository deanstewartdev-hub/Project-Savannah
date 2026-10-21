'use strict';
// Production fingerprint: read-only, stable, sensitive to row changes, never exposes values.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }

function spreadsheet(tabs) {
  const writes = [];
  return {
    writes,
    getId: () => 'PROD-SHEET',
    getSheets: () => Object.entries(tabs).map(([name, rows]) => ({
      getName: () => name, getLastRow: () => rows.length,
      getRange: (r, c) => ({ getValue: () => rows[r - 1][c - 1], setValue: () => writes.push(name), setValues: () => writes.push(name) })
    }))
  };
}
const context = vm.createContext({
  Logger: { log() {} },
  Utilities: { DigestAlgorithm: { SHA_256: 'sha256' },
    computeDigest: (alg, text) => Array.from(crypto.createHash('sha256').update(text).digest()).map(b => (b > 127 ? b - 256 : b)) }
});
vm.runInContext(fs.readFileSync(path.join(root, 'Production/ProductionFingerprint_Service.js'), 'utf8'), context);
function reading(tabs, props) {
  context.__ss = spreadsheet(tabs);
  context.PropertiesService = { getScriptProperties: () => ({ getProperties: () => props || { OPENAI_API_KEY: 'sk-secret-value' } }) };
  vm.runInContext('SpreadsheetApp = { getActiveSpreadsheet: () => __ss }', context);
  const out = JSON.parse(JSON.stringify(vm.runInContext('diagnoseProductionFingerprint()', context)));
  return { out, writes: context.__ss.writes };
}
const BASE = { 'Render Jobs': [['Job ID'], ['RND-1'], ['RND-2']], Scripts: [['Script ID'], ['SCR-1']] };

test('same state gives the same 12-character code; nothing is written', () => {
  const a = reading(BASE), b = reading(BASE);
  assert.match(a.out.fingerprint, /^[0-9A-F]{12}$/);
  assert.equal(a.out.fingerprint, b.out.fingerprint);
  assert.deepEqual(a.writes, []);
});

test('an added row, a new tab or a new script property changes the code', () => {
  const base = reading(BASE).out.fingerprint;
  assert.notEqual(reading(Object.assign({}, BASE, { 'Render Jobs': BASE['Render Jobs'].concat([['RND-STG1-1']]) })).out.fingerprint, base);
  assert.notEqual(reading(Object.assign({}, BASE, { 'Render Callback Inbox': [['Receipt ID']] })).out.fingerprint, base);
  assert.notEqual(reading(BASE, { OPENAI_API_KEY: 'x', SAVANNAH_ENVIRONMENT: 'staging' }).out.fingerprint, base);
});

test('script property values never appear in the output; the staging marker is flagged', () => {
  const r = reading(BASE, { OPENAI_API_KEY: 'sk-secret-value', SAVANNAH_ENVIRONMENT: 'staging' });
  assert.equal(JSON.stringify(r.out).includes('sk-secret-value'), false);
  assert.equal(r.out.summary.stagingMarkerPresent, true);
  assert.equal(reading(BASE).out.summary.stagingMarkerPresent, false);
});

test('source performs no writes', () => {
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'Production/ProductionFingerprint_Service.js'), 'utf8'),
    /setValue|setProperty|deleteProperty|insertSheet|deleteSheet|appendRow|clear\(/);
});

console.log(`Production fingerprint: ${passed}/${passed} passed.`);
