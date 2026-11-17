import { test } from "node:test";
import assert from "node:assert/strict";
import { applyStep, runPlan, paidPathOpen, TODAY, CONTROLLED_PLAN } from "../../tools/production/rollout-guard.mjs";

// The rollout and rollback rules as a checkable state machine. No deployment is touched. Each test names one rule.

const GATED_REVISION = { acceptedSecret: "current", hasIntentGuard: true, hasPauseGate: true, paused: true, requiresIntent: false };
const LEGACY_REVISION = { acceptedSecret: "legacy", hasIntentGuard: false, hasPauseGate: false, paused: false, requiresIntent: false };
const OLD_REVISION_HOLDING_CURRENT = { acceptedSecret: "current", hasIntentGuard: false, hasPauseGate: false, paused: false, requiresIntent: false };
const NEW_CODE = { checksPause: true, sendsIntent: true };
const LEGACY_CODE = { checksPause: false, sendsIntent: false };

const rotated = () => applyStep(TODAY, { type: "rotateWorkerSecret" }).state;

test("today's deployment is open: a caller holding the legacy secret can start a paid render", () => {
  assert.equal(paidPathOpen(TODAY), true);
});

test("the controlled plan runs from today to open: every state between the first step and the open step is closed", () => {
  const outcome = runPlan(TODAY, CONTROLLED_PLAN);
  assert.equal(outcome.ok, true, outcome.reason);
  const states = outcome.states;
  assert.equal(paidPathOpen(states[0]), true, "today is open");
  for (const state of states.slice(1, -1)) assert.equal(paidPathOpen(state), false);
  assert.equal(paidPathOpen(states[states.length - 1]), true, "only the open step opens submissions");
});

test("the first step closes submissions with no new code: rotating the worker secret refuses the legacy project", () => {
  assert.equal(paidPathOpen(rotated()), false);
});

test("open is refused until REQUIRE_SUBMIT_INTENT is yes", () => {
  const plan = [CONTROLLED_PLAN[0], CONTROLLED_PLAN[1], CONTROLLED_PLAN[2], CONTROLLED_PLAN[3], CONTROLLED_PLAN[4], { type: "open" }];
  const outcome = runPlan(TODAY, plan);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.failedAt, 5);
  assert.match(outcome.reason, /REQUIRE_SUBMIT_INTENT is not yes/);
});

test("open is refused while the Apps Script version is the legacy one", () => {
  const plan = [CONTROLLED_PLAN[0], CONTROLLED_PLAN[1], CONTROLLED_PLAN[2], CONTROLLED_PLAN[3]];
  const outcome = runPlan(TODAY, [...plan, { type: "open" }]);
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /does not read the pause property|does not send intents|do not both hold/);
});

test("open is refused when the live worker revision cannot enforce intents", () => {
  const state = { worker: Object.assign({}, OLD_REVISION_HOLDING_CURRENT, { requiresIntent: true }),
    appsScript: { secret: "current", paused: true, checksPause: true, sendsIntent: true } };
  const outcome = applyStep(state, { type: "open" });
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /does not enforce intents/);
});

test("a worker deploy, an Apps Script deploy and the intent switch are refused while submissions are open", () => {
  assert.equal(applyStep(TODAY, { type: "deployWorker", revision: GATED_REVISION }).ok, false);
  assert.equal(applyStep(TODAY, { type: "deployAppsScript", code: NEW_CODE }).ok, false);
  assert.equal(applyStep(TODAY, { type: "enableIntent" }).ok, false);
});

test("a pause property cannot close submissions while the live Apps Script version ignores it", () => {
  const outcome = applyStep(TODAY, { type: "setAppsScriptPaused", paused: true });
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /would leave paid submissions open/);
});

test("rolling the worker back to the legacy revision is refused while submissions are open", () => {
  assert.equal(applyStep(TODAY, { type: "rollbackWorker", revision: LEGACY_REVISION }).ok, false);
});

test("rolling the worker back to a revision that accepts the legacy secret reopens submissions, and is refused", () => {
  const outcome = applyStep(rotated(), { type: "rollbackWorker", revision: LEGACY_REVISION });
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /would leave paid submissions open/);
});

test("an old worker revision that holds the rotated secret can be rolled back to while closed, but can never be reopened", () => {
  const rolledBack = applyStep(rotated(), { type: "rollbackWorker", revision: OLD_REVISION_HOLDING_CURRENT });
  assert.equal(rolledBack.ok, true, rolledBack.reason);
  const reopened = applyStep(rolledBack.state, { type: "open" });
  assert.equal(reopened.ok, false, "a revision without the intent guard cannot be reopened");
});

test("giving the project the accepted secret while the worker has no pause gate reopens submissions, and is refused", () => {
  const outcome = applyStep(rotated(), { type: "setAppsScriptSecret", secret: "current" });
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /would leave paid submissions open/);
});

test("the Apps Script can be rolled back to legacy code while the worker holds the rotated secret: the legacy secret cannot submit", () => {
  const outcome = applyStep(rotated(), { type: "rollbackAppsScript", code: LEGACY_CODE });
  // Closed while the project still holds the legacy secret (and the worker accepts only the current one).
  assert.equal(outcome.ok, true, outcome.reason);
});

test("rolling the Apps Script back to legacy code is allowed only while the worker is paused, because the project still holds the current secret", () => {
  const paused = applyStep(
    applyStep(applyStep(TODAY, { type: "rotateWorkerSecret" }).state, { type: "deployWorker", revision: GATED_REVISION }).state,
    { type: "setAppsScriptSecret", secret: "current" }).state;
  assert.equal(paidPathOpen(paused), false);
  const legacyCode = applyStep(paused, { type: "rollbackAppsScript", code: LEGACY_CODE });
  assert.equal(legacyCode.ok, true, "closed by the worker pause, which every caller meets");
  const unpaused = Object.assign({}, legacyCode.state, { worker: Object.assign({}, legacyCode.state.worker, { paused: false }) });
  assert.equal(paidPathOpen(unpaused), true, "so a legacy version with the current secret is only safe while the worker is paused");
});

test("closing steps are allowed from an open state and close it", () => {
  const withGate = { worker: { acceptedSecret: "current", hasIntentGuard: true, hasPauseGate: true, paused: false, requiresIntent: true },
    appsScript: { secret: "current", paused: false, checksPause: true, sendsIntent: true } };
  assert.equal(paidPathOpen(withGate), true);
  const closed = applyStep(withGate, { type: "pauseWorker" });
  assert.equal(closed.ok, true);
  assert.equal(paidPathOpen(closed.state), false);
});
