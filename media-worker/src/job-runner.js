import "dotenv/config";
import { runJob } from "./pipeline/runJob.js";
import { postCallback } from "./lib/callback.js";
import { downloadJson, deleteObject } from "./lib/storage.js";

// One Cloud Run Job execution handles exactly one render: read its request from GCS
// (written by dispatcher.js), run the unchanged pipeline, post the unchanged callback
// shape, exit. Render failure and callback-delivery failure are kept as two separate
// outcomes here, matching routes/jobs.js's existing behavior exactly - a render that
// succeeds but whose callback POST fails must never be reported to Apps Script as a
// failed render.

const jobId = process.env.JOB_ID;
if (!jobId) {
  console.error("JOB_ID env var is required");
  process.exit(1);
}

const requestPath = `job-requests/${jobId}.json`;

function parseJobRequest(raw) {
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
    musicTrackPath: raw.musicTrackPath,
    callbackUrl: raw.callbackUrl
  };
}

const raw = await downloadJson(requestPath);
const request = parseJobRequest(raw);

if (process.env.DRY_RUN === "true") {
  console.log(`[${jobId}] dry-run: loaded ${requestPath}, beats=${request.beats.length}`);
  process.exit(0);
}

await deleteObject(requestPath);

try {
  const result = await runJob({ jobId, beats: request.beats, musicTrackPath: request.musicTrackPath });
  await postCallback(request.callbackUrl, result).catch((callbackError) => {
    console.error(`Job ${jobId} succeeded, but delivering its callback failed:`, callbackError);
  });
  process.exit(0);
} catch (renderError) {
  console.error(`Job ${jobId} failed:`, renderError);
  await postCallback(request.callbackUrl, {
    jobId,
    status: "failed",
    error: { message: renderError.message }
  }).catch((callbackError) => {
    console.error(`Job ${jobId} failed, and delivering that failure's callback also failed:`, callbackError);
  });
  process.exit(1);
}
