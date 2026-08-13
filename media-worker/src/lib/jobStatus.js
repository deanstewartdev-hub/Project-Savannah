// Pure logic for POST /jobs/status - kept separate from dispatcher.js so it's testable
// without spinning up Express or hitting the real Cloud Run Admin API/GCS. Nothing here
// makes a network call itself; buildStatusResponse() takes already-fetched facts plus
// injected getExecution/checkRunJobProgress functions, so tests can stub exactly those
// two seams. executionName (ExecutionsClient.getExecution) is the primary lookup path;
// operationName (JobsClient.checkRunJobProgress) is a fallback for callers that don't
// have an execution name yet.

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

// Unlike the operation name pattern above, this bakes the exact Job name into the regex
// itself - stronger than a post-lookup string-contains check, since a foreign-job
// executionName is rejected before any Cloud API call is ever made, not after.
export function buildExecutionNamePattern(project, region, jobName) {
  return new RegExp(
    `^projects/${escapeRegExp(project)}/locations/${escapeRegExp(region)}/jobs/${escapeRegExp(jobName)}/executions/[A-Za-z0-9-]+$`
  );
}

export function isValidExecutionName(executionName, project, region, jobName) {
  if (executionName === undefined || executionName === null || executionName === "") return true;
  if (typeof executionName !== "string") return false;
  return buildExecutionNamePattern(project, region, jobName).test(executionName);
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
//
// Serves the operationName fallback path only (the LRO/`polled` shape - done/metadata/
// result). The executionName-primary path uses normalizeExecutionResource() below instead,
// since IExecution's own shape (completionTime/taskCount directly on the object) is
// structurally different from this LRO wrapper shape.
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

// An Execution resource's `job` field is a direct, server-asserted reference to its owning
// Job - a direct, server-asserted reference, not something parsed out of the execution's
// own name string. This is the post-lookup defense-in-depth check for the
// executionName-primary path; in practice it should be unreachable-false, since
// isValidExecutionName() already bakes the job name into the pre-lookup regex and rejects
// a foreign-job executionName before any Cloud API call - kept anyway rather than
// assume-trusting a lookup result.
//
// Mechanically confirmed live (direct Cloud Run v2 REST call against a real execution,
// not assumed): `execution.job` is the BARE Job name ("savannah-render-job"), not a
// projects/.../locations/.../jobs/<name> resource path - it carries no project or region
// segment at all. Project/region correlation is therefore already fully guaranteed by the
// pre-lookup regex in isValidExecutionName() (which requires an exact project+region+job
// match before any API call happens); this check's only remaining job is confirming the
// returned resource actually says it belongs to the expected Job name.
export function executionMatchesJob(execution, jobName) {
  if (!execution || typeof execution.job !== "string") return false;
  return execution.job === jobName;
}

// Normalizes a real IExecution resource (from ExecutionsClient.getExecution()) into one of
// PENDING/RUNNING/SUCCEEDED/FAILED/UNKNOWN. Checked most-specific-first:
//
// FAILED is checked before SUCCEEDED - a deliberate divergence from
// normalizeExecutionState()'s ordering above. Given taskCount=1/maxRetries=0 on
// savannah-render-job the two should never both be true, but if they ever are, failing
// closed is the safer default for a status endpoint whose output may inform recovery
// decisions later.
export function normalizeExecutionResource(execution) {
  const conditions = Array.isArray(execution && execution.conditions) ? execution.conditions : [];
  const completed = conditions.find((c) => c && c.type === "Completed") || null;
  const succeededCount = Number((execution && execution.succeededCount) || 0);
  const failedCount = Number((execution && execution.failedCount) || 0);
  const taskCount = Number((execution && execution.taskCount) || 0);

  if (failedCount > 0 || (completed && CONDITION_FAILED.indexOf(completed.state) !== -1)) {
    return { state: "FAILED", failureDetail: (completed && completed.message) || "Execution reported failure." };
  }
  if ((taskCount > 0 && succeededCount >= taskCount) || (completed && CONDITION_SUCCEEDED.indexOf(completed.state) !== -1)) {
    return { state: "SUCCEEDED", failureDetail: null };
  }
  if (execution && execution.completionTime) {
    // Cloud Run considers this execution finished but gave no success/failure signal this
    // code recognizes - ambiguous, not a confirmed outcome, so report the fact-gap rather
    // than silently defaulting to still-running.
    return { state: "UNKNOWN", failureDetail: "Execution completed with no resolvable success/failure signal." };
  }
  if (!execution || !execution.startTime) {
    return { state: "PENDING", failureDetail: null };
  }
  return { state: "RUNNING", failureDetail: null };
}

// Shared between both lookup paths (executionName-primary and operationName-fallback) so
// their error classification can't silently diverge on a future edit - both paths need
// identical treatment of "confirmed absent" (NOT_FOUND) vs. everything else (UNKNOWN,
// never FAILED: a transient/network/permission problem is not evidence the render failed).
export function classifyLookupError(error) {
  if (error && error.code === GRPC_NOT_FOUND) {
    return { state: "NOT_FOUND", failureDetail: null };
  }
  return { state: "UNKNOWN", failureDetail: `Status lookup failed: ${error && error.message}` };
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
// executionName is the primary identifier (its format encodes the exact Job it belongs
// to; an operation name only encodes project/region). operationName remains a fallback
// for callers that don't have an execution name yet - it's never consulted for a lookup
// when executionName is present, though it's still echoed back in the response.
export async function buildStatusResponse({ jobId, executionName, operationName, project, region, jobName, artifactExists, probeReport, getExecution, checkRunJobProgress, now }) {
  if (!isValidJobId(jobId)) {
    return { status: 400, body: { error: "jobId must match the Savannah Cloud Run render ID format (cr-<uuid>)" } };
  }
  // Both identifiers are validated unconditionally, regardless of which one ends up used
  // for the lookup - a malformed second identifier is treated as suspicious input, not
  // silently ignored.
  if (!isValidExecutionName(executionName, project, region, jobName)) {
    return { status: 400, body: { error: "executionName is not a valid execution for this project/region/job" } };
  }
  if (!isValidOperationName(operationName, project, region)) {
    return { status: 400, body: { error: "operationName is not a valid operation for this project/region" } };
  }

  const probeExists = probeReport !== null && probeReport !== undefined;
  const probePassed = evaluateProbe(probeReport);
  let state = "UNKNOWN";
  let resolvedExecutionName = executionName || null;
  let failureDetail = null;

  if (executionName) {
    try {
      const execution = await getExecution(executionName);
      if (!executionMatchesJob(execution, jobName)) {
        return { status: 400, body: { error: "executionName does not correlate to savannah-render-job" } };
      }
      const normalized = normalizeExecutionResource(execution);
      state = normalized.state;
      failureDetail = normalized.failureDetail;
    } catch (error) {
      const classified = classifyLookupError(error);
      state = classified.state;
      failureDetail = classified.failureDetail;
    }
  } else if (operationName) {
    try {
      const polled = await checkRunJobProgress(operationName);
      const resultExecutionName = (polled.metadata && polled.metadata.name) ||
        (polled.result && polled.result.name) || null;
      if (!executionBelongsToJob(resultExecutionName, jobName)) {
        return { status: 400, body: { error: "operationName does not correlate to savannah-render-job" } };
      }
      resolvedExecutionName = resultExecutionName;
      const normalized = normalizeExecutionState(polled);
      state = normalized.state;
      failureDetail = normalized.failureDetail;
    } catch (error) {
      const classified = classifyLookupError(error);
      state = classified.state;
      failureDetail = classified.failureDetail;
    }
  }
  // Neither identifier: normal for historical rows submitted before this endpoint
  // existed. Age-based staleness judgment for that case belongs to Apps Script, not
  // here - this endpoint only ever reports facts, never infers staleness itself.

  return {
    status: 200,
    body: {
      jobId,
      state,
      operationName: operationName || null,
      executionName: resolvedExecutionName,
      artifactExists: Boolean(artifactExists),
      probeExists,
      probePassed,
      failureDetail,
      checkedAt: (now || new Date()).toISOString()
    }
  };
}
