import "dotenv/config";
import express from "express";
import { v4 as uuid } from "uuid";
import { JobsClient, ExecutionsClient } from "@google-cloud/run";
import { dispatcherConfig } from "./dispatcherConfig.js";
import { requireAuth } from "./lib/auth.js";
import { validateBeats } from "./lib/validateBeats.js";
import { uploadJson, downloadJson, objectExists } from "./lib/storage.js";
import { buildStatusResponse } from "./lib/jobStatus.js";
import { validateMusicRequest, musicSummary } from "./lib/musicLicence.js";
import { MUSIC_MANIFEST } from "./lib/musicManifest.js";
import { MUSIC_PROTOCOL, assertRenderJobAcceptsMusic } from "./lib/renderJobGuard.js";

// This process never imports pipeline/* or any of the OpenAI/ElevenLabs/Pexels SDKs - it
// only validates a request, hands it to a Cloud Run Job execution, and responds. The
// actual rendering (and its 2GiB+ memory footprint) lives entirely in job-runner.js,
// running as a separate Cloud Run Job execution, not in this always-on Service.

const app = express();
app.use(express.json({ limit: "2mb" }));

const jobsClient = new JobsClient();
const executionsClient = new ExecutionsClient();
const jobResourceName = `projects/${dispatcherConfig.project}/locations/${dispatcherConfig.region}/jobs/${dispatcherConfig.renderJobName}`;

// Current secret first; the previous one is accepted only while JOB_SUBMIT_SECRET is being
// rotated (JOB_SUBMIT_SECRET_PREVIOUS set), so Apps Script can switch over with no 401 gap.
const acceptedSubmitSecrets = [dispatcherConfig.jobSubmitSecret, dispatcherConfig.previousJobSubmitSecret];

// Cloud Run's fully-managed platform intercepts GET /healthz before it ever reaches this
// container (confirmed via Cloud Logging: /jobs, /, and even /readyz all reach Express and
// get logged; /healthz alone returns Google's generic 404 page with zero log entry). /health
// is the real, externally-reachable path - /healthz is kept only for parity with Railway's
// server.js and any caller that still targets it directly.
// musicProtocol tells the main app which music contract this dispatcher enforces (see lib/renderJobGuard.js).
// A dispatcher without it is never sent a render request.
app.get("/healthz", (req, res) => res.status(200).json({ status: "ok", musicProtocol: MUSIC_PROTOCOL }));
app.get("/health", (req, res) => res.status(200).json({ status: "ok", musicProtocol: MUSIC_PROTOCOL }));

app.post("/jobs", requireAuth(acceptedSubmitSecrets), async (req, res) => {
  const { beats, callbackUrl, callbackSecret, dryRun } = req.body || {};
  // Music is checked here, before anything is uploaded or started: an unknown or unverified track
  // is refused without creating a Cloud Run execution, so no paid step can begin.
  const music = validateMusicRequest(req.body, MUSIC_MANIFEST);
  if (!music.ok) {
    res.status(400).json({ error: music.error });
    return;
  }
  const { musicTrackId, legacyPlaceholderMusic } = music;

  // Before anything is uploaded or started, the shared render job must run a music-verified image.
  // Otherwise an older job would play the placeholder while this request is recorded as licensed.
  try {
    await assertRenderJobAcceptsMusic({
      getJob: async () => (await jobsClient.getJob({ name: jobResourceName }))[0],
      allowedImages: dispatcherConfig.allowedRenderImages
    });
  } catch (guardError) {
    const status = guardError.code === "RENDER_IMAGE_NOT_ALLOWED" ? 409 : 503;
    console.error("Render job music check refused a request:", guardError.message);
    res.status(status).json({ error: guardError.message });
    return;
  }

  const beatsError = validateBeats(beats);
  if (beatsError) {
    res.status(400).json({ error: beatsError });
    return;
  }
  if (typeof callbackUrl !== "string" || callbackUrl.trim().length === 0) {
    res.status(400).json({ error: "callbackUrl is required" });
    return;
  }

  // Never echo the value back: a malformed secret is reported by field name only.
  if (callbackSecret !== undefined && (typeof callbackSecret !== "string" || callbackSecret.trim().length === 0)) {
    res.status(400).json({ error: "callbackSecret must be a non-empty string" });
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
      musicTrackId,
      legacyPlaceholderMusic,
      callbackUrl,
      callbackSecret,
      submittedAt: new Date().toISOString()
    });
    const [operation] = await jobsClient.runJob({
      name: jobResourceName,
      overrides: {
        containerOverrides: [{ env: overrideEnv }],
        taskCount: 1
      }
    });
    const executionName = (operation.metadata && operation.metadata.name) || null;
    // operation.name/executionName are non-secret GCP resource identifiers, not
    // request/callback content - safe to log. Persisting operationName is what lets a
    // later status check correlate back to this exact execution instead of guessing
    // from elapsed time.
    console.log(`Job ${jobId} operation created: name=${operation.name} executionName=${executionName || "(not yet available)"}`);
    // The track's summary (ID, licence, credit text) goes back to the caller, which records it with
    // the render. The upload step then carries the credit into the YouTube description.
    res.status(202).json({
      jobId,
      status: "queued",
      operationName: operation.name || null,
      executionName,
      music: music.track ? musicSummary(music.track) : null
    });
  } catch (error) {
    console.error(`Job ${jobId} failed to start:`, error);
    res.status(502).json({ jobId, error: "Failed to start render job", message: error.message });
  }
});

// Read-only: reports facts about a render's external state and GCS artifacts. Never
// mutates Savannah state (it has none to mutate), never signs URLs, never calls back to
// Apps Script, never triggers recovery - reconciliation decisions belong to Apps Script
// (a later increment), this endpoint only supplies the evidence for that decision.
app.post("/jobs/status", requireAuth(acceptedSubmitSecrets), async (req, res) => {
  const { jobId, executionName, operationName } = req.body || {};

  // Only gather artifact facts for a jobId shape that's already known-safe - avoids ever
  // building a GCS path from unvalidated input, even though buildStatusResponse() would
  // also reject a malformed jobId itself.
  const validJobIdShape = typeof jobId === "string" && /^cr-[0-9a-f-]{36}$/i.test(jobId);
  const [artifactExists, probeReport] = validJobIdShape
    ? await Promise.all([
        objectExists(`renders/${jobId}/final.mp4`),
        downloadJson(`renders/${jobId}/probe-report.json`).catch(() => null)
      ])
    : [false, null];

  const result = await buildStatusResponse({
    jobId,
    executionName,
    operationName,
    project: dispatcherConfig.project,
    region: dispatcherConfig.region,
    jobName: dispatcherConfig.renderJobName,
    artifactExists,
    probeReport,
    getExecution: async (name) => {
      const [execution] = await executionsClient.getExecution({ name });
      return execution;
    },
    checkRunJobProgress: (name) => jobsClient.checkRunJobProgress(name)
  });
  res.status(result.status).json(result.body);
});

app.listen(dispatcherConfig.port, () => {
  console.log(`savannah-media-worker-dispatcher listening on port ${dispatcherConfig.port}`);
});
