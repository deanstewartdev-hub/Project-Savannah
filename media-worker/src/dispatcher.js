import "dotenv/config";
import express from "express";
import { v4 as uuid } from "uuid";
import { JobsClient } from "@google-cloud/run";
import { dispatcherConfig } from "./dispatcherConfig.js";
import { requireAuth } from "./lib/auth.js";
import { validateBeats } from "./lib/validateBeats.js";
import { uploadJson } from "./lib/storage.js";

// This process never imports pipeline/* or any of the OpenAI/ElevenLabs/Pexels SDKs - it
// only validates a request, hands it to a Cloud Run Job execution, and responds. The
// actual rendering (and its 2GiB+ memory footprint) lives entirely in job-runner.js,
// running as a separate Cloud Run Job execution, not in this always-on Service.

const app = express();
app.use(express.json({ limit: "2mb" }));

const jobsClient = new JobsClient();
const jobResourceName = `projects/${dispatcherConfig.project}/locations/${dispatcherConfig.region}/jobs/${dispatcherConfig.renderJobName}`;

// Cloud Run's fully-managed platform intercepts GET /healthz before it ever reaches this
// container (confirmed via Cloud Logging: /jobs, /, and even /readyz all reach Express and
// get logged; /healthz alone returns Google's generic 404 page with zero log entry). /health
// is the real, externally-reachable path - /healthz is kept only for parity with Railway's
// server.js and any caller that still targets it directly.
app.get("/healthz", (req, res) => res.status(200).json({ status: "ok" }));
app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

app.post("/jobs", requireAuth(dispatcherConfig.jobSubmitSecret), (req, res) => {
  const { beats, musicTrackPath, callbackUrl } = req.body || {};

  const beatsError = validateBeats(beats);
  if (beatsError) {
    res.status(400).json({ error: beatsError });
    return;
  }
  if (typeof callbackUrl !== "string" || callbackUrl.trim().length === 0) {
    res.status(400).json({ error: "callbackUrl is required" });
    return;
  }

  const jobId = req.body.jobId || uuid();
  res.status(202).json({ jobId, status: "queued" });

  // Deliberately not awaited past acceptance: uploadJson + runJob's initial call both
  // resolve quickly (the request lands in GCS, the execution gets created), and we never
  // await the execution's own completion - that happens on the Job's own time, entirely
  // decoupled from this HTTP response, which is the whole point of the dispatcher/Job split.
  uploadJson(`${dispatcherConfig.jobRequestPrefix}${jobId}.json`, {
    jobId,
    beats,
    musicTrackPath,
    callbackUrl,
    submittedAt: new Date().toISOString()
  })
    .then(() =>
      jobsClient.runJob({
        name: jobResourceName,
        overrides: {
          containerOverrides: [{ env: [{ name: "JOB_ID", value: jobId }] }],
          taskCount: 1
        }
      })
    )
    .catch((error) => {
      // The 202 has already gone out, so there's nothing left to return to the caller -
      // this is the one failure mode Apps Script can't learn about synchronously. Loud
      // logging is the only recourse; a stuck job-requests/<jobId>.json with no matching
      // execution is the visible symptom to watch for.
      console.error(`Job ${jobId} failed to reach the render Job:`, error);
    });
});

app.listen(dispatcherConfig.port, () => {
  console.log(`savannah-media-worker-dispatcher listening on port ${dispatcherConfig.port}`);
});
