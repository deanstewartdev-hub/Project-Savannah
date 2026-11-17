/****************************************************
 * Project Savannah - ScriptsRepository characterisation suite (refactoring safety net)
 *
 * Pins what Scripts/Scripts_Repository.js does today so its row mapping can be moved into a
 * focused module with proof that the stored format did not change: same columns, same cell
 * values, same JSON, same header handling, same errors.
 *
 * It runs the REAL repository and the REAL ScriptModel against an in-memory sheet
 * (node-tests/lib/fakeSpreadsheet.cjs). Every scenario records the return value, every write to
 * the sheet, and the sheet's final contents. No Google call, no live data.
 *
 * Run with: node node-tests/ScriptsRepositoryCharacterization_Tests.js
 * Regenerate (deliberately, never to make a failure pass): add --update
 ****************************************************/
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { root, createSandbox, settle } = require('./lib/characterization.cjs');
const { createFakeSpreadsheet } = require('./lib/fakeSpreadsheet.cjs');

// Every Scripts/Scripts_Repository*.js file, so focused modules split out later are loaded too.
const repositoryFiles = fs.readdirSync(path.join(root, 'Scripts'))
  .filter(name => /^Scripts_Repository.*\.js$/.test(name))
  .sort()
  .map(name => 'Scripts/' + name);

function build() {
  const writes = [];
  const spreadsheet = createFakeSpreadsheet(writes);
  const state = { spreadsheet, writes, noSpreadsheet: false };
  const sandbox = createSandbox({});
  sandbox.context.SpreadsheetApp = { getActiveSpreadsheet: () => (state.noSpreadsheet ? null : spreadsheet), flush() {} };
  sandbox.context.__spreadsheet = spreadsheet;
  sandbox.load(['Config.js', 'Models/Script.js', 'Tests/ApprovalModel_SelfTests.js'].concat(repositoryFiles));
  sandbox.journal.length = 0;
  // Runs setup code inside the sandbox (so Dates and objects belong to the sandbox realm).
  state.arrange = code => vm.runInContext(code, sandbox.context);
  return { sandbox, state };
}

const record = {};
function scenario(name, expression, arrange) {
  const world = build();
  if (arrange) arrange(world.state);
  world.state.writes.length = 0;
  const outcome = world.sandbox.observe(expression);
  if (world.state.writes.length) outcome.writes = JSON.parse(JSON.stringify(world.state.writes));
  const sheet = world.state.spreadsheet.getSheetByName('Scripts');
  outcome.sheetAfter = sheet ? sheet.__dump() : null;
  record[name] = outcome;
}

// A script input the real ScriptModel accepts, with overrides.
const script = overrides => 'Object.assign(createApprovalModelScriptFixture_(), ' + JSON.stringify(overrides || {}) + ')';
const save = overrides => 'ScriptsRepository.saveScript(' + script(overrides) + ')';
// Stores three scripts through the repository itself, so seeded rows are in the real format.
const seedThree = s => s.arrange(
  save({ id: 'SCR-A', ideaId: 'IDEA-1', status: 'FORMATTED', updatedAt: '2026-11-10T09:00:00.000Z' }) + ';' +
  save({ id: 'SCR-B', ideaId: 'IDEA-1', status: 'APPROVED', updatedAt: '2026-11-12T09:00:00.000Z' }) + ';' +
  save({ id: 'SCR-C', ideaId: 'IDEA-2', status: 'FORMATTED', updatedAt: '2026-11-11T09:00:00.000Z' })
);
// Seeds a raw row, as a person or an older version might have left it in the sheet.
const rawRow = cells => '(function () { ScriptsRepository.ensureSheet(); __spreadsheet.getSheetByName("Scripts").__seed([' + cells + ']); })()';
const goodCells = overrides => {
  const cells = {
    id: '"SCR-RAW"', ideaId: '"IDEA-9"', title: '" Raw title "', hook: '"Raw hook"', voiceover: '"Raw voiceover"', scenes: '"[]"', cta: '"Follow"', duration: '45',
    notes: '""', status: '"DRAFT"', validation: '""', formatting: '""', metadata: '""', display: '"  Display  "', prompt: '"p-1"', model: '"m-1"',
    created: 'new Date("2026-11-01T10:00:00.000Z")', updated: '"2026-11-02T10:00:00.000Z"', version: '1', modelVersion: '""'
  };
  Object.assign(cells, overrides || {});
  return '[' + [cells.id, cells.ideaId, cells.title, cells.hook, cells.voiceover, cells.scenes, cells.cta, cells.duration, cells.notes, cells.status, cells.validation,
    cells.formatting, cells.metadata, cells.display, cells.prompt, cells.model, cells.created, cells.updated, cells.version, cells.modelVersion].join(', ') + ']';
};

