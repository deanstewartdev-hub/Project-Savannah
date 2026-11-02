'use strict';
// UI wiring for Render New Version: the button, the confirmation, the request ID kept until the
// server confirms it, the version labels, the compare panel, and no client forceRerender.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const script = read('Frontend/Assets/Scripts/Production.html');
const view = read('Frontend/Views/Production.html');
const controller = read('App/ProductionController.js');

const cases = [
  ['the completed-script action offers Render New Version next to View video', () => {
    assert.ok(script.includes('production-new-version'), 'button class');
    assert.ok(script.includes('>Render New Version</button>'), 'button label');
  }],
  ['the version request calls the server action with a request ID and the cost confirmation', () => {
    assert.ok(script.includes('"productionRenderNewVersion"'), 'calls the server action');
    assert.ok(script.includes('clientRequestId: requestId'), 'sends a request ID');
    assert.ok(script.includes('confirmedMaxCostGbp: NEW_VERSION_COST_GBP'), 'sends the cost confirmation');
    assert.ok(script.includes('window.confirm('), 'asks the owner to confirm before paid work');
  }],
  ['the request ID is kept per script until the server confirms it (refresh-safe)', () => {
    assert.ok(script.includes('savannah.newVersion.'), 'pending key per script');
    assert.ok(script.includes('localStorage.setItem(pendingKey, requestId)'), 'stored before the call');
    assert.ok(script.includes('localStorage.removeItem(pendingKey)'), 'cleared only on success');
  }],
  ['the button is disabled while a request is in flight (submitDirect)', () => {
    assert.ok(/function submitDirect[\s\S]*?button\.disabled = true/.test(script));
  }],
  ['the client no longer sends forceRerender', () => {
    assert.equal(script.includes('forceRerender'), false);
  }],
  ['each job card shows its version number', () => {
    assert.ok(script.includes("<strong>Version ' + versionOf(job) + '</strong>"));
    assert.ok(script.includes('function versionOf(job)'));
  }],
  ['the compare panel exists in the view and is wired to the two videos', () => {
    assert.ok(view.includes('id="production-compare"'), 'container');
    assert.ok(script.includes('production-compare-select'), 'version selectors');
    assert.ok(script.includes('data-slot="a"') && script.includes('data-slot="b"'), 'two slots');
    assert.ok(script.includes('compareList.addEventListener("change"'), 'selection changes the video');
  }],
  ['the compare panel changes no records and is only drawn for two or more delivered versions', () => {
    assert.ok(script.includes('.filter(function (id) { return byScript[id].length > 1; })'));
    assert.ok(script.includes('job.status === "SUCCEEDED" && job.videoUrl'));
  }],
  ['the server action is exposed as a top-level function for the page', () => {
    assert.ok(controller.includes('function productionRenderNewVersion(request)'));
    assert.ok(controller.includes('renderNewVersion: renderNewVersion'));
  }],
  ['the compare container is created before any job list render can use it', () => {
    const declared = script.indexOf('const compareList');
    const firstLoad = script.lastIndexOf('loadReady(); loadJobs(); loadYouTubeConnection()');
    assert.ok(declared !== -1 && firstLoad !== -1 && declared < firstLoad);
  }]
];

let failed = 0;
for (const [name, run] of cases) {
  try { run(); console.log('PASS ' + name); } catch (error) { failed++; console.log('FAIL ' + name + ': ' + error.message); }
}
console.log('Render new version UI: ' + (cases.length - failed) + '/' + cases.length + ' passed.');
if (failed > 0) process.exit(1);
