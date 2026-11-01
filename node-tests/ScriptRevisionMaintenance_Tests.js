'use strict';
// Regression tests for the one-time script revision: dry run writes nothing, apply backs up first and
// writes one version-incremented record with the same ID, refuses wrong records, and the revised text is
// validated and formatted by the real generator modules (only the repository and spreadsheet are mocked).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

const SCRIPT_ID = 'SCR-39e7d862-0000-4000-8000-000000000000';
const IDEA_ID = 'IDEA-C4EF1471';

function baseRecord(overrides) {
  return Object.assign({
    id: SCRIPT_ID, ideaId: IDEA_ID, title: 'The Mystery of Morocco\'s Blue City',
    hook: 'In Morocco\'s Rif Mountains, a whole town is painted blue, and nobody agrees why.',
    voiceoverScript: 'Original voiceover text.', scenes: [], callToAction: 'Tell me your theory in the comments.',
    estimatedDurationSeconds: 49, generationNotes: '', status: 'FORMATTED', version: 1,
    createdAt: '2026-10-30T19:58:00.000Z', updatedAt: '2026-10-30T19:58:00.000Z',
    promptVersion: 'manual', aiModel: 'gpt-4o-mini'
  }, overrides || {});
}

function harness(existing) {
  const writes = [];
  const backups = [];
  const sandbox = {
    console,
    ScriptsRepository: {
      getScriptsByIdeaId: (ideaId) => (existing && ideaId === existing.ideaId ? [JSON.parse(JSON.stringify(existing))] : []),
      getScriptById: (id) => (existing && id === existing.id ? JSON.parse(JSON.stringify(existing)) : null),
      updateScript: (script) => { writes.push(script); return { saved: true, updated: true, version: script.version }; }
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: () => null,
        insertSheet: () => ({
          getRange: () => ({ setValues: () => {} }),
          setFrozenRows: () => {},
          appendRow: (row) => { backups.push(row); },
          getLastRow: () => backups.length + 1
        })
      })
    },
    Utilities: { getUuid: () => '00000000-0000-4000-8000-000000000001' },
    Logger: { log: () => {} }
  };
  vm.createContext(sandbox);
  for (const file of ['Scripts/Script_Validator.js', 'Scripts/Script_Formatter.js', 'Models/Script.js', 'Scripts/Script_Revision_Maintenance.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
  }
  return { maintenance: vm.runInContext('ScriptRevisionMaintenance', sandbox), writes, backups };
}

const cases = [
  ['a dry run plans the revision and writes nothing', () => {
    const h = harness(baseRecord());
    const result = h.maintenance.run(SCRIPT_ID, { apply: false });
    assert.equal(result.applied, false);
    assert.equal(h.writes.length, 0);
    assert.equal(h.backups.length, 0);
    assert.equal(result.summary.sceneCount, 5);
    assert.equal(result.summary.newVersion, 2);
    assert.equal(result.summary.durationSeconds, 49);
  }],
  ['apply backs up the original first, then writes exactly one revised record with the same ID', () => {
    const original = baseRecord();
    const h = harness(original);
    const result = h.maintenance.run(SCRIPT_ID, { apply: true });
    assert.equal(result.applied, true);
    assert.equal(h.backups.length, 1, 'one backup row');
    assert.equal(h.backups[0][1], SCRIPT_ID);
    assert.equal(JSON.parse(h.backups[0][3]).voiceoverScript, 'Original voiceover text.', 'backup holds the original');
    assert.equal(h.writes.length, 1, 'one update');
    const saved = h.writes[0];
    assert.equal(saved.id, SCRIPT_ID);
    assert.equal(saved.ideaId, IDEA_ID);
    assert.equal(saved.version, 2);
    assert.equal(saved.status, 'FORMATTED', 'the script is never approved by this maintenance');
    assert.equal(saved.title, original.title);
    assert.equal(saved.callToAction, original.callToAction);
    assert.equal(saved.scenes.length, 5);
  }],
  ['scene 4 carries the owner\'s final narration exactly', () => {
    const h = harness(baseRecord());
    h.maintenance.run(SCRIPT_ID, { apply: true });
    assert.equal(h.writes[0].scenes[3].narration,
      'Residents continue repainting their walls, keeping the town\'s famous blue streets vibrant. From pale sky blue to deep indigo, almost every corner looks different.');
  }],
  ['the revised voiceover is the five narrations in order', () => {
    const h = harness(baseRecord());
    h.maintenance.run(SCRIPT_ID, { apply: true });
    const expected = h.writes[0].scenes.map((scene) => scene.narration).join(' ');
    assert.equal(h.writes[0].voiceoverScript, expected);
  }],
  ['a record for a different idea is refused and nothing is written', () => {
    const h = harness(baseRecord({ ideaId: 'IDEA-OTHER' }));
    assert.throws(() => h.maintenance.run(SCRIPT_ID, { apply: true }), /different idea/);
    assert.equal(h.writes.length, 0);
    assert.equal(h.backups.length, 0);
  }],
  ['an approved script is refused and nothing is written', () => {
    const h = harness(baseRecord({ status: 'APPROVED' }));
    assert.throws(() => h.maintenance.run(SCRIPT_ID, { apply: true }), /Only a FORMATTED script/);
    assert.equal(h.writes.length, 0);
  }],
  ['an unknown script ID is refused and nothing is written', () => {
    const h = harness(baseRecord());
    assert.throws(() => h.maintenance.run('SCR-unknown', { apply: true }), /No script with that ID/);
    assert.equal(h.writes.length, 0);
  }],
  ['apply must be exactly true; anything else is a dry run', () => {
    const h = harness(baseRecord());
    h.maintenance.run(SCRIPT_ID, { apply: 'yes' });
    h.maintenance.run(SCRIPT_ID, {});
    assert.equal(h.writes.length, 0);
  }],
  ['runForIdea revises only when exactly one script matches the idea', () => {
    const h = harness(baseRecord());
    const result = h.maintenance.runForIdea({ apply: true });
    assert.equal(result.applied, true);
    assert.equal(h.writes.length, 1);
  }],
  ['runForIdea refuses when no script matches the idea', () => {
    const h = harness(null);
    assert.throws(() => h.maintenance.runForIdea({ apply: true }), /Expected exactly one script/);
    assert.equal(h.writes.length, 0);
  }],
];

let failed = 0;
for (const [name, run] of cases) {
  try { run(); console.log('PASS ' + name); }
  catch (error) { failed++; console.log('FAIL ' + name + ': ' + error.message.split('\n')[0]); }
}
console.log('Script revision maintenance: ' + (cases.length - failed) + '/' + cases.length + ' passed.');
process.exit(failed ? 1 : 0);