// --- sheet and header handling --------------------------------------------------
scenario('sheet: created with headers on first use', 'ScriptsRepository.ensureSheet()');
scenario('sheet: existing matching headers are left alone', 'ScriptsRepository.getScriptCount()', s => { s.arrange('ScriptsRepository.ensureSheet()'); });
scenario('sheet: existing empty sheet gets headers', 'ScriptsRepository.getScriptCount()', s => { s.spreadsheet.__create('Scripts'); });
scenario('sheet: blank first row gets headers', 'ScriptsRepository.getScriptCount()', s => { s.spreadsheet.__create('Scripts').__seed([['', ' ', ''], ['', '', 'stray']]); });
scenario('sheet: padded matching headers are accepted', 'ScriptsRepository.getScriptCount()', s => {
  s.arrange('__spreadsheet.__create("Scripts").__seed([ScriptsRepository.getHeaders().map(function (h) { return "  " + h + " "; })])');
});
scenario('sheet: extra trailing column is accepted', 'ScriptsRepository.getScriptCount()', s => {
  s.arrange('__spreadsheet.__create("Scripts").__seed([ScriptsRepository.getHeaders().concat(["Owner notes"])])');
});
scenario('sheet: wrong headers are refused', 'ScriptsRepository.getScriptCount()', s => { s.spreadsheet.__create('Scripts').__seed([['Script ID', 'Title', 'Idea ID']]); });
scenario('sheet: renamed column is refused', save(), s => {
  s.arrange('__spreadsheet.__create("Scripts").__seed([ScriptsRepository.getHeaders().map(function (h) { return h === "Status" ? "State" : h; })])');
});
scenario('sheet: no active spreadsheet', 'ScriptsRepository.getAllScripts()', s => { s.noSpreadsheet = true; });
scenario('headers', 'ScriptsRepository.getHeaders()');
scenario('headers: returned copy is independent', '(function () { var h = ScriptsRepository.getHeaders(); h[0] = "changed"; return ScriptsRepository.getHeaders()[0]; })()');
scenario('version', 'ScriptsRepository.getRepositoryVersion()');

// --- save -------------------------------------------------------------------------
scenario('save: first script', save({ id: 'SCR-1' }));
scenario('save: second script goes on the next row', save({ id: 'SCR-D', ideaId: 'IDEA-3' }), seedThree);
scenario('save: duplicate id is refused', save({ id: 'SCR-B' }), seedThree);
scenario('save: null duration', save({ id: 'SCR-N', estimatedDurationSeconds: null }));
scenario('save: rich metadata and unicode', save({ id: 'SCR-U', title: 'Café “quotes” · naïve', metadata: { provider: 'p', nested: { list: [1, 'two', null] } }, generationNotes: 'Line one\nLine two' }));
scenario('save: script with only an id', 'ScriptsRepository.saveScript({ id: "SCR-BAD" })');
scenario('save: a string instead of a script', 'ScriptsRepository.saveScript("SCR-1")');
scenario('saveOrUpdate: new script is saved', 'ScriptsRepository.saveOrUpdateScript(' + script({ id: 'SCR-NEW' }) + ')', seedThree);
scenario('saveOrUpdate: existing script is updated', 'ScriptsRepository.saveOrUpdateScript(' + script({ id: 'SCR-A', ideaId: 'IDEA-1', title: 'Updated title', version: 2 }) + ')', seedThree);

