// Persistent job state for duplicate-render protection. Each jobId has one state object (job-states/<jobId>.json)
// that outlives the request payload, so deleting the payload never removes duplicate protection.
//
// Every write is conditional on Cloud Storage generations, so two writers can never both succeed:
//   - reserveJob creates the object only if it is absent (ifGenerationMatch 0);
//   - every later change replaces the object only if the generation read is still current.
// A change is also tied to an attempt ID: only the attempt that holds the state can start, finish or fail it.
// A new attempt exists only through recoverJob, which needs an explicit confirmation phrase.
//
// The store is injected: the GCS store lives in storage.js; tests use an in-memory store with the same contract:
//   read(path)                      -> null | { value, generation }
//   createIfAbsent(path, value)     -> { ok: true } | { ok: false, reason: "exists" }   (other errors throw)
//   replaceIfGeneration(path, value, generation) -> { ok: true } | { ok: false, reason: "changed" }   (other errors throw)

export const JOB_STATES = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  UNCERTAIN: "uncertain"
});

// States from which an explicit recovery may start a new attempt. A succeeded job is never recoverable.
// "running" covers an interrupted process; the confirmation phrase says the operator checked that no execution is left.
const RECOVERABLE = [JOB_STATES.QUEUED, JOB_STATES.FAILED, JOB_STATES.UNCERTAIN, JOB_STATES.RUNNING];
const HISTORY_LIMIT = 20;

export function statePath(jobId) {
  return "job-states/" + jobId + ".json";
}

export function recoveryConfirmation(jobId) {
  return "restart " + jobId + ": no execution is running";
}

function newRecord(jobId, attemptId, status, now) {
  return {
    jobId: jobId,
    status: status,
    attemptId: attemptId,
    error: "",
    videoUrl: "",
    history: [{ at: now, status: status, attemptId: attemptId }]
  };
}

function withHistory(record, status, attemptId, now, extra) {
  const history = record.history.concat([{ at: now, status: status, attemptId: attemptId }]).slice(-HISTORY_LIMIT);
  return Object.assign({}, record, { status: status, attemptId: attemptId, history: history }, extra || {});
}

// Reads the state, applies `next` only if the status and attempt still match, and writes it back only if the
// generation read is still current. Returns { ok, reason, record }. Storage errors throw to the caller.
async function change(store, jobId, expectedStatuses, attemptId, next) {
  const current = await store.read(statePath(jobId));
  if (!current) return { ok: false, reason: "missing" };
  const record = current.value;
  if (expectedStatuses.indexOf(record.status) === -1) return { ok: false, reason: "status", record: record };
  if (attemptId !== null && record.attemptId !== attemptId) return { ok: false, reason: "attempt", record: record };
  const updated = next(record);
  const written = await store.replaceIfGeneration(statePath(jobId), updated, current.generation);
  if (!written.ok) return { ok: false, reason: "changed", record: record };
  return { ok: true, record: updated };
}

// Creates the state for a new submission. Only one caller can create it; the others get { reserved: false }.
export async function reserveJob(store, { jobId, attemptId, now }) {
  const record = newRecord(jobId, attemptId, JOB_STATES.QUEUED, now);
  const created = await store.createIfAbsent(statePath(jobId), record);
  if (created.ok) return { reserved: true, record: record };
  const existing = await store.read(statePath(jobId));
  return { reserved: false, existing: existing ? existing.value : null };
}

// The execution calls this before doing any work. Refused unless this attempt holds a queued reservation.
export function startAttempt(store, jobId, attemptId, now) {
  return change(store, jobId, [JOB_STATES.QUEUED], attemptId, function (record) {
    return withHistory(record, JOB_STATES.RUNNING, attemptId, now);
  });
}

// Records the outcome of a running attempt. Terminal: succeeded or failed.
export function finishAttempt(store, jobId, attemptId, outcome, now) {
  const status = outcome.status === JOB_STATES.SUCCEEDED ? JOB_STATES.SUCCEEDED : JOB_STATES.FAILED;
  return change(store, jobId, [JOB_STATES.RUNNING], attemptId, function (record) {
    return withHistory(record, status, attemptId, now, {
      error: String(outcome.error || "").slice(0, 500),
      videoUrl: String(outcome.videoUrl || "")
    });
  });
}

// The dispatcher calls this when Cloud Run definitely did not start the execution.
export function failBeforeStart(store, jobId, attemptId, message, now) {
  return change(store, jobId, [JOB_STATES.QUEUED], attemptId, function (record) {
    return withHistory(record, JOB_STATES.FAILED, attemptId, now, { error: String(message || "").slice(0, 500) });
  });
}

// The dispatcher calls this when it cannot tell whether an execution was created. The job is never restarted
// automatically; only an explicit recovery can start it again.
export function markUncertain(store, jobId, attemptId, message, now) {
  return change(store, jobId, [JOB_STATES.QUEUED, JOB_STATES.RUNNING], attemptId, function (record) {
    return withHistory(record, JOB_STATES.UNCERTAIN, attemptId, now, { error: String(message || "").slice(0, 500) });
  });
}

// Explicit recovery: a new attempt ID for a job that is not succeeded. Requires the exact confirmation phrase.
export async function recoverJob(store, jobId, newAttemptId, confirmation, now) {
  if (confirmation !== recoveryConfirmation(jobId)) return { ok: false, reason: "confirmation" };
  return change(store, jobId, RECOVERABLE, null, function (record) {
    return withHistory(record, JOB_STATES.QUEUED, newAttemptId, now, { error: "", videoUrl: "" });
  });
}
