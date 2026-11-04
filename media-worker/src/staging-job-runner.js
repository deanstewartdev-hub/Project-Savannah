import "dotenv/config";
import { downloadJson, deleteObject, objectExists, downloadToFile, jobStateStore } from "./lib/storage.js";
import { postCallbackWithRetry } from "./lib/callback.js";
import { executeRenderRequest } from "./lib/renderRequest.js";
import { assertEnvironment } from "./lib/environment.js";
import { createStubPipeline } from "./lib/stubPipeline.js";
import { MUSIC_MANIFEST } from "./lib/musicManifest.js";
import { stagingTestFaults } from "./lib/stagingTestFaults.js";

// The staging render job. It runs the real request handling, job state and callback, with the stub pipeline in
// place of every paid step (narration, alignment, visuals, assembly). It never imports config.js, so it cannot
// read paid AI keys, and it refuses to start unless the staging environment checks pass.
const { callbackAllowlist } = assertEnvironment(process.env);
if (process.env.SAVANNAH_ENVIRONMENT !== "staging") {
  console.error("staging-job-runner.js runs only with SAVANNAH_ENVIRONMENT=staging.");
  process.exit(1);
}
const jobId = process.env.JOB_ID;
const attemptId = process.env.ATTEMPT_ID;
if (!jobId || !attemptId) {
  console.error("JOB_ID and ATTEMPT_ID env vars are required.");
  process.exit(1);
}

// Staging-only test controls (S5, S7). Off unless set; refused outside staging.
let faults;
try {
  faults = stagingTestFaults(process.env);
} catch (faultError) {
  console.error(faultError.message);
  process.exit(1);
}

const pipeline = createStubPipeline({
  manifest: MUSIC_MANIFEST,
  existsFn: objectExists,
  downloadFn: downloadToFile,
  minSeconds: 3,
  fail: faults.failRenderAfterMusic
});

const outcome = await executeRenderRequest({
  jobId,
  attemptId,
  requestPath: `job-requests/${jobId}.json`,
  storage: { downloadJson, deleteObject },
  jobStore: jobStateStore,
  runJob: pipeline,
  postCallback: postCallbackWithRetry,
  dryRun: process.env.DRY_RUN === "true",
  callbackAllowlist: callbackAllowlist,
  callbackTestFaults: faults.callbackTestFaults
});
process.exit(outcome.exitCode);
