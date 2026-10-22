'use strict';
// tools/staging/prepare-staging-push.cjs must never produce a folder bound to production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepare, Refused } = require('../tools/staging/prepare-staging-push.cjs');
const root = path.resolve(__dirname, '..');
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }

const PRODUCTION_ID = JSON.parse(fs.readFileSync(path.join(root, '.clasp.json'), 'utf8')).scriptId;
const STAGING_ID = '1StagingScriptIdForTestsOnly_abcdefghijklmnopqrstuvwxyz012';
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'savannah-push-test-'));
const out = path.join(scratch, 'push');

test('refuses the production script ID from the repository .clasp.json', () => {
  assert.throws(() => prepare(PRODUCTION_ID, { out }), e => e instanceof Refused && /PRODUCTION/.test(e.message));
  assert.equal(fs.existsSync(out), false, 'Nothing may be written when refused.');
});

test('refuses empty or malformed IDs', () => {
  for (const id of ['', 'abc', 'https://script.google.com/home/projects/x/edit', 'has spaces in it that are not allowed in ids at all']) {
    assert.throws(() => prepare(id, { out }), Refused, JSON.stringify(id));
  }
});

test('produces a folder bound to the STAGING ID with exactly the clasp-pushed files', () => {
  const result = prepare(STAGING_ID, { out });
  const clasp = JSON.parse(fs.readFileSync(path.join(out, '.clasp.json'), 'utf8'));
  assert.equal(clasp.scriptId, STAGING_ID);
  assert.notEqual(clasp.scriptId, PRODUCTION_ID);
  const files = result.files;
  for (const required of ['Main.js', 'appsscript.json', 'App/ProductionController.js', 'Utils/EnvironmentGuard.js',
    'Production/StagingVerification_Service.js', 'Frontend/Index.html']) {
    assert.ok(files.includes(required), 'missing ' + required);
    assert.ok(fs.existsSync(path.join(out, required)), 'not copied: ' + required);
  }
  for (const file of files) {
    assert.doesNotMatch(file, /^(node-tests|media-worker|CallbackBridge|tools|\.git|\.claude)\//, 'must not push ' + file);
    assert.match(file, /\.(js|gs|html|json)$/);
  }
  assert.ok(fs.existsSync(path.join(out, '.claspignore')));
});

test('re-running replaces only its own folder, and never deletes a folder it did not create', () => {
  prepare(STAGING_ID, { out });
  const foreign = path.join(scratch, 'foreign');
  fs.mkdirSync(foreign);
  fs.writeFileSync(path.join(foreign, 'important.txt'), 'keep');
  assert.throws(() => prepare(STAGING_ID, { out: foreign }), /not created by this tool/);
  assert.equal(fs.readFileSync(path.join(foreign, 'important.txt'), 'utf8'), 'keep');
});

test('the staging manifest can only reach its own spreadsheet: no YouTube, Drive or external requests', () => {
  prepare(STAGING_ID, { out });
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'appsscript.json'), 'utf8'));
  assert.deepEqual(manifest.oauthScopes, ['https://www.googleapis.com/auth/spreadsheets.currentonly']);
  const services = (manifest.dependencies && manifest.dependencies.enabledAdvancedServices) || [];
  assert.equal(services.some(s => /youtube/i.test(s.serviceId + s.userSymbol)), false, 'YouTube service must be removed');
  const production = JSON.parse(fs.readFileSync(path.join(root, 'appsscript.json'), 'utf8'));
  assert.ok(production.oauthScopes.some(s => /youtube/.test(s)), 'the repository manifest itself must stay unchanged');
});

test('the printed push command only pushes after moving into the staging folder, with a pinned clasp', () => {
  const { pushCommand, CLASP_VERSION } = require('../tools/staging/prepare-staging-push.cjs');
  const command = pushCommand('C:\\Temp\\savannah-staging-push');
  assert.equal(command, 'Set-Location "C:\\Temp\\savannah-staging-push"; if ($?) { npx --yes @google/clasp@' + CLASP_VERSION + ' push --force }');
  assert.match(CLASP_VERSION, /^\d+\.\d+\.\d+$/, 'clasp must be pinned to an exact version');
});

fs.rmSync(scratch, { recursive: true, force: true });
console.log(`Staging push tool: ${passed}/${passed} passed.`);
