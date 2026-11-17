/****************************************************
 * Project Savannah - hand-run self-tests, run automatically (pure ones only)
 *
 * The test... functions in Tests/*_SelfTests.js are meant to be run by hand from the Apps Script
 * editor, so nothing noticed when the validator started counting scene narration (commit
 * e9e417b, 15 August 2026) and the Rome fixture they share went stale: testScriptFormatterAll and
 * testScriptValidatorWithValidScript failed for three months. This suite runs the pure ones here,
 * offline, so a stale fixture fails CI instead.
 *
 * Only self-tests that touch no sheet, provider, network or property are listed. The ones guarded
 * by assertLiveTestAllowed_ are deliberately excluded.
 *
 * Run with: node node-tests/HandRunSelfTests_Tests.js
 ****************************************************/
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const inFolder = (folder, pattern) => fs.readdirSync(path.join(root, folder))
  .filter(name => pattern.test(name)).sort().map(name => folder + '/' + name);

const SOURCES = []
  .concat(inFolder('Scripts', /^Script_Validator.*\.js$/))
  .concat(inFolder('Scripts', /^Script_Formatter.*\.js$/))
  .concat(['Models/Script.js', 'Models/Approval.js'])
  .concat(['Tests/ScriptValidator_SelfTests.js', 'Tests/ScriptFormatter_SelfTests.js',
    'Tests/ScriptModel_SelfTests.js', 'Tests/ApprovalModel_SelfTests.js']);

const SELF_TESTS = [
  'testScriptValidatorWithValidScript',
  'testScriptValidatorRejectsInvalidScenes',
  'testScriptValidatorRejectsShortVoiceover',
  'testScriptValidatorRejectsWeakHook',
  'testScriptFormatterWithValidatedScript',
  'testScriptFormatterWithDirectScript',
  'testScriptFormatterDoesNotMutateSource',
  'testScriptFormatterRejectsInvalidInput',
  'testScriptFormatterAll',
  'testScriptModelAll',
  'testApprovalModelAll'
];

// Anything beyond pure logic fails loudly: no spreadsheet, network or property service is supplied.
const context = vm.createContext({ Utilities: { getUuid: randomUUID }, Logger: { log() {} } });
for (const file of SOURCES) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

let failed = 0;
for (const name of SELF_TESTS) {
  try {
    vm.runInContext(name + '()', context, { timeout: 10000 });
    console.log('PASS ' + name);
  } catch (error) {
    failed += 1;
    console.log('FAIL ' + name + ' - ' + String(error && error.message || error).replace(/\n/g, ' | ').slice(0, 300));
  }
}

// The validator counts scene narration, so the shared fixture must carry the narration in its scenes.
let metadata;
try {
  metadata = JSON.parse(vm.runInContext('JSON.stringify(ScriptValidator.validate(createValidScriptValidatorFixture_()).metadata)', context));
} catch (error) {
  metadata = { rejected: String(error && error.message || error).replace(/\n/g, ' | ') };
}
if (!(metadata.wordCount >= 100 && metadata.wordCount <= 120 && metadata.durationDifferenceSeconds === 0)) {
  failed += 1;
  console.log('FAIL shared Rome fixture sits in the preferred range with matching durations - ' + JSON.stringify(metadata));
} else {
  console.log('PASS shared Rome fixture sits in the preferred range with matching durations');
}

console.log('Hand-run self-tests (pure): ' + (SELF_TESTS.length + 1 - failed) + '/' + (SELF_TESTS.length + 1) + ' passed.');
if (failed) process.exitCode = 1;
