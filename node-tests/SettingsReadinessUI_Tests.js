'use strict';
// Settings → Release readiness card: executes the REAL Settings page script
// against a minimal fake DOM and a scripted google.script.run.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }

const view = fs.readFileSync(path.join(root, 'Frontend/Views/Settings.html'), 'utf8');
const script = /<script>([\s\S]*)<\/script>/.exec(fs.readFileSync(path.join(root, 'Frontend/Assets/Scripts/Settings.html'), 'utf8'))[1];

function element(id) {
  return {
    id, value: '', disabled: false, children: [], listeners: {}, _text: '',
    get textContent() { return this._text + this.children.map(c => c.textContent).join('\n'); },
    set textContent(v) { this._text = String(v); this.children = []; },
    set innerHTML(v) { throw new Error('innerHTML must not be used for readiness output: ' + v); },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    appendChild(child) { this.children.push(child); },
    querySelector() { return element('button'); }
  };
}

function page(serverResponse) {
  const elements = {};
  const calls = [];
  const document = {
    getElementById: id => (elements[id] = elements[id] || element(id)),
    createElement: () => element('li')
  };
  const run = {};
  const chain = { success: null, failure: null };
  run.withSuccessHandler = fn => { chain.success = fn; return run; };
  run.withFailureHandler = fn => { chain.failure = fn; return run; };
  for (const name of ['settingsGetIntegrations', 'settingsSaveCreatomate', 'settingsSaveProductionBranding', 'settingsGetReleaseReadiness']) {
    run[name] = arg => {
      calls.push(name);
      const success = chain.success, failure = chain.failure;
      chain.success = chain.failure = null;
      if (name !== 'settingsGetReleaseReadiness') return;
      if (serverResponse === 'throw') failure && failure(new Error('server down'));
      else success && success(serverResponse);
    };
  }
  vm.runInNewContext(script, { document, google: { script: { run } } });
  return { elements, calls };
}

test('Settings view contains the readiness card elements the script expects', () => {
  for (const id of ['release-readiness-card', 'release-readiness-run', 'release-readiness-status', 'release-readiness-checks']) {
    assert.ok(view.includes('id="' + id + '"'), 'Missing #' + id);
  }
});

test('readiness check does not run until the owner clicks', () => {
  const p = page({ success: true, data: { status: 'READY', checks: [] } });
  assert.equal(p.calls.includes('settingsGetReleaseReadiness'), false);
});

test('BLOCKED report renders each check with its level, as text', () => {
  const p = page({ success: true, data: { status: 'BLOCKED', checks: [
    { id: 'callback-url', level: 'block', message: 'Callbacks target this main app.' },
    { id: 'spreadsheet', level: 'ok', message: '<img src=x onerror=alert(1)>' }
  ] } });
  p.elements['release-readiness-run'].listeners.click();
  assert.equal(p.calls.includes('settingsGetReleaseReadiness'), true);
  assert.match(p.elements['release-readiness-status'].textContent, /^Blocked/);
  const list = p.elements['release-readiness-checks'];
  assert.equal(list.children.length, 2);
  assert.equal(list.children[0].textContent, '[BLOCK] Callbacks target this main app.');
  assert.equal(list.children[1].textContent, '[OK] <img src=x onerror=alert(1)>', 'Markup must stay inert text.');
  assert.equal(p.elements['release-readiness-run'].disabled, false);
});

test('server error and transport failure show a message and re-enable the button', () => {
  const failed = page({ success: false, error: { message: 'Callback inbox could not be read.' } });
  failed.elements['release-readiness-run'].listeners.click();
  assert.equal(failed.elements['release-readiness-status'].textContent, 'Callback inbox could not be read.');
  const down = page('throw');
  down.elements['release-readiness-run'].listeners.click();
  assert.equal(down.elements['release-readiness-status'].textContent, 'Readiness check failed.');
  assert.equal(down.elements['release-readiness-run'].disabled, false);
});

test('server entry point exists and wraps the read-only service', () => {
  const source = fs.readFileSync(path.join(root, 'App/SettingsController.js'), 'utf8');
  assert.match(source, /function settingsGetReleaseReadiness\(\)\s*\{[\s\S]*ReleaseReadinessService\.run\(\)/);
});

console.log(`Settings readiness UI: ${passed}/${passed} passed.`);
