'use strict';
// Regression tests for the visual-only maintenance: the dry run writes nothing; apply backs up first,
// writes exactly one record for the target script, changes only location, searchKeywords and version,
// verifies the save, and refuses wrong records or any change to approved wording.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

const SCRIPT_ID = 'SCR-39e7d862-5faa-481c-b75a-389a55ef60df';
const IDEA_ID = 'IDEA-C4EF1471';

const plan = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'first-video', 'shot-plan.json'), 'utf8'));
const APPROVED_VISUAL = [
  'Wide shot of the blue medina climbing a green hillside, slow pan across the rooftops',
  'Medium shot of a blue-painted alley, with a resident walking past a doorway',
  'Close-up of a blue doorway with a wooden door and steps leading up',
  'Close-up of someone touching up a blue wall with a brush, then a shot of a sunlit street',
  'Slow pan up a blue staircase to the rooftops, with street life below'
];
const ON_SCREEN = ['Mystery of Blue Chefchaouen', 'Peace or pest control?', 'A commonly cited story', 'Repainted again and again', 'Your theory?'];
const SECONDS = [10, 10, 10, 10, 9];

function storedRecord(overrides) {
  return Object.assign({
    id: SCRIPT_ID,
    ideaId: IDEA_ID,
    title: "The Mystery of Morocco's Blue City",
    hook: "In Morocco's Rif Mountains, a whole town is painted blue, and nobody agrees why.",
    voiceoverScript: plan.scenes.map((s) => s.narration).join(' '),
    scenes: plan.scenes.map((scene, index) => ({
      sceneNumber: scene.sceneNumber,
      narration: scene.narration,
      onScreenText: ON_SCREEN[index],
      visualDirection: APPROVED_VISUAL[index],
      estimatedSeconds: SECONDS[index]
    })),
    callToAction: 'Tell me your theory in the comments.',
    estimatedDurationSeconds: 49,
    generationNotes: '',
    status: 'APPROVED',
    version: 7,
    createdAt: '2026-10-30T19:58:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    promptVersion: 'manual',
    aiModel: 'gpt-4o-mini',
    seoPackId: 'SEO-EXAMPLE-0001'
  }, overrides || {});
}

function harness(records, options) {
  const opts = options || {};
  const reads = [];
  const writes = [];
  const backups = [];
  // Backup sheet: row 1 is the header, so backup row n is backups[n - 2].
  const backupSheet = {
    getRange: (row) => ({ setValues: () => {}, getValues: () => [backups[row - 2] || []] }),
    setFrozenRows: () => {},
    appendRow: (row) => { backups.push(row); },
    getLastRow: () => backups.length + 1
  };
  let stored = JSON.parse(JSON.stringify(records));
  const sandbox = {
    console,
    ScriptsRepository: {
      getScriptById: (id) => {
        reads.push(id);
        const found = stored.find((r) => r.id === id);
        return found ? JSON.parse(JSON.stringify(found)) : null;
      },
      updateScript: (script) => {
        writes.push(JSON.parse(JSON.stringify(script)));
        if (opts.failSave) return { saved: false };
        stored = stored.map((r) => (r.id === script.id ? JSON.parse(JSON.stringify(script)) : r));
        if (opts.corruptAfterSave) stored = stored.map((r) => (r.id === script.id ? Object.assign({}, r, { version: 99 }) : r));
        return { saved: true, updated: true, version: script.version };
      }
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: () => backupSheet,
        insertSheet: () => backupSheet
      })
    },
    Logger: { log: () => {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'Scripts', 'Visual_Fields_Maintenance.js'), 'utf8'), sandbox, { filename: 'Scripts/Visual_Fields_Maintenance.js' });
  return { maintenance: vm.runInContext('VisualFieldsMaintenance', sandbox), reads, writes, backups };
}

