// Pure logic for POST /jobs/status - kept separate from dispatcher.js so it's testable
// without spinning up Express or hitting the real Cloud Run Admin API/GCS. Nothing here
// makes a network call itself; buildStatusResponse() takes already-fetched facts plus an
// injected checkRunJobProgress function, so tests can stub exactly that one seam.

// Matches VideoProcessingProvider.RENDER_ID_PREFIX + Utilities.getUuid() exactly: "cr-"
// followed by a standard v4 UUID. Deliberately strict - this string becomes part of a
// GCS object path (renders/<jobId>/final.mp4), so anything this pattern rejects can
// never reach a bucket.file() call, which is what rules out path traversal or arbitrary
// object names regardless of what's later built from it.
const JOB_ID_PATTERN = /^cr-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidJobId(jobId) {
  return typeof jobId === "string" && JOB_ID_PATTERN.test(jobId);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Cloud Run v2's long-running-operation names are scoped to project + location, not to
// the specific Job that created them (projects/<p>/locations/<r>/operations/<id>) - the
// operation name alone can't prove it belongs to savannah-render-job, only that it's in
// the right project/region. That's the strongest boundary checkable before the lookup;
// see executionBelongsToJob() for the check that runs after the lookup, against the
// resulting Execution's own name (which DOES encode the Job it belongs to).
export function buildOperationNamePattern(project, region) {
  return new RegExp(`^projects/${escapeRegExp(project)}/locations/${escapeRegExp(region)}/operations/[A-Za-z0-9-]+$`);
}

export function isValidOperationName(operationName, project, region) {
  if (operationName === undefined || operationName === null || operationName === "") return true;
  if (typeof operationName !== "string") return false;
  return buildOperationNamePattern(project, region).test(operationName);
}

// An Execution resource name looks like:
//   projects/<p>/locations/<r>/jobs/<jobName>/executions/<executionId>
// - this is the actual, post-lookup correlation to savannah-render-job specifically,
// since the operation name alone (checked above) only proves project/region, not which
// Job triggered it - a caller who knows the shared bearer secret could otherwise supply
// a valid operation from a different Cloud Run Job in the same project/region and read
// its status through this endpoint.
//
// Reject-by-default: an operation this lookup can't attach an execution name to is
// treated as unverifiable, not as "assume it's ours." Empirically (this session's own
// dryRun submission), the execution name is already populated in the very first /jobs
// response - before the task has even started running - so a legitimately-ours
// operation should never actually hit this fallback in practice.
export function executionBelongsToJob(executionName, jobName) {
  if (!executionName) return false;
  return executionName.indexOf(`/jobs/${jobName}/executions/`) !== -1;
}

const CONDITION_FAILED = ["CONDITION_FAILED", 3];
const CONDITION_SUCCEEDED = ["CONDITION_SUCCEEDED", 4];
const GRPC_NOT_FOUND = 5;

// Normalizes a checkRunJobProgress()-shaped result into one of PENDING/RUNNING/SUCCEEDED/
// FAILED/UNKNOWN. succeededCount/failedCount (confirmed present on real Execution results
// from live executions this session) are the primary signal; the Completed condition is a
// secondary cross-check for when those counts are absent or zero on both sides.
export function normalizeExecutionState(polled) {
  if (!polled || !polled.done) {
    const startTime = polled && polled.metadata && polled.metadata.startTime;
    return { state: startTime ? "RUNNING" : "PENDING", failureDetail: null };
  }
  const result = polled.result || {};
  const conditions = Array.isArray(result.conditions) ? result.conditions : [];
  const completed = conditions.find((c) => c && c.type === "Completed") || null;
  const succeededCount = Number(result.succeededCount || 0);
  const failedCount = Number(result.failedCount || 0);

  if (succeededCount > 0) return { state: "SUCCEEDED", failureDetail: null };
  if (failedCount > 0 || (completed && CONDITION_FAILED.indexOf(completed.state) !== -1)) {
    return { state: "FAILED", failureDetail: (completed && completed.message) || "Execution reported failure." };
  }
  if (completed && CONDITION_SUCCEEDED.indexOf(completed.state) !== -1) {
    return { state: "SUCCEEDED", failureDetail: null };
  }
  return { state: "UNKNOWN", failureDetail: null };
}

export function evaluateProbe(probeReport) {
  return Boolean(
    probeReport && probeReport.passesResolutionGate && probeReport.passesSilenceGate && probeReport.passesBlackFrameGate
  );
}

// The full /jobs/status decision, as one pure async function: takes already-fetched
// artifactExists/probeReport plus an injected checkRunJobProgress(operationName), and
// returns either { status: 400, body } for a rejected request or { status: 200, body }
// with the normalized status payload. dispatcher.js's route handler does nothing but
// gather the real inputs and call this - all the actual decision logic lives here,
// callable and testable with zero network access.
//
// Deliberately reports facts only - no recoveryRequired or similar inferred verdict.
// The dispatcher has no visibility into whether Savannah's own row already received a
// callback, so it cannot know whether a completed artifact actually needs reconciling;
// that judgment (local Savannah row still active + valid existing artifact = delivery-
// recovery candidate) belongs entirely to the Apps Script side that has that context.
export async function buildStatusResponse({ jobId, operationName, project, region, jobName, artifactExists, probeReport, checkRunJobProgress, now }) {
  if (!isValidJobId(jobId)) {
    return { status: 400, body: { error: "jobId must match the Savannah Cloud Run render ID format (cr-<uuid>)" } };
  }
  if (!isValidOperationName(operationName, project, region)) {
    return { status: 400, body: { error: "operationName is not a valid operation for this project/region" } };
  }

  const probeExists = probeReport !== null && probeReport !== undefined;
  const probePassed = evaluateProbe(probeReport);
  let state = "UNKNOWN";
  let executionName = null;
  let failureDetail = null;

  if (operationName) {
    try {
      const polled = await checkRunJobProgress(operationName);
      const resultExecutionName = (polled.metadata && polled.metadata.name) ||
        (polled.result && polled.result.name) || null;
      if (!executionBelongsToJob(resultExecutionName, jobName)) {
        return { status: 400, body: { error: "operationName does not correlate to savannah-render-job" } };
      }
      executionName = resultExecutionName;
      const normalized = normalizeExecutionState(polled);
      state = normalized.state;
      failureDetail = normalized.failureDetail;
    } catch (error) {
      // google.rpc.Code: NOT_FOUND=5 (confirmed against the same numbering this session
      // already observed live - PERMISSION_DENIED=7 - on a real Cloud Logging error).
      // Any other code (network, quota, UNAVAILABLE, timeout, or even a permission
      // problem) is not a confirmed absence and must never be reported as FAILED - the
      // caller decides what UNKNOWN means, but it must not masquerade as a render failure.
      if (error && error.code === GRPC_NOT_FOUND) {
        state = "NOT_FOUND";
      } else {
        state = "UNKNOWN";
        failureDetail = `Status lookup failed: ${error && error.message}`;
      }
    }
  }
  // No operationName: normal for historical rows submitted before this endpoint existed.
  // Age-based staleness judgment for that case belongs to Apps Script, not here - this
  // endpoint only ever reports facts, never infers staleness itself.

  return {
    status: 200,
    body: {
      jobId,
      state,
      operationName: operationName || null,
      executionName,
      artifactExists: Boolean(artifactExists),
      probeExists,
      probePassed,
      failureDetail,
      checkedAt: (now || new Date()).toISOString()
    }
  };
}
