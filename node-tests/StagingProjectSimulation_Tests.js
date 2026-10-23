'use strict';
// Simulates the STAGING Apps Script project as it will really exist:
// - every file the staging push tool pushes, loaded into ONE shared global scope
//   (as Apps Script does), with the REAL ProductionController, queue, repositories;
// - ONLY the services the staging manifest (spreadsheets.currentonly) allows.
//   UrlFetchApp, YouTube, DriveApp, GmailApp, Session, opening other spreadsheets
//   and ScriptApp throw the permission errors Google would raise;
// - the REAL CallbackBridge.js writing into the same spreadsheet.
// Then runs the real stagingSeedRenderJobs() -> 12 callbacks -> stagingVerifyRun().
// If any staging step needed a permission staging does not have, this fails.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const { selectFiles, stagingManifest } = require('../tools/staging/prepare-staging-push.cjs');
const runner = require('./staging/run-staging-callbacks.cjs');
const { payloadFor } = require('./staging/send-synthetic-callback.cjs');
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }

// ---------- a generic in-memory spreadsheet ----------
function makeSpreadsheet(name, id) {
  const sheets = [];
  function makeSheet(sheetName) {
    const data = [];
    const width = () => data.reduce((m, r) => Math.max(m, r.length), 0);
    const cell = (r, c) => (data[r] && data[r][c] !== undefined ? data[r][c] : '');
    const sheet = {
      getName: () => sheetName, getSheetName: () => sheetName,
      getLastRow: () => { let n = data.length; while (n && data[n - 1].every(v => v === '' || v === undefined)) n--; return n; },
      getLastColumn: () => width(), getMaxRows: () => Math.max(1000, data.length), getMaxColumns: () => Math.max(26, width()),
      getRange(row, col, numRows, numCols) {
        if (typeof row === 'string') throw new Error('A1 notation not supported by the simulation');
        const nr = numRows || 1, nc = numCols || 1;
        let proxied;
        const range = {
          getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(row - 1 + i, col - 1 + j))),
          getDisplayValues: () => range.getValues().map(r => r.map(v => (v instanceof Date ? v.toISOString() : String(v)))),
          getValue: () => cell(row - 1, col - 1),
          setValues(values) {
            values.forEach((v, i) => v.forEach((x, j) => {
              while (data.length < row + i) data.push([]);
              data[row - 1 + i][col - 1 + j] = x;
            }));
            return proxied;
          },
          setValue(v) { return range.setValues([[v]]); },
          clearContent() { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (data[row - 1 + i]) data[row - 1 + i][col - 1 + j] = ''; return proxied; }
        };
        // Formatting calls (setFontWeight, setBackground, ...) are accepted as chainable no-ops.
        proxied = new Proxy(range, { get: (t, p) => (p in t ? t[p] : () => proxied) });
        return proxied;
      },
      appendRow(values) { data.push(values.slice()); return sheet; },
      clear() { data.length = 0; return sheet; }
    };
    return new Proxy(sheet, { get: (t, p) => (p in t ? t[p] : () => sheet) });
  }
  const ss = {
    getName: () => name, getId: () => id,
    getSheets: () => sheets.slice(),
    getSheetByName: n => sheets.find(s => s.getName() === n) || null,
    insertSheet: n => { if (ss.getSheetByName(n)) throw new Error('Sheet exists: ' + n); const s = makeSheet(n); sheets.push(s); return s; },
    deleteSheet: s => { sheets.splice(sheets.indexOf(s), 1); }
  };
  return ss;
}

// ---------- the services a spreadsheets.currentonly project actually has ----------
function denied(service, log) {
  return new Proxy({}, { get: (t, p) => {
    if (p === Symbol.toPrimitive || p === 'then') return undefined;
    log.push(service + '.' + String(p));
    return () => { throw new Error('Exception: You do not have permission to call ' + service + '.' + String(p)); };
  } });
}