const cases = [
  ['a dry run lists the five visual changes and writes nothing', () => {
    const h = harness([storedRecord()]);
    const result = h.maintenance.run(SCRIPT_ID, { apply: false });
    assert.equal(result.applied, false);
    assert.equal(h.writes.length, 0);
    assert.equal(h.backups.length, 0);
    assert.equal(result.summary.changes.length, 5);
    assert.equal(JSON.stringify(result.summary.changes[0].after), JSON.stringify({ location: 'Chefchaouen', searchKeywords: 'blue city aerial mountains rooftops' }));
    assert.equal(JSON.stringify(result.summary.changes[0].before), JSON.stringify({ location: null, searchKeywords: null }));
    assert.equal(result.summary.newVersion, 8);
    assert.equal(result.summary.status, 'APPROVED');
  }],
  ['apply backs up the original first, then writes one record with only the visual fields and version changed', () => {
    const original = storedRecord();
    const h = harness([original]);
    const result = h.maintenance.run(SCRIPT_ID, { apply: true });
    assert.equal(result.applied, true);
    assert.equal(result.verified, true);
    assert.equal(h.backups.length, 1, 'one backup row');
    assert.equal(JSON.parse(h.backups[0][3]).version, 7, 'backup holds the original version');
    assert.equal(h.writes.length, 1, 'one save');
    const written = h.writes[0];
    assert.equal(written.version, 8);
    assert.equal(written.status, 'APPROVED');
    for (const [index, scene] of written.scenes.entries()) {
      assert.equal(scene.location, 'Chefchaouen');
      assert.equal(scene.narration, original.scenes[index].narration, 'narration unchanged');
      assert.equal(scene.onScreenText, original.scenes[index].onScreenText);
      assert.equal(scene.visualDirection, original.scenes[index].visualDirection);
      assert.equal(scene.estimatedSeconds, original.scenes[index].estimatedSeconds);
    }
  }],
  ['every unrelated top-level field, including the SEO link and approval-related fields, is unchanged', () => {
    const original = storedRecord();
    const h = harness([original]);
    h.maintenance.run(SCRIPT_ID, { apply: true });
    const written = h.writes[0];
    for (const key of Object.keys(original)) {
      if (['scenes', 'version', 'updatedAt'].includes(key)) continue;
      assert.equal(JSON.stringify(written[key]), JSON.stringify(original[key]), 'field ' + key + ' unchanged');
    }
  }],
  ['only the target script is read or written', () => {
    const other = storedRecord({ id: 'SCR-other-0000', ideaId: 'IDEA-OTHER' });
    const h = harness([storedRecord(), other]);
    h.maintenance.run(SCRIPT_ID, { apply: true });
    assert.ok(h.reads.every((id) => id === SCRIPT_ID), 'reads only the target');
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0].id, SCRIPT_ID);
  }],
  ['refuses any other script ID before reading the repository', () => {
    const h = harness([storedRecord()]);
    assert.throws(() => h.maintenance.run('SCR-other-0000', { apply: true }), /only changes one script/);
    assert.equal(h.reads.length, 0);
    assert.equal(h.writes.length, 0);
  }],
  ['refuses a record that belongs to another idea', () => {
    const h = harness([storedRecord({ ideaId: 'IDEA-OTHER' })]);
    assert.throws(() => h.maintenance.run(SCRIPT_ID, { apply: true }), /different idea/);
    assert.equal(h.writes.length, 0);
  }],
  ['refuses a script that is not APPROVED', () => {
    const h = harness([storedRecord({ status: 'PENDING_APPROVAL' })]);
    assert.throws(() => h.maintenance.run(SCRIPT_ID, { apply: true }), /Only an APPROVED script/);
    assert.equal(h.writes.length, 0);
  }],
  ['refuses if any approved narration differs, and writes nothing', () => {
    const record = storedRecord();
    record.scenes[3].narration = record.scenes[3].narration.replace('famous', 'well-known');
    const h = harness([record]);
    assert.throws(() => h.maintenance.run(SCRIPT_ID, { apply: true }), /narration differs|field narration differs/);
    assert.equal(h.backups.length, 0, 'no backup for a refused change');
    assert.equal(h.writes.length, 0);
  }],
  ['refuses if the saved scene count is not five', () => {
    const record = storedRecord();
    record.scenes = record.scenes.slice(0, 4);
    const h = harness([record]);
    assert.throws(() => h.maintenance.run(SCRIPT_ID, { apply: true }), /Expected 5 saved scenes/);
    assert.equal(h.writes.length, 0);
  }],
  ['refuses to overwrite a different location already stored', () => {
    const record = storedRecord();
    record.scenes[0].location = 'Tangier';
    const h = harness([record]);
    assert.throws(() => h.maintenance.run(SCRIPT_ID, { apply: true }), /already has a different location/);
    assert.equal(h.writes.length, 0);
  }],
  ['an unconfirmed save is reported with the backup row', () => {
    const h = harness([storedRecord()], { failSave: true });
    assert.throws(() => h.maintenance.run(SCRIPT_ID, { apply: true }), /did not confirm.*backup row/);
    assert.equal(h.backups.length, 1);
  }],
  ['a save that does not read back as planned is reported, not silently accepted', () => {
    const h = harness([storedRecord()], { corruptAfterSave: true });
    assert.throws(() => h.maintenance.run(SCRIPT_ID, { apply: true }), /does not match the plan/);
  }]
];

cases.push(['restore dry run reports the change and writes nothing', () => {
  const h = harness([storedRecord()]);
  h.maintenance.run(SCRIPT_ID, { apply: true });
  const writesBefore = h.writes.length;
  const result = h.maintenance.restore({ apply: false });
  assert.equal(result.applied, false);
  assert.equal(h.writes.length, writesBefore, 'no save in a dry run');
  assert.equal(result.summary.newVersion, 9);
  assert.equal(result.summary.visualFieldsRemoved, 5);
}]);

cases.push(['restore puts back the original content with the next version and no visual fields', () => {
  const original = storedRecord();
  const h = harness([original]);
  h.maintenance.run(SCRIPT_ID, { apply: true });
  const result = h.maintenance.restore({ apply: true });
  assert.equal(result.applied, true);
  assert.equal(result.verified, true);
  const restored = h.writes[h.writes.length - 1];
  assert.equal(restored.version, 9);
  assert.equal(restored.status, 'APPROVED');
  for (const [index, scene] of restored.scenes.entries()) {
    assert.equal(scene.location, undefined);
    assert.equal(scene.searchKeywords, undefined);
    assert.equal(scene.narration, original.scenes[index].narration);
  }
  assert.equal(restored.seoPackId, original.seoPackId);
  assert.ok(result.selfBackupRow > 0, 'the record being replaced is backed up first');
}]);

cases.push(['restore refuses when there is no backup', () => {
  const h = harness([storedRecord()]);
  assert.throws(() => h.maintenance.restore({ apply: true }), /No backup of this script/);
  assert.equal(h.writes.length, 0);
}]);

cases.push(['restore refuses a script that is no longer APPROVED', () => {
  const h = harness([storedRecord({ status: 'PENDING_APPROVAL' })]);
  h.backups.push([new Date().toISOString(), SCRIPT_ID, IDEA_ID, JSON.stringify(storedRecord())]);
  assert.throws(() => h.maintenance.restore({ apply: true }), /restore only an APPROVED script/);
  assert.equal(h.writes.length, 0);
}]);

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log('PASS ' + name);
  } catch (error) {
    failed += 1;
    console.log('FAIL ' + name + ': ' + error.message);
  }
}
console.log('Visual fields maintenance: ' + (cases.length - failed) + '/' + cases.length + ' passed.');
if (failed > 0) process.exit(1);
