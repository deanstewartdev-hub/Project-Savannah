// One Cloud Run Job execution handles exactly one attempt at one render. The order matters:
//   1. the attempt must hold the job's state (queued -> running), or nothing runs;
//   2. the request is read, the callback endpoint is checked against this environment's allowlist, and the request
//      payload is deleted (duplicate protection is the job state, so the payload is not needed any more);
//   3. the pipeline runs, and the outcome is recorded in the job state before the callback is posted.
// Render failure and callback-delivery failure are separate outcomes: a render that succeeds but whose callback
// POST fails must never be reported to Apps Script as a failed render.
//
// Everything that touches the outside world is passed in, so the same code is tested with in-memory stores.

import { startAttempt, finishAttempt, JOB_STATES } from "./jobState.js";
import { callbackAllowed } from "./environment.js";

export function parseJobRequest(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("job request is not an object");
  }
  if (!Array.isArray(raw.beats) || raw.beats.length === 0) {
    throw new Error("job request has no beats");
  }
  if (typeof raw.callbackUrl !== "string" || raw.callbackUrl.trim().length === 0) {
    throw new Error("job request has no callbackUrl");
  }
  return {
    beats: raw.beats,
    musicTrackId: raw.musicTrackId,
    legacyPlaceholderMusic: raw.legacyPlaceholderMusic === true,
    callbackUrl: raw.callbackUrl,
    callbackSecret: typeof raw.callbackSecret === "string" && raw.callbackSecret.length > 0 ? raw.callbackSecret : undefined
  };
}

// Records the outcome. A failure to record is logged, not thrown: the render result is real either way, and the
// job state stays "running" (which blocks any duplicate until an explicit recovery) rather than being guessed.
async function recordOutcome(jobStore, jobId, attemptId, outcome, now, log) {
  try {
    const recorded = await finishAttempt(jobStore, jobId, attemptId, outcome, now());
    if (!recorded.ok) log.error(`[${jobId}] outcome not recorded: state is ${recorded.reason}`);
  } catch (error) {
    log.error(`[${jobId}] outcome could not be written to the job state; it stays running until recovered:`, error);
  }
}

// Returns { status, exitCode }: "dry-run", "completed", "failed", or "refused" (another attempt holds the job).
// Storage errors reading the request are thrown, so the caller exits non-zero before anything runs.
export async function executeRenderRequest({
  jobId,
  attemptId,
  requestPath,
  storage,
  jobStore,
  runJob,
  postCallback,
  dryRun = false,
  callbackAllowlist = [],
  now = () => new Date().toISOString(),
  log = console
}) {
  if (dryRun) {
    const request = parseJobRequest(await storage.downloadJson(requestPath));
    log.log(`[${jobId}] dry-run: loaded ${requestPath}, beats=${request.beats.length}`);
    return { status: "dry-run", exitCode: 0 };
  }

  const started = await startAttempt(jobStore, jobId, attemptId, now());
  if (!started.ok) {
    log.error(`[${jobId}] not started: the job state does not allow this attempt (${started.reason}).`);
    return { status: "refused", exitCode: 1, reason: started.reason };
  }

  let request;
  try {
    request = parseJobRequest(await storage.downloadJson(requestPath));
  } catch (error) {
    await recordOutcome(jobStore, jobId, attemptId, { status: JOB_STATES.FAILED, error: "The job request could not be read: " + error.message }, now, log);
    return { status: "failed", exitCode: 1 };
  }

  if (!callbackAllowed(request.callbackUrl, callbackAllowlist)) {
    // Refused before any work: this environment may not post to that endpoint, so nothing is rendered or sent.
    await recordOutcome(jobStore, jobId, attemptId, { status: JOB_STATES.FAILED, error: "The callback endpoint is not allowed in this environment." }, now, log);
    return { status: "failed", exitCode: 1 };
  }

  try {
    await storage.deleteObject(requestPath);
  } catch (error) {
    // The job state still blocks a duplicate, so a payload that cannot be deleted is logged, not fatal.
    log.error(`[${jobId}] the request payload could not be deleted; the job state still protects this jobId:`, error);
  }

  const callbackOptions = { callbackSecret: request.callbackSecret };
  let result;
  try {
    result = await runJob({
      jobId,
      beats: request.beats,
      musicTrackId: request.musicTrackId,
      legacyPlaceholderMusic: request.legacyPlaceholderMusic
    });
  } catch (renderError) {
    log.error(`Job ${jobId} failed:`, renderError);
    await recordOutcome(jobStore, jobId, attemptId, { status: JOB_STATES.FAILED, error: renderError.message }, now, log);
    await postCallback(request.callbackUrl, {
      jobId,
      status: "failed",
      error: { message: renderError.message }
    }, callbackOptions).catch((callbackError) => {
      log.error(`Job ${jobId} failed, and delivering that failure's callback also failed:`, callbackError);
    });
    return { status: "failed", exitCode: 1 };
  }

  await recordOutcome(jobStore, jobId, attemptId, { status: JOB_STATES.SUCCEEDED, videoUrl: result.video && result.video.url }, now, log);
  await postCallback(request.callbackUrl, result, callbackOptions).catch((callbackError) => {
    log.error(`Job ${jobId} succeeded, but delivering its callback failed:`, callbackError);
  });
  return { status: "completed", exitCode: 0 };
}