function stagingProject(spreadsheet, properties) {
  const deniedCalls = [];
  const cache = {};
  const context = vm.createContext({
    console,
    Logger: { log() {} },
    Utilities: {
      getUuid: () => crypto.randomUUID(), sleep() {},
      DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5' },
      computeDigest: (a, t) => Array.from(crypto.createHash(a === 'md5' ? 'md5' : 'sha256').update(String(t)).digest()).map(b => (b > 127 ? b - 256 : b)),
      formatDate: (d) => new Date(d).toISOString()
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: n => (n in properties ? properties[n] : null),
        setProperty: (n, v) => { properties[n] = String(v); },
        getProperties: () => Object.assign({}, properties),
        deleteProperty: n => { delete properties[n]; }
      })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {}, hasLock: () => true }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
    SpreadsheetApp: new Proxy({ getActiveSpreadsheet: () => spreadsheet }, { get: (t, p) => {
      if (p in t) return t[p];
      deniedCalls.push('SpreadsheetApp.' + String(p)); // e.g. openById needs the full spreadsheets scope
      return () => { throw new Error('Exception: You do not have permission to call SpreadsheetApp.' + String(p)); };
    } }),
    UrlFetchApp: denied('UrlFetchApp', deniedCalls),
    DriveApp: denied('DriveApp', deniedCalls),
    GmailApp: denied('GmailApp', deniedCalls),
    MailApp: denied('MailApp', deniedCalls),
    Session: denied('Session', deniedCalls),
    ScriptApp: denied('ScriptApp', deniedCalls)
    // YouTube is deliberately absent: the staging manifest removes the advanced service.
  });
  for (const file of selectFiles(root).filter(f => f.endsWith('.js') || f.endsWith('.gs'))) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  return { context, deniedCalls, call: code => vm.runInContext(code, context, { timeout: 20000 }) };
}

function stagingBridge(spreadsheet, properties) {
  const bridge = vm.createContext({
    Logger: { log() {} }, Utilities: { getUuid: () => crypto.randomUUID() },
    PropertiesService: { getScriptProperties: () => ({ getProperty: n => (n in properties ? properties[n] : null) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    SpreadsheetApp: { openById: id => { if (id !== spreadsheet.getId()) throw new Error('No spreadsheet with ID ' + id); return spreadsheet; } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ setMimeType: () => ({ text }) }) }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'CallbackBridge/CallbackBridge.js'), 'utf8'), bridge);
  return async (target, scenario, renderId) => {
    const payload = payloadFor(scenario, renderId);
    bridge.__event = { parameter: { route: 'media-worker-callback', secret: scenario === 'bad-secret' ? 'wrong' : target.secret },
      postData: { contents: JSON.stringify(payload) } };
    return { response: JSON.parse(vm.runInContext('doPost(__event)', bridge).text) };
  };
}

const SECRET = 'staging-only-secret-' + crypto.randomUUID();
const RUNNER_ENV = { SAVANNAH_STAGING_BRIDGE_URL: 'https://script.google.com/macros/s/AKfycbSTAGINGsimulated/exec', SAVANNAH_STAGING_CALLBACK_SECRET: SECRET };

