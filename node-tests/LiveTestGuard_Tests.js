'use strict';
// In-app tests that spend money or write real rows must refuse unless the owner
// deliberately sets SAVANNAH_ALLOW_LIVE_TESTS=true.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }

const GUARDED = {
  'AI/AI_AIService.js': 'testAIServiceLiveConnection',
  'Ideas/Idea_Engine.js': 'testIdeaGenerationWithTracking',
  'Scripts/Script_Engine.js': 'testScriptEngineLiveWorkflow',
  'Scripts/Scripts_Repository.js': 'testScriptsRepositoryUpdate',
  'Services/Services_Logging.js': 'testLoggingService'
};

function guard(value) {
  const context = vm.createContext({ PropertiesService: { getScriptProperties: () => ({
    getProperty: name => (name === 'SAVANNAH_ALLOW_LIVE_TESTS' ? value : null) }) } });
  vm.runInContext(fs.readFileSync(path.join(root, 'Utils/LiveTestGuard.js'), 'utf8'), context);
  return () => vm.runInContext('assertLiveTestAllowed_("testExample")', context);
}

test('guard refuses unless the property is exactly "true"', () => {
  for (const value of [null, '', 'false', 'TRUE', 'yes', '1']) {
    assert.throws(guard(value), /Refused: testExample .*SAVANNAH_ALLOW_LIVE_TESTS = true/, String(value));
  }
  guard('true')();
});

test('every live or row-writing in-app test calls the guard as its first statement', () => {
  for (const [file, name] of Object.entries(GUARDED)) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const match = new RegExp('function ' + name + '\\(\\)\\s*\\{\\s*([^\\n]*)').exec(source);
    assert.ok(match, name + ' not found in ' + file);
    assert.equal(match[1].trim(), 'assertLiveTestAllowed_("' + name + '");', name + ' does not start with the guard');
  }
});

test('a guarded test is refused before it reaches any provider or sheet', () => {
  const calls = [];
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    generateIdeasWorkflow: () => { calls.push('generate'); return { success: true, savedCount: 1 }; },
    Logger: { log() {} }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'Utils/LiveTestGuard.js'), 'utf8'), context);
  const source = fs.readFileSync(path.join(root, 'Ideas/Idea_Engine.js'), 'utf8');
  const start = source.indexOf('function testIdeaGenerationWithTracking()');
  const body = source.slice(start, source.indexOf('\n}', start) + 2);
  vm.runInContext(body, context);
  assert.throws(() => vm.runInContext('testIdeaGenerationWithTracking()', context), /Refused/);
  assert.deepEqual(calls, [], 'The paid workflow ran despite the guard.');
});

console.log(`Live test guard: ${passed}/${passed} passed.`);
