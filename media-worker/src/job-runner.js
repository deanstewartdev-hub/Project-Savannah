import "dotenv/config";
import { runJob } from "./pipeline/runJob.js";
import { postCallbackWithRetry } from "./lib/callback.js";
import { downloadJson, deleteObject } from "./lib/storage.js";
import { executeRenderRequest } from "./lib/renderRequest.js";

// The request handling lives in lib/renderRequest.js, where it is tested with in-memory storage. This file
// connects the real storage, pipeline and callback, and exits with the outcome's exit code.
const jobId = process.env.JOB_ID;
if (!jobId) {
  console.error("JOB_ID env var is required");
  process.exit(1);
}

const outcome = await executeRenderRequest({
  jobId,
  requestPath: `job-requests/${jobId}.json`,
  storage: { downloadJson, deleteObject },
  runJob,
  postCallback: postCallbackWithRetry,
  dryRun: process.env.DRY_RUN === "true"
});
process.exit(outcome.exitCode);