(async () => {
  await test('the staging manifest grants only spreadsheets.currentonly and no YouTube service (what this simulation models)', () => {
    const manifest = stagingManifest(root);
    assert.deepEqual(manifest.oauthScopes, ['https://www.googleapis.com/auth/spreadsheets.currentonly']);
    assert.equal(JSON.stringify(manifest.dependencies || {}).toLowerCase().includes('youtube'), false);
  });

  let result;
  await test('the full staging procedure passes inside a simulated spreadsheet-only staging project, with the real controller and queue', async () => {
    const spreadsheet = makeSpreadsheet('Savannah STAGING', 'STAGING-SHEET-ID');
    const project = stagingProject(spreadsheet, { SAVANNAH_ENVIRONMENT: 'staging', MEDIA_WORKER_SHARED_SECRET: SECRET });
    const seeded = JSON.parse(JSON.stringify(project.call('stagingSeedRenderJobs()')));
    assert.match(seeded.command, /--i-am-targeting-staging( cr-[0-9a-f-]{36}){5}$/);
    const transport = stagingBridge(spreadsheet, { SAVANNAH_ENVIRONMENT: 'staging', MEDIA_WORKER_SHARED_SECRET: SECRET, RENDER_JOBS_SPREADSHEET_ID: 'STAGING-SHEET-ID' });
    const bridgeChecks = await runner.run(seeded.command.split(' ').slice(2), RUNNER_ENV, transport);
    assert.deepEqual(bridgeChecks.filter(c => !c.ok).map(c => c.label), [], 'bridge checks failed');
    result = { project, report: JSON.parse(JSON.stringify(project.call('stagingVerifyRun()'))) };
    const notPass = result.report.checks.filter(c => c.result !== 'PASS');
    assert.equal(result.report.status, 'PASSED', JSON.stringify(notPass, null, 2));
    assert.deepEqual(notPass.map(c => c.id), [], 'every check, including C9 (real Production page data) and C10 (real queue), must PASS');
  });

  await test('no step touched the internet, YouTube, Drive, mail, the user identity, or another spreadsheet', () => {
    const forbidden = result.project.deniedCalls.filter(c => !/^ScriptApp\./.test(c));
    assert.deepEqual(forbidden, []);
  });

  await test('the only out-of-scope attempt is the readiness check probing ScriptApp, which it handles', () => {
    const scriptApp = result.project.deniedCalls.filter(c => /^ScriptApp\./.test(c));
    assert.ok(scriptApp.every(c => c === 'ScriptApp.getService' || c === 'ScriptApp.getProjectTriggers'), JSON.stringify(scriptApp));
    const c12 = result.report.checks.find(c => c.id === 'C12');
    assert.equal(c12.result, 'PASS');
  });

  await test('a YouTube upload or paid call attempted inside the simulated staging project is refused', () => {
    const spreadsheet = makeSpreadsheet('Savannah STAGING', 'S2');
    // Worst case: an API key was left behind in the staging project.
    const project = stagingProject(spreadsheet, { SAVANNAH_ENVIRONMENT: 'staging', OPENAI_API_KEY: 'sk-left-behind-by-mistake' });
    assert.throws(() => project.call('YouTubeService.upload({ id: "R", status: "SUCCEEDED", videoUrl: "https://x/v.mp4" }, {}, {})'), /Refused in staging: YouTube upload/);
    assert.throws(() => project.call('callOpenAI({ input: "hello" })'), /Refused in staging: OpenAI text generation/);
    assert.deepEqual(project.deniedCalls, [], 'the guard must stop these before any internet call is even attempted');
  });

  await test('queue tick in staging stops a failing READY task (PR #20) without retrying it or making any internet call', () => {
    const spreadsheet = makeSpreadsheet('Savannah STAGING', 'S3');
    const project = stagingProject(spreadsheet, { SAVANNAH_ENVIRONMENT: 'staging', OPENAI_API_KEY: 'sk-left-behind-by-mistake' });
    // A READY task whose script cannot be rendered: the submission fails before recording anything itself.
    project.call('ProductionTaskRepository.save(ProductionTaskRepository.create({ id: "PRD-STGTEST", scriptId: "SCR-MISSING", status: "READY", preparedScenes: [1, 2, 3, 4], nextScene: 5 }))');
    assert.throws(() => project.call('ProductionQueueService.processNext()'));
    const task = JSON.parse(JSON.stringify(project.call('ProductionTaskRepository.getById("PRD-STGTEST")')));
    assert.equal(task.status, 'FAILED', 'the failing task must be contained, not left first in line');
    // Recorded by submitPrepared itself or, if it could not, by the queue's containment ("Stopped by the queue: ...").
    assert.match(task.errorMessage, /approved script|Stopped by the queue/);
    const second = JSON.parse(JSON.stringify(project.call('ProductionQueueService.processNext()')));
    assert.equal(second.processed, false, 'a contained task must not be picked up again');
    assert.deepEqual(project.deniedCalls.filter(c => !/^ScriptApp\./.test(c)), [], 'no internet, YouTube, Drive or other-spreadsheet access');
  });

  console.log(`Staging project simulation: ${passed}/${passed} passed.`);
})().catch(error => { console.error(error); process.exit(1); });
