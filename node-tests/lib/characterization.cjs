'use strict';

// Characterisation ("golden master") support for the modular refactor.
//
// A characterisation suite runs the REAL application code against in-memory stand-ins, records
// everything observable (return values, thrown errors, log lines, repository writes) for a fixed
// list of scenarios, and compares that record with a fixture captured BEFORE the code was moved.
// Time and random IDs are pinned inside the sandbox so the record is reproducible.
//
// Fixtures are written only with --update, and only on purpose: they are the "before" picture.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..', '..');

// Pins `new Date()` / `Date.now()` inside the sandbox; explicit dates still work normally.
const FIXED_CLOCK = `(function () {
  const RealDate = Date;
  const FIXED = RealDate.UTC(2026, 10, 14, 12, 0, 0);
  class FixedDate extends RealDate {
    constructor(...args) { if (args.length === 0) super(FIXED); else super(...args); }
    static now() { return FIXED; }
  }
  globalThis.Date = FixedDate;
})();`;

function createSandbox(stubs) {
  let uuidCounter = 0;
  const journal = [];
  const base = {
    Utilities: {
      getUuid: () => {
        uuidCounter += 1;
        return String(uuidCounter).padStart(8, '0') + '-0000-4000-8000-000000000000';
      },
      sleep() {}
    },
    Logger: { log: line => { journal.push({ log: String(line) }); } },
    SpreadsheetApp: { flush: () => { journal.push({ flush: true }); } }
  };
  const context = vm.createContext(Object.assign(base, stubs || {}));
  vm.runInContext(FIXED_CLOCK, context);
  return {
    context,
    journal,
    load(files) {
      for (const file of files) {
        vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file, timeout: 10000 });
      }
    },
    // Evaluates an expression in the sandbox and returns a plain JSON record of what happened.
    observe(expression) {
      const mark = journal.length;
      let outcome;
      try {
        const json = vm.runInContext(
          '(function () { var v = (' + expression + '); return v === undefined ? "__undefined__" : JSON.stringify(v); })()',
          context, { timeout: 10000 }
        );
        outcome = { returned: json === '__undefined__' ? '__undefined__' : JSON.parse(json) };
      } catch (error) {
        outcome = { threw: { name: String(error && error.name), message: String(error && error.message) } };
      }
      const effects = journal.slice(mark);
      if (effects.length) outcome.effects = JSON.parse(JSON.stringify(effects));
      return outcome;
    }
  };
}

// Replaces very long strings (whole prompts) with their length, SHA-256 and opening text, so a
// fixture stays reviewable while any change to the string is still detected.
function compactLongStrings(value, limit) {
  if (typeof value === 'string') {
    if (value.length <= limit) return value;
    return { longString: true, length: value.length, sha256: createHash('sha256').update(value).digest('hex'), opening: value.slice(0, 160) };
  }
  if (Array.isArray(value)) return value.map(item => compactLongStrings(item, limit));
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = compactLongStrings(value[key], limit);
    return out;
  }
  return value;
}

// Compares `record` with the fixture, or writes the fixture when run with --update.
// Returns the process exit code.
function settle(suiteName, fixtureFile, record) {
  const fixture = path.join(root, 'node-tests', 'fixtures', fixtureFile);
  const names = Object.keys(record);
  if (process.argv.includes('--update')) {
    fs.writeFileSync(fixture, JSON.stringify(record, null, 1) + '\n');
    console.log('Wrote ' + fixtureFile + ' (' + names.length + ' scenarios).');
    return 0;
  }
  const expected = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  let failed = 0;
  const all = [...new Set([...Object.keys(expected), ...names])];
  for (const name of all) {
    const want = JSON.stringify(expected[name]);
    const got = JSON.stringify(record[name]);
    if (want === got) { console.log('PASS ' + name); continue; }
    failed += 1;
    console.log('FAIL ' + name);
    console.log('  expected: ' + (want === undefined ? '(scenario not in fixture)' : want.slice(0, 600)));
    console.log('  actual:   ' + (got === undefined ? '(scenario no longer produced)' : got.slice(0, 600)));
  }
  console.log(suiteName + ': ' + (all.length - failed) + '/' + all.length + ' passed.');
  return failed ? 1 : 0;
}

module.exports = { root, createSandbox, settle, compactLongStrings };
