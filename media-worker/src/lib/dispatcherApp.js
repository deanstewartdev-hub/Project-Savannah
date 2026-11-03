import express from "express";
import { v4 as uuid } from "uuid";
import { requireAuth } from "./auth.js";
import { validateBeats } from "./validateBeats.js";
import { validateMusicRequest, musicSummary } from "./musicLicence.js";
import { MUSIC_PROTOCOL, assertRenderJobAcceptsMusic } from "./renderJobGuard.js";
import { buildStatusResponse as defaultBuildStatusResponse } from "./jobStatus.js";

// The dispatcher's HTTP surface, separated from its Cloud Run and Cloud Storage clients so the same code can
// be tested in isolation (node-tests and media-worker/test/dispatcherIntegration.test.js). dispatcher.js
// passes the real clients; nothing here imports Google Cloud.
//
// This process never imports pipeline/* or any of the OpenAI/ElevenLabs/Pexels SDKs - it only validates a
// request, hands it to a Cloud Run Job execution, and responds. Rendering lives in the job runner.
export function createDispatcherApp({
  config,
  jobsClient,
  executionsClient,
  storage,
  manifest,
  buildStatusResponse = defaultBuildStatusResponse
}) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  const jobResourceName = `projects/${config.project}/locations/${config.region}/jobs/${config.renderJobName}`;

  // Current secret first; the previous one is accepted only while JOB_SUBMIT_SECRET is being
  // rotated (JOB_SUBMIT_SECRET_PREVIOUS set), so Apps Script can switch over with no 401 gap.
  const acceptedSubmitSecrets = [config.jobSubmitSecret, config.previousJobSubmitSecret];

  // Cloud Run's fully-managed platform intercepts GET /healthz before it ever reaches this container, so
  // /health is the externally reachable path; /healthz is kept for parity with server.js.
  // musicProtocol tells the main app which music contract this dispatcher enforces (see lib/renderJobGuard.js).
  // A dispatcher without it is never sent a render request.
  app.get("/healthz", (req, res) => res.status(200).json({ status: "ok", musicProtocol: MUSIC_PROTOCOL }));
  app.get("/health", (req, res) => res.status(200).json({ status: "ok", musicProtocol: MUSIC_PROTOCOL }));

  app.post("/jobs", requireAuth(acceptedSubmitSecrets), async (req, res) => {
    const { beats, callbackUrl, callbackSecret, dryRun } = req.body || {};
    // Music is checked here, before anything is uploaded or started: an unknown or unverified track
    // is refused without creating a Cloud Run execution, so no paid step can begin.
    const music = validateMusicRequest(req.body, manifest);
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
        allowedImages: config.allowedRenderImages
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

    // A 202 must mean "the Cloud Run Admin API accepted creation of the Job execution", not just "the
    // dispatcher received the request". Awaiting runJob() here waits only for the execution to be created.
    const overrideEnv = [{ name: "JOB_ID", value: jobId }];
    if (dryRun === true) {
      overrideEnv.push({ name: "DRY_RUN", value: "true" });
    }

    try {
      await storage.uploadJson(`${config.jobRequestPrefix}${jobId}.json`, {
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
      // operation.name/executionName are non-secret GCP resource identifiers, safe to log.
      console.log(`Job ${jobId} operation created: name=${operation.name} executionName=${executionName || "(not yet available)"}`);
      // The track's summary (ID, licence, credit text) goes back to the caller, which records it with the render.
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

  // Read-only: reports facts about a render's external state and GCS artifacts. Never mutates state,
  // never calls back to Apps Script; reconciliation decisions belong to Apps Script.
  app.post("/jobs/status", requireAuth(acceptedSubmitSecrets), async (req, res) => {
    const { jobId, executionName, operationName } = req.body || {};

    // Only gather artifact facts for a jobId shape that's already known-safe.
    const validJobIdShape = typeof jobId === "string" && /^cr-[0-9a-f-]{36}$/i.test(jobId);
    const [artifactExists, probeReport] = validJobIdShape
      ? await Promise.all([
          storage.objectExists(`renders/${jobId}/final.mp4`),
          storage.downloadJson(`renders/${jobId}/probe-report.json`).catch(() => null)
        ])
      : [false, null];

    const result = await buildStatusResponse({
      jobId,
      executionName,
      operationName,
      project: config.project,
      region: config.region,
      jobName: config.renderJobName,
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

  return app;
}
