'use strict';
// The human approval gate: only a script a person APPROVED may be rendered.
// Runs the REAL QueueController.decide with the REAL ApprovalModel/ScriptModel
// over in-memory repositories. Previously covered only by in-app test* functions,
// which CI never ran.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }

function setup(options) {
  const opts = options || {};
  const approvals = {}, scripts = {};
  const writes = { approvals: [], scripts: [] };
  let lockState = { waits: 0, releases: 0 };
  const context = vm.createContext({
    Utilities: { getUuid: randomUUID }, Logger: { log() {} },
    LockService: { getScriptLock: () => ({
      waitLock: () => { if (opts.lockBusy) throw new Error('Lock timeout'); lockState.waits++; },
      releaseLock: () => { lockState.releases++; }
    }) },
    LoggingService: { success() {}, failure() {} },
    ApprovalRepository: {
      getApprovalById: id => (approvals[id] ? JSON.parse(JSON.stringify(approvals[id])) : null),
      updateApproval: a => { writes.approvals.push(a.status); approvals[a.id] = JSON.parse(JSON.stringify(a)); return a; }
    },
    ScriptsRepository: {
      getScriptById: id => (scripts[id] ? JSON.parse(JSON.stringify(scripts[id])) : null),
      updateScript: s => {
        if (opts.scriptWriteFails) throw new Error('Sheets write failed');
        writes.scripts.push(s.status); scripts[s.id] = JSON.parse(JSON.stringify(s)); return s;
      }
    }
  });
  for (const file of ['Models/Script.js', 'Models/Approval.js', 'App/QueueController.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  const pending = JSON.parse(vm.runInContext(`(function () {
    const s = ScriptModel.create(Object.assign(createApprovalModelScriptFixture_(), { status: "PENDING_APPROVAL" }));
    const a = ApprovalModel.fromScript(s, { submittedBy: "Writer" });
    return JSON.stringify({ script: s, approval: a });
  })()`, context));
  scripts[pending.script.id] = pending.script;
  approvals[pending.approval.id] = pending.approval;
  context.request = null;
  return {
    approvalId: pending.approval.id, scriptId: pending.script.id, scripts, approvals, writes, lock: () => lockState,
    decide: request => { context.request = request; return JSON.parse(JSON.stringify(vm.runInContext('queueDecide(request)', context))); }
  };
}

test('APPROVE moves both the approval and the script to APPROVED', () => {
  const t = setup();
  const response = t.decide({ approvalId: t.approvalId, decision: 'approve', reviewedBy: 'Owner' });
  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(t.approvals[t.approvalId].status, 'APPROVED');
  assert.equal(t.scripts[t.scriptId].status, 'APPROVED');
  assert.equal(t.lock().waits, 1);
  assert.equal(t.lock().releases, 1);
});

test('REJECT and RETURN require a reason and never leave the script APPROVED', () => {
  for (const decision of ['REJECT', 'RETURN']) {
    const noReason = setup();
    assert.equal(noReason.decide({ approvalId: noReason.approvalId, decision }).success, false);
    assert.equal(noReason.scripts[noReason.scriptId].status, 'PENDING_APPROVAL', decision + ' without reason changed the script');
    const t = setup();
    const response = t.decide({ approvalId: t.approvalId, decision, decisionReason: 'Hook is weak.' });
    assert.equal(response.success, true, JSON.stringify(response));
    assert.notEqual(t.scripts[t.scriptId].status, 'APPROVED');
  }
});

test('an approval cannot be decided twice (no flip from REJECTED to APPROVED)', () => {
  const t = setup();
  assert.equal(t.decide({ approvalId: t.approvalId, decision: 'REJECT', decisionReason: 'No.' }).success, true);
  const second = t.decide({ approvalId: t.approvalId, decision: 'APPROVE' });
  assert.equal(second.success, false);
  assert.match(second.error.message, /already been completed/);
  assert.notEqual(t.scripts[t.scriptId].status, 'APPROVED');
});

test('unknown decisions, missing IDs and unknown approvals are refused without writes', () => {
  const t = setup();
  for (const request of [{ approvalId: t.approvalId, decision: 'PUBLISH' }, { decision: 'APPROVE' },
    { approvalId: 'APR-missing', decision: 'APPROVE' }, null]) {
    assert.equal(t.decide(request).success, false, JSON.stringify(request));
  }
  assert.deepEqual(t.writes, { approvals: [], scripts: [] });
});

test('a script that is no longer pending cannot be approved through a stale approval', () => {
  const t = setup();
  t.scripts[t.scriptId].status = 'DRAFT';
  const response = t.decide({ approvalId: t.approvalId, decision: 'APPROVE' });
  assert.equal(response.success, false);
  assert.equal(t.approvals[t.approvalId].status, 'PENDING_APPROVAL');
});

test('if saving the script fails, the approval is rolled back to pending', () => {
  const t = setup({ scriptWriteFails: true });
  const response = t.decide({ approvalId: t.approvalId, decision: 'APPROVE' });
  assert.equal(response.success, false);
  assert.equal(t.approvals[t.approvalId].status, 'PENDING_APPROVAL', 'Approval left APPROVED while the script was not.');
  assert.equal(t.scripts[t.scriptId].status, 'PENDING_APPROVAL');
});

test('lock timeout refuses the decision without writing', () => {
  const t = setup({ lockBusy: true });
  assert.equal(t.decide({ approvalId: t.approvalId, decision: 'APPROVE' }).success, false);
  assert.deepEqual(t.writes, { approvals: [], scripts: [] });
  assert.equal(t.lock().releases, 0, 'A lock never acquired must not be released.');
});

test('every render and scene-preparation entry point requires an APPROVED script', () => {
  const source = fs.readFileSync(path.join(root, 'App/ProductionController.js'), 'utf8');
  for (const fn of ['function submitCore_(', 'function prepareNextScene(', 'function prepareScene(']) {
    const start = source.indexOf(fn);
    assert.ok(start !== -1, fn + ' not found');
    const body = source.slice(start, source.indexOf('\n  function ', start + fn.length));
    assert.match(body, /status !== "APPROVED"/, fn + ' does not check for an APPROVED script');
  }
});

console.log(`Approval gate: ${passed}/${passed} passed.`);
