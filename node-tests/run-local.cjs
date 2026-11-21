#!/usr/bin/env node
'use strict';

// Local-only runner: .cjs files are excluded by the project's clasp extensions.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => {
      if (entry.name.startsWith('.') || ['node_modules', 'media-worker', 'CallbackBridge', 'node-tests'].includes(entry.name)) return [];
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) return files(filename);
      return entry.isFile() ? [filename] : [];
    });
}

let serverFiles = 0;
let frontendScripts = 0;
let dataScripts = 0;
for (const filename of files(root)) {
  if (!/\.(js|gs|html)$/.test(filename)) continue;
  const source = fs.readFileSync(filename, 'utf8');
  const relative = path.relative(root, filename);
  if (/\.(js|gs)$/.test(filename)) {
    new vm.Script(source, { filename: relative });
    serverFiles++;
    continue;
  }
  for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    // Apps Script renders this JSON data template; it is not browser code.
    if (/\btype\s*=\s*(["'])application\/json\1/i.test(match[1])) {
      dataScripts++;
      continue;
    }
    if (!match[2].trim()) continue;
    new vm.Script(match[2], { filename: relative });
    frontendScripts++;
  }
}
if (!serverFiles || !frontendScripts) throw new Error('Expected application sources were not found.');
console.log(`Syntax passed: ${serverFiles} server files, ${frontendScripts} frontend scripts; ${dataScripts} JSON data block excluded.`);

// No Google or provider clients are supplied. Unexpected service access fails.
const context = vm.createContext({
  Utilities: { getUuid: randomUUID },
  UrlFetchApp: { fetch() { throw new Error('Network access is forbidden in local fixtures.'); } }
});
const dependencies = [
  'Config.js',
  'Models/RenderJob.js',
  'Models/Script.js',
  'Production/ProductionTask_Repository.js',
  'Production/ProductionQueue_Service.js',
  'Production/RenderQuality_Service.js',
  'Production/ProductionError_Service.js',
  'Production/PublishingSchedule_Service.js',
  'Services/Services_Notifications.js',
  'Production/VideoProcessingProvider.js',
  'Scripts/Script_Validator.js',
  'Scripts/Script_Engine.js',
  'Production/ScenePlan_Service.js',
  'AI/ProptLibrary/Script_PromptLibrary.js',
  'Tests/ProductionHardening_Tests.js',
  'Tests/CloudRunReconciliation_Tests.js',
  'Tests/ScriptDurationValidation_Tests.js',
  'Tests/PromptAlignment_Tests.js',
  'Tests/ScriptEngineOptionsResolution_Tests.js'
];
for (const filename of dependencies) {
  vm.runInContext(fs.readFileSync(path.join(root, filename), 'utf8'), context, {
    filename, timeout: 10000
  });
}
const result = vm.runInContext('runProductionHardeningTests()', context, { timeout: 10000 });
if (!result || !result.passed || !Array.isArray(result.results) ||
    !result.results.length || result.total !== result.results.length ||
    result.results.some(test => test.passed !== true)) {
  throw new Error('Production hardening suite did not report a complete passing run.');
}
for (const test of result.results) console.log(`PASS ${test.name}`);
console.log(`Production hardening: ${result.total}/${result.total} passed.`);

for (const suite of ['runCloudRunReconciliationTests', 'runScriptDurationValidationTests', 'runPromptAlignmentTests', 'runScriptEngineOptionsResolutionTests']) {
  const result = vm.runInContext(suite + '()', context, { timeout: 10000 });
  if (!result.passed || !result.total || result.results.length !== result.total || result.results.some(test => !test.passed)) throw new Error(suite + ' did not pass');
  console.log(`${suite}: ${result.total}/${result.total} passed.`);
}
require('./upload-recovery.cjs');
const { execFileSync } = require('node:child_process');
for (const filename of fs.readdirSync(__dirname).filter(name => name.endsWith('_Tests.js')).sort()) {
  execFileSync(process.execPath, [path.join(__dirname, filename)], { cwd: root, stdio: 'inherit' });
}
