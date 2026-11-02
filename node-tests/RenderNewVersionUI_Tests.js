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
  ['the compare selectors default to different versions: oldest in A, newest in B', () => {
    assert.ok(script.includes("optionsFor(versions[0].id)"), 'slot A starts on the oldest');
    assert.ok(script.includes("optionsFor(newest.id)"), 'slot B starts on the newest');
    assert.ok(script.includes("(job.id === selectedId ? ' selected' : '')"), 'the default is marked selected');
  }],
  ['the two selectors cannot display the same version', () => {
    assert.ok(script.includes('if (other.value === select.value)'), 'duplicate check on change');
    assert.ok(script.includes('the other slot moved to a different version'), 'the user is told');
  }],
  ['the compare videos load only when played (preload none) and carry their own URL', () => {
    assert.equal((script.match(/preload="none" data-slot=/g) || []).length, 2, 'both compare videos');
    assert.equal(script.includes('<video controls playsinline preload="metadata"'), false, 'no eager metadata loading');
    assert.ok(script.includes('data-url="'), 'options carry the URL');
  }],
  ['starting one compare video pauses the other', () => {
    assert.ok(script.includes('compareList.addEventListener("play"'), 'play listener');
    assert.ok(script.includes('if (other !== video) other.pause();'), 'other video paused');
  }],
  ['the compare layout wraps for narrow (mobile) screens', () => {
    assert.ok(script.includes('display:flex;flex-wrap:wrap'), 'wrapping container');
    assert.ok(script.includes('max-width:260px'), 'videos capped in width');
  }],
  ['the compare panel is redrawn only when the set of versions changes', () => {
    assert.ok(script.includes('if (signature === compareSignature) return;'));
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
