// Rollout and rollback rules for paid submissions, as a pure state machine. It is not connected to any deployment. For a
// proposed step and the state the owner has observed, it answers whether the step may be taken, and it refuses any step
// that would leave paid submissions open, unless it is the open step and that step's preconditions hold.
//
// The state describes what can START a paid render.
//   worker: the live dispatcher revision (a deployed revision carries its own environment)
//     acceptedSecret  "legacy" | "current"   the JOB_SUBMIT_SECRET value the revision accepts
//     hasIntentGuard  true when the revision enforces submitIntentId, scriptId and renderVersion
//     hasPauseGate    true when the revision understands SUBMISSIONS_PAUSED
//     paused          SUBMISSIONS_PAUSED is "yes" (meaningful only when hasPauseGate)
//     requiresIntent  REQUIRE_SUBMIT_INTENT is "yes"
//   appsScript: the Apps Script project
//     secret, paused  the project's script properties (MEDIA_WORKER_JOB_SUBMIT_SECRET and SUBMISSIONS_PAUSED). These
//                     belong to the PROJECT, not to a deployment version: rolling a version back changes neither.
//     checksPause     the live version reads the pause property (code)
//     sendsIntent     the live version sends the intent fields (code)
//
// A paid start is possible exactly when the project's secret is one the live worker accepts, and neither pause applies.

export function paidPathOpen(state) {
  const workerAccepts = state.worker.acceptedSecret === state.appsScript.secret;
  const workerPaused = state.worker.hasPauseGate && state.worker.paused;
  const appsScriptPaused = state.appsScript.checksPause && state.appsScript.paused;
  return workerAccepts && !workerPaused && !appsScriptPaused;
}

// Preconditions for the one step that reopens submissions. Each must hold in the state the step starts from.
export function openPreconditions(state) {
  const problems = [];
  if (!state.worker.hasIntentGuard) problems.push("the live worker revision does not enforce intents");
  if (!state.worker.requiresIntent) problems.push("REQUIRE_SUBMIT_INTENT is not yes");
  if (!state.appsScript.sendsIntent) problems.push("the live Apps Script version does not send intents");
  if (!state.appsScript.checksPause) problems.push("the live Apps Script version does not read the pause property");
  if (state.appsScript.secret !== "current" || state.worker.acceptedSecret !== "current") {
    problems.push("the worker and the Apps Script project do not both hold the current secret");
  }
  return problems;
}

// Applies one step to a copy of the state. Returns { ok, reason, state }.
// Closing steps are not special: every step must leave the paid path closed, except the open step, which may open it
// only when its preconditions hold. Deploys and rollbacks are refused while submissions are open.
export function applyStep(state, step) {
  const before = paidPathOpen(state);
  const next = JSON.parse(JSON.stringify(state));
  let problem = null;

  switch (step.type) {
    case "rotateWorkerSecret":
      next.worker.acceptedSecret = "current";
      break;
    case "pauseWorker":
      if (!next.worker.hasPauseGate) problem = "the live worker revision does not understand SUBMISSIONS_PAUSED";
      else next.worker.paused = true;
      break;
    case "setAppsScriptSecret":
      next.appsScript.secret = step.secret;
      break;
    case "setAppsScriptPaused":
      next.appsScript.paused = step.paused === true;
      break;
    case "deployWorker":
      if (before) problem = "submissions are open: close them before deploying a worker revision";
      else next.worker = Object.assign({}, step.revision);
      break;
    case "deployAppsScript":
      if (before) problem = "submissions are open: close them before deploying an Apps Script version";
      else Object.assign(next.appsScript, { checksPause: step.code.checksPause, sendsIntent: step.code.sendsIntent });
      break;
    case "enableIntent":
      if (before) problem = "enable REQUIRE_SUBMIT_INTENT only while submissions are closed";
      else if (!next.worker.hasIntentGuard) problem = "the live worker revision cannot enforce intents";
      else if (!next.appsScript.sendsIntent) problem = "the live Apps Script version does not send intents yet";
      else next.worker.requiresIntent = true;
      break;
    case "rollbackWorker":
      if (before) problem = "submissions are open: close them before rolling the worker back";
      else next.worker = Object.assign({}, step.revision);
      break;
    case "rollbackAppsScript":
      if (before) problem = "submissions are open: close them before rolling the Apps Script back";
      else Object.assign(next.appsScript, { checksPause: step.code.checksPause, sendsIntent: step.code.sendsIntent });
      break;
    case "open": {
      const missing = openPreconditions(state);
      if (missing.length) problem = "not yet: " + missing.join("; ");
      else {
        next.worker.paused = false;
        next.appsScript.paused = false;
      }
      break;
    }
    default:
      problem = "unknown step: " + step.type;
  }

  if (problem) return { ok: false, reason: problem, state };
  const after = paidPathOpen(next);
  if (after && step.type !== "open") {
    return { ok: false, reason: "this step would leave paid submissions open (" + describeOpen(next) + ")", state };
  }
  return { ok: true, reason: "ok", state: next };
}

function describeOpen(state) {
  const parts = [];
  if (state.worker.acceptedSecret === state.appsScript.secret) parts.push("the worker accepts the project's secret");
  if (!(state.worker.hasPauseGate && state.worker.paused)) parts.push("the worker is not paused");
  if (!(state.appsScript.checksPause && state.appsScript.paused)) parts.push("the Apps Script is not paused");
  return parts.join(", ");
}

// Runs a whole plan from a starting state. Returns { ok, failedAt, reason, states }; states[0] is the start.
export function runPlan(start, steps) {
  const states = [start];
  let state = start;
  for (let index = 0; index < steps.length; index++) {
    const result = applyStep(state, steps[index]);
    if (!result.ok) return { ok: false, failedAt: index, reason: result.reason, states };
    state = result.state;
    states.push(state);
  }
  return { ok: true, failedAt: -1, reason: "ok", states };
}

// The deployment as it stands: the worker accepts the legacy secret, has no pause gate and no intent guard; the Apps Script
// project holds the legacy secret, reads no pause and sends no intents. Submissions are open.
export const TODAY = Object.freeze({
  worker: { acceptedSecret: "legacy", hasIntentGuard: false, hasPauseGate: false, paused: false, requiresIntent: false },
  appsScript: { secret: "legacy", paused: false, checksPause: false, sendsIntent: false }
});

// The corrected sequence. Each step is a separate owner approval, and each leaves the paid path closed:
//   1. rotate the worker's secret (no new code; legacy callers get 401)
//   2. deploy the gated worker revision, paused, holding the current secret
//   3. set the project's secret to the current value (the worker is paused, so this stays closed)
//   4. set the project's pause property (closed by the worker's pause; the legacy code cannot read it)
//   5. deploy the new Apps Script version (reads the pause property, sends intents)
//   6. enable REQUIRE_SUBMIT_INTENT while closed
//   7. open: clear the Apps Script pause and the worker pause, only now that intents are required
export const CONTROLLED_PLAN = Object.freeze([
  { type: "rotateWorkerSecret" },
  { type: "deployWorker", revision: { acceptedSecret: "current", hasIntentGuard: true, hasPauseGate: true, paused: true, requiresIntent: false } },
  { type: "setAppsScriptSecret", secret: "current" },
  { type: "setAppsScriptPaused", paused: true },
  { type: "deployAppsScript", code: { checksPause: true, sendsIntent: true } },
  { type: "enableIntent" },
  { type: "open" }
]);
