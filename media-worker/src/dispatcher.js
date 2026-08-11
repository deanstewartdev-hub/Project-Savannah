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

app.post("/jobs", requireAuth(dispatcherConfig.jobSubmitSecret), async (req, res) => {
  const { beats, musicTrackPath, callbackUrl, dryRun } = req.body || {};

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

  // A 202 must mean "the Cloud Run Admin API accepted creation of the Job execution",
  // not just "the dispatcher received the request" - a fire-and-forget runJob() call
  // that failed after the response was already sent (e.g. a missing IAM permission)
  // is a failure mode the caller can never learn about. Awaiting runJob() here only
  // waits for the execution to be *created* (the initial LRO call), never for the
  // render itself to finish - that still happens entirely on the Job's own time.
  const overrideEnv = [{ name: "JOB_ID", value: jobId }];
  if (dryRun === true) {
    overrideEnv.push({ name: "DRY_RUN", value: "true" });
  }

  try {
    await uploadJson(`${dispatcherConfig.jobRequestPrefix}${jobId}.json`, {
      jobId,
      beats,
      musicTrackPath,
      callbackUrl,
      submittedAt: new Date().toISOString()
    });
    await jobsClient.runJob({
      name: jobResourceName,
      overrides: {
        containerOverrides: [{ env: overrideEnv }],
        taskCount: 1
      }
    });
    res.status(202).json({ jobId, status: "queued" });
  } catch (error) {
    console.error(`Job ${jobId} failed to start:`, error);
    res.status(502).json({ jobId, error: "Failed to start render job", message: error.message });
  }
});

app.listen(dispatcherConfig.port, () => {
  console.log(`savannah-media-worker-dispatcher listening on port ${dispatcherConfig.port}`);
});