// --- update -----------------------------------------------------------------------
scenario('update: existing script', 'ScriptsRepository.updateScript(' + script({ id: 'SCR-B', ideaId: 'IDEA-1', status: 'ARCHIVED', version: 3 }) + ')', seedThree);
scenario('update: same version is allowed', 'ScriptsRepository.updateScript(' + script({ id: 'SCR-B', ideaId: 'IDEA-1', title: 'Same version edit' }) + ')', seedThree);
scenario('update: older version is refused', 'ScriptsRepository.updateScript(' + script({ id: 'SCR-V', version: 1 }) + ')', s => { s.arrange(save({ id: 'SCR-V', version: 4 })); });
scenario('update: missing script is refused', 'ScriptsRepository.updateScript(' + script({ id: 'SCR-NOPE' }) + ')', seedThree);
scenario('update: on an empty sheet', 'ScriptsRepository.updateScript(' + script({ id: 'SCR-NOPE' }) + ')');

// --- read -------------------------------------------------------------------------
scenario('get: found', 'ScriptsRepository.getScriptById(" SCR-B ")', seedThree);
scenario('get: missing', 'ScriptsRepository.getScriptById("SCR-NOPE")', seedThree);
scenario('get: on an empty sheet', 'ScriptsRepository.getScriptById("SCR-A")');
for (const [label, value] of [['blank', '"  "'], ['null', 'null'], ['undefined', ''], ['zero', '0']]) scenario('get: id is ' + label, 'ScriptsRepository.getScriptById(' + value + ')', seedThree);
scenario('get: numeric id matches a stored numeric cell', 'ScriptsRepository.getScriptById(42)', s => { s.arrange(rawRow(goodCells({ id: '42' }))); });
scenario('all: three scripts in sheet order', 'ScriptsRepository.getAllScripts()', seedThree);
scenario('all: empty sheet', 'ScriptsRepository.getAllScripts()');
scenario('all: rows with a blank id are skipped', 'ScriptsRepository.getAllScripts().map(function (s) { return s.id; })', s => {
  seedThree(s); s.arrange(rawRow(goodCells({ id: '"   "' }) + ', ' + goodCells({ id: '"SCR-AFTER-BLANK"' })));
});
scenario('byIdea: newest updated first', 'ScriptsRepository.getScriptsByIdeaId(" IDEA-1 ").map(function (s) { return [s.id, s.updatedAt]; })', seedThree);
scenario('byIdea: none', 'ScriptsRepository.getScriptsByIdeaId("IDEA-NOPE")', seedThree);
scenario('byIdea: blank id', 'ScriptsRepository.getScriptsByIdeaId("")', seedThree);
scenario('latest: for idea', 'ScriptsRepository.getLatestScriptByIdeaId("IDEA-1").id', seedThree);
scenario('latest: none', 'ScriptsRepository.getLatestScriptByIdeaId("IDEA-NOPE")', seedThree);
for (const status of ['FORMATTED', ' approved ', 'DRAFT', 'nonsense', '']) scenario('byStatus: ' + JSON.stringify(status), 'ScriptsRepository.getScriptsByStatus(' + JSON.stringify(status) + ').map(function (s) { return s.id; })', seedThree);
scenario('byStatus: no argument', 'ScriptsRepository.getScriptsByStatus()', seedThree);
scenario('count: three', 'ScriptsRepository.getScriptCount()', seedThree);
scenario('count: empty', 'ScriptsRepository.getScriptCount()');
scenario('exists: yes', 'ScriptsRepository.exists("SCR-C")', seedThree);
scenario('exists: no', 'ScriptsRepository.exists("SCR-NOPE")', seedThree);
scenario('exists: blank id', 'ScriptsRepository.exists(" ")', seedThree);

