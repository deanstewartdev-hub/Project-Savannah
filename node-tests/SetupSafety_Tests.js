'use strict';
// "Project Savannah > Setup v1.0 Sheet" (setupProjectSavannah) sits in the live
// spreadsheet's menu. Its v1.0 setup functions used to clear the Scripts, SEO Pack,
// Approval Queue, Logs and Costs tabs. None of them may ever clear an existing tab.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }

function spreadsheet(existing) {
  const sheets = {};
  const destructive = [];
  function sheet(name, rows) {
    const data = rows.map(r => r.slice());
    return {
      name, data,
      clear: () => { destructive.push('clear ' + name); data.length = 0; },
      getMaxRows: () => 1000, getMaxColumns: () => 26,
      getRange: (r, c, nr, nc) => ({
        breakApart() {}, setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; },
        setHorizontalAlignment() { return this; }, setVerticalAlignment() { return this; }, setWrap() { return this; },
        setValues: values => values.forEach((v, i) => v.forEach((cell, j) => {
          while (data.length < r + i) data.push([]);
          if (data[r - 1 + i][c - 1 + j] !== undefined && data[r - 1 + i][c - 1 + j] !== cell) destructive.push('overwrite ' + name);
          data[r - 1 + i][c - 1 + j] = cell;
        }))
      }),
      setFrozenRows() {}, setColumnWidth() {}, setColumnWidths() {}, autoResizeColumns() {}
    };
  }
  Object.entries(existing || {}).forEach(([name, rows]) => { sheets[name] = sheet(name, rows); });
  return {
    sheets, destructive,
    getSheetByName: name => sheets[name] || null,
    insertSheet: name => (sheets[name] = sheet(name, [])),
    deleteSheet: s => { destructive.push('delete ' + s.name); delete sheets[s.name]; }
  };
}

const context = vm.createContext({ Logger: { log() {} }, console });
for (const file of ['Config.js', 'Utils/Utils_Helpers.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}
const SHEETS = vm.runInContext('SHEETS', context);
const SETUPS = ['setupSettingsSheet', 'setupIdeasSheet', 'setupScriptsSheet', 'setupSeoPackSheet',
  'setupApprovalQueueSheet', 'setupLogsSheet', 'setupCostsSheet'];
const run = (ss) => { context.__ss = ss; SETUPS.forEach(name => vm.runInContext(name + '(__ss)', context)); };

test('setup functions never clear, overwrite or delete an existing tab with data', () => {
  const live = {};
  for (const key of ['SETTINGS', 'IDEAS', 'SCRIPTS', 'SEO_PACK', 'APPROVAL_QUEUE', 'LOGS', 'COSTS']) {
    live[SHEETS[key]] = [['Live header A', 'Live header B'], ['live-row-1', 'keep me'], ['live-row-2', 'keep me too']];
  }
  const ss = spreadsheet(live);
  run(ss);
  assert.deepEqual(ss.destructive, [], 'Destructive operations: ' + ss.destructive.join(', '));
  for (const name of Object.keys(live)) {
    assert.deepEqual(ss.sheets[name].data, live[name], name + ' changed');
  }
});

test('running setup twice on a live spreadsheet is still harmless', () => {
  const ss = spreadsheet({ [SHEETS.SCRIPTS]: [['Script ID'], ['SCR-1']], [SHEETS.LOGS]: [['Log ID'], ['LOG-1']] });
  run(ss); run(ss);
  assert.deepEqual(ss.destructive, []);
  assert.equal(ss.sheets[SHEETS.SCRIPTS].data[1][0], 'SCR-1');
});

test('on a fresh spreadsheet, Logs and Costs get their headers; repository-owned tabs are left to their repositories', () => {
  const ss = spreadsheet({});
  run(ss);
  assert.deepEqual(ss.sheets[SHEETS.LOGS].data[0], ['Log ID', 'Timestamp', 'Run ID', 'Action', 'Status', 'Message', 'Error Details']);
  assert.equal(ss.sheets[SHEETS.COSTS].data[0][0], 'Cost ID');
  for (const key of ['SCRIPTS', 'SEO_PACK', 'APPROVAL_QUEUE']) {
    assert.equal(ss.sheets[SHEETS[key]], undefined, key + ' must not be created with obsolete v1.0 headers');
  }
});

test('no setup function in Utils_Helpers.js calls resetSheet any more', () => {
  const source = fs.readFileSync(path.join(root, 'Utils/Utils_Helpers.js'), 'utf8');
  const calls = source.split('\n').filter(line => /resetSheet\(/.test(line) && !/^function resetSheet/.test(line.trim()));
  assert.deepEqual(calls, []);
});

console.log(`Setup safety: ${passed}/${passed} passed.`);
