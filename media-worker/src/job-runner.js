import "dotenv/config";
import { runJob } from "./pipeline/runJob.js";
import { postCallbackWithRetry } from "./lib/callback.js";
import { downloadJson, deleteObject, jobStateStore } from "./lib/storage.js";
import { executeRenderRequest } from "./lib/renderRequest.js";
import { environmentOf, parseList } from "./lib/environment.js";

// The request handling lives in lib/renderRequest.js, where it is tested with in-memory stores. This file connects
// the real storage, job state, pipeline and callback. Staging never runs this file: it has its own entry point
// (staging-job-runner.js) with no paid pipeline, and this one refuses to run in a staging environment.
const jobId = process.env.JOB_ID;
const attemptId = process.env.ATTEMPT_ID;
if (!jobId) {
  console.error("JOB_ID env var is required");
  process.exit(1);
}
if (!attemptId) {
  // Only the dispatcher starts this job, and it always sets ATTEMPT_ID. Without it the job cannot prove it holds
  // the job state, so it refuses to start rather than run unrecorded.
  console.error(`[${jobId}] ATTEMPT_ID env var is required; refusing to run outside a recorded attempt.`);
  process.exit(1);
}
if (environmentOf(process.env) === "staging") {
  console.error("This entry point is production only; staging uses staging-job-runner.js.");
  process.exit(1);
}

const outcome = await executeRenderRequest({
  jobId,
  attemptId,
  requestPath: `job-requests/${jobId}.json`,
  storage: { downloadJson, deleteObject },
  jobStore: jobStateStore,
  runJob,
  postCallback: postCallbackWithRetry,
  dryRun: process.env.DRY_RUN === "true",
  callbackAllowlist: parseList(process.env.CALLBACK_URL_ALLOWLIST)
});
process.exit(outcome.exitCode);