// --- delete -----------------------------------------------------------------------
scenario('delete: middle row', 'ScriptsRepository.deleteScriptById("SCR-B")', seedThree);
scenario('delete: missing', 'ScriptsRepository.deleteScriptById("SCR-NOPE")', seedThree);
scenario('delete: blank id', 'ScriptsRepository.deleteScriptById("")', seedThree);

// --- stored-row parsing (rows a person or an older version left behind) ----------------
scenario('row: hand-entered row is normalised', 'ScriptsRepository.getScriptById("SCR-RAW")', s => { s.arrange(rawRow(goodCells())); });
scenario('row: blank JSON cells use defaults', 'ScriptsRepository.getScriptById("SCR-RAW")', s => { s.arrange(rawRow(goodCells({ scenes: '""', validation: 'null', metadata: '"   "' }))); });
scenario('row: invalid scenes JSON', 'ScriptsRepository.getScriptById("SCR-RAW")', s => { s.arrange(rawRow(goodCells({ scenes: '"[not json"' }))); });
scenario('row: invalid metadata JSON', 'ScriptsRepository.getAllScripts()', s => { s.arrange(rawRow(goodCells({ metadata: '"{oops"' }))); });
scenario('row: duration stored as text', 'ScriptsRepository.getScriptById("SCR-RAW").estimatedDurationSeconds', s => { s.arrange(rawRow(goodCells({ duration: '"47.5"' }))); });
scenario('row: duration blank', 'ScriptsRepository.getScriptById("SCR-RAW").estimatedDurationSeconds', s => { s.arrange(rawRow(goodCells({ duration: '""' }))); });
scenario('row: duration not a number', 'ScriptsRepository.getScriptById("SCR-RAW")', s => { s.arrange(rawRow(goodCells({ duration: '"about a minute"' }))); });
scenario('row: created date invalid', 'ScriptsRepository.getScriptById("SCR-RAW")', s => { s.arrange(rawRow(goodCells({ created: '"yesterday-ish"' }))); });
scenario('row: updated date blank', 'ScriptsRepository.getScriptById("SCR-RAW")', s => { s.arrange(rawRow(goodCells({ updated: '""' }))); });
scenario('row: dates as Date objects', '(function () { var s = ScriptsRepository.getScriptById("SCR-RAW"); return [s.createdAt, s.updatedAt]; })()', s => {
  s.arrange(rawRow(goodCells({ updated: 'new Date("2026-11-03T08:30:00.000Z")' })));
});
scenario('row: unknown status', 'ScriptsRepository.getScriptById("SCR-RAW")', s => { s.arrange(rawRow(goodCells({ status: '"WHATEVER"' }))); });
scenario('row: version not a number', 'ScriptsRepository.getScriptById("SCR-RAW")', s => { s.arrange(rawRow(goodCells({ version: '"v2"' }))); });
scenario('row: one bad row fails the whole list', 'ScriptsRepository.getAllScripts()', s => { seedThree(s); s.arrange(rawRow(goodCells({ scenes: '"{"' }))); });

// --- round trip ---------------------------------------------------------------------
scenario('round trip: saved script reads back equal', '(function () { var input = ScriptModel.toObject(ScriptModel.create(' + script({ id: 'SCR-RT' }) + '));' +
  ' ScriptsRepository.saveScript(input); var output = ScriptModel.toObject(ScriptsRepository.getScriptById("SCR-RT"));' +
  ' return { equal: JSON.stringify(input) === JSON.stringify(output), input: input, output: output }; })()');

process.exitCode = settle('ScriptsRepository characterisation', 'scripts-repository.json', record);
