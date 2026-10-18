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
      if (entry.name.startsWith('.') || entry.name === 'node_modules') return [];
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
const context = vm.createContext({ Utilities: { getUuid: randomUUID } });
const dependencies = [
  'Config.js',
  'Models/RenderJob.js',
  'Production/ProductionTask_Repository.js',
  'Production/ProductionQueue_Service.js',
  'Production/RenderQuality_Service.js',
  'Production/ProductionError_Service.js',
  'Production/PublishingSchedule_Service.js',
  'Tests/ProductionHardening_Tests.js'
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

require('./upload-recovery.cjs');
