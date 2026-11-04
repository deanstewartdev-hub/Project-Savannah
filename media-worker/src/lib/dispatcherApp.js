import express from "express";
import { v4 as uuid } from "uuid";
import { requireAuth } from "./auth.js";
import { validateBeats } from "./validateBeats.js";
import { validateMusicRequest, musicSummary } from "./musicLicence.js";
import { MUSIC_PROTOCOL, assertRenderJobAcceptsMusic } from "./renderJobGuard.js";
import { buildStatusResponse as defaultBuildStatusResponse } from "./jobStatus.js";
import { reserveJob, failBeforeStart, markUncertain, recoverJob, recoveryConfirmation, JOB_STATES } from "./jobState.js";
import { callbackAllowed } from "./environment.js";

// The dispatcher's HTTP surface, separated from its Cloud Run, Cloud Storage and job-state clients so the same
// code is tested in isolation. dispatcher.js passes the real clients; nothing here imports Google Cloud.
//
// Duplicate protection (see jobState.js): a submission first reserves its jobId with a create-only write. Only one
// caller can win that write, so two simultaneous submissions cannot both start an execution. The reservation
// outlives the request payload, so the payload can be deleted without losing protection. A job that failed,
// was uncertain, or was interrupted restarts only through POST /jobs/recover, with an explicit confirmation.
//
// Definite refusals from Cloud Run (the execution was never created) end the attempt as failed. Anything else
// (timeouts, unavailable, internal errors) leaves the job uncertain: it is never restarted automatically.
const DEFINITE_NOT_STARTED = new Set([3, 5, 7, 9, 16, 400, 401, 403, 404]);

export function definitelyNotStarted(error) {
  return !!error && DEFINITE_NOT_STARTED.has(error.code);
}

export function createDispatcherApp({
  config,
  jobsClient,
  executionsClient,
  storage,
  jobStore,
  manifest,
  buildStatusResponse = defaultBuildStatusResponse,
  now = () => new Date().toISOString(),
  log = console
}) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  const jobResourceName = `projects/${config.project}/locations/${config.region}/jobs/${config.renderJobName}`;
  const requestPathOf = (jobId) => config.jobRequestPrefix + jobId + ".json";

  // Current secret first; the previous one is accepted only while JOB_SUBMIT_SECRET is being rotated.
  const acceptedSubmitSecrets = [config.jobSubmitSecret, config.previousJobSubmitSecret];

  // /health reports the contract (musicProtocol) and the identity of this deployment. The staging verifier requires
  // environment, project and service to match what it was told to expect, so a staging check cannot run against
  // a production deployment that merely has "staging" in its hostname.
  const health = (req, res) => res.status(200).json({
    status: "ok",
    musicProtocol: MUSIC_PROTOCOL,
    environment: config.environment || "production",
    project: config.project,
    service: config.serviceName || ""
  });
  app.get("/healthz", health);
  app.get("/health", health);

  // Validates everything before the job state or storage is touched. Returns { error, status } or { fields }.
  function validateSubmission(body) {
    const { beats, callbackUrl, callbackSecret, dryRun } = body || {};
    const music = validateMusicRequest(body, manifest);
    if (!music.ok) return { status: 400, error: music.error };
    const beatsError = validateBeats(beats);
    if (beatsError) return { status: 400, error: beatsError };
    if (typeof callbackUrl !== "string" || callbackUrl.trim().length === 0) return { status: 400, error: "callbackUrl is required" };
    if (!callbackAllowed(callbackUrl, config.callbackUrlAllowlist)) {
      return { status: 400, error: "callbackUrl is not an allowed endpoint for this environment." };
    }
    // Never echo the value back: a malformed secret is reported by field name only.
    if (callbackSecret !== undefined && (typeof callbackSecret !== "string" || callbackSecret.trim().length === 0)) {
      return { status: 400, error: "callbackSecret must be a non-empty string" };
    }
    const jobId = body.jobId || uuid();
    // A jobId names storage paths, so it must be a plain identifier.
    if (typeof jobId !== "string" || !/^[A-Za-z0-9-]{8,80}$/.test(jobId)) {
      return { status: 400, error: "jobId must be 8 to 80 letters, digits or hyphens." };
    }
    return { fields: { jobId, beats, callbackUrl, callbackSecret, dryRun: dryRun === true, music: music } };
  }

  // Refuses any job whose video was already delivered, and any jobId with a request still waiting. These checks
  // also cover jobs recorded before job states existed. A storage error refuses the submission (fails closed).
  async function legacyDuplicate(jobId) {
    const [requestWaiting, videoDelivered] = await Promise.all([
      storage.objectExists(requestPathOf(jobId)),
      storage.objectExists(`renders/${jobId}/final.mp4`)
    ]);
    return requestWaiting || videoDelivered;
  }

  async function checkRenderImage(res) {
    try {
      await assertRenderJobAcceptsMusic({
        getJob: async () => (await jobsClient.getJob({ name: jobResourceName }))[0],
        allowedImages: config.allowedRenderImages
      });
      return true;
    } catch (guardError) {
      const status = guardError.code === "RENDER_IMAGE_NOT_ALLOWED" ? 409 : 503;
      log.error("Render job music check refused a request:", guardError.message);
      res.status(status).json({ error: guardError.message });
      return false;
    }
  }

  // Writes the request, then starts the execution with this attempt's ID. Every failure path records its state.
  async function startExecution(res, fields, attemptId) {
    const { jobId } = fields;
    const requestPath = requestPathOf(jobId);
    try {
      await storage.uploadJson(requestPath, {
        jobId,
        beats: fields.beats,
        musicTrackId: fields.music.musicTrackId,
        legacyPlaceholderMusic: fields.music.legacyPlaceholderMusic,
        callbackUrl: fields.callbackUrl,
        callbackSecret: fields.callbackSecret,
        submittedAt: now()
      });
    } catch (error) {
      log.error(`Job ${jobId} request could not be stored:`, error);
      await failBeforeStart(jobStore, jobId, attemptId, "The job request could not be stored.", now()).catch((e) => log.error("state not recorded:", e));
      res.status(503).json({ jobId, error: "The job request could not be stored; no render was started.", state: JOB_STATES.FAILED });
      return;
    }

    const overrideEnv = [{ name: "JOB_ID", value: jobId }, { name: "ATTEMPT_ID", value: attemptId }];
    if (fields.dryRun) overrideEnv.push({ name: "DRY_RUN", value: "true" });
    try {
      const [operation] = await jobsClient.runJob({
        name: jobResourceName,
        overrides: { containerOverrides: [{ env: overrideEnv }], taskCount: 1 }
      });
      const executionName = (operation.metadata && operation.metadata.name) || null;
      log.log(`Job ${jobId} operation created: name=${operation.name} executionName=${executionName || "(not yet available)"}`);
      res.status(202).json({
        jobId,
        status: "queued",
        operationName: operation.name || null,
        executionName,
        music: fields.music.track ? musicSummary(fields.music.track) : null
      });
    } catch (error) {
      if (definitelyNotStarted(error)) {
        log.error(`Job ${jobId} was not started:`, error);
        await failBeforeStart(jobStore, jobId, attemptId, "Cloud Run did not start the render job: " + error.message, now())
          .catch((e) => log.error("state not recorded:", e));
        await storage.deleteObject(requestPath).catch((e) => log.error("request not removed:", e));
        res.status(502).json({ jobId, error: "Failed to start render job; nothing started.", state: JOB_STATES.FAILED });
        return;
      }
      // Unknown outcome: the execution may exist. It is never restarted automatically.
      log.error(`Job ${jobId} start outcome is unknown:`, error);
      await markUncertain(jobStore, jobId, attemptId, "Cloud Run did not confirm the render job: " + error.message, now())
        .catch((e) => log.error("state not recorded:", e));
      res.status(502).json({
        jobId,
        error: "Cloud Run did not confirm the render job, so it may or may not be running. Do not resubmit; use the explicit recovery operation after checking.",
        state: JOB_STATES.UNCERTAIN
      });
    }
  }

  app.post("/jobs", requireAuth(acceptedSubmitSecrets), async (req, res) => {
    const checked = validateSubmission(req.body);
    if (checked.error) {
      res.status(checked.status).json({ error: checked.error });
      return;
    }
    const fields = checked.fields;
    if (!(await checkRenderImage(res))) return;
    try {
      if (await legacyDuplicate(fields.jobId)) {
        res.status(409).json({ error: "This jobId was already submitted. No render was started." });
        return;
      }
    } catch (error) {
      log.error("Duplicate check failed; no render was started:", error);
      res.status(503).json({ error: "Could not check the jobId; no render was started." });
      return;
    }
    const attemptId = uuid();
    let reservation;
    try {
      reservation = await reserveJob(jobStore, { jobId: fields.jobId, attemptId, now: now() });
    } catch (error) {
      log.error("Job state could not be reserved; no render was started:", error);
      res.status(503).json({ error: "Could not reserve the jobId; no render was started." });
      return;
    }
    if (!reservation.reserved) {
      const state = reservation.existing ? reservation.existing.status : "unknown";
      res.status(409).json({
        error: "This jobId has already been submitted. No render was started. A failed or uncertain job needs the explicit recovery operation.",
        state: state
      });
      return;
    }
    await startExecution(res, fields, attemptId);
  });

  // Explicit recovery: the only way to start a job again with the same ID. It needs the exact confirmation phrase
  // (it states that no execution is running), a job that is not succeeded, and no delivered video.
  app.post("/jobs/recover", requireAuth(acceptedSubmitSecrets), async (req, res) => {
    const jobId = req.body && req.body.jobId;
    const checked = validateSubmission(req.body);
    if (checked.error) {
      res.status(checked.status).json({ error: checked.error });
      return;
    }
    if (typeof jobId !== "string" || (req.body.confirm !== recoveryConfirmation(jobId))) {
      res.status(400).json({ error: "Recovery needs the confirmation phrase: \"" + (typeof jobId === "string" ? recoveryConfirmation(jobId) : "restart <jobId>: no execution is running") + "\"." });
      return;
    }
    if (!(await checkRenderImage(res))) return;
    try {
      if (await storage.objectExists(`renders/${jobId}/final.mp4`)) {
        res.status(409).json({ error: "This job's video was already delivered. Recovery would render it again, so it is refused." });
        return;
      }
    } catch (error) {
      res.status(503).json({ error: "Could not check the job's delivered video; nothing was recovered." });
      return;
    }
    const attemptId = uuid();
    let recovered;
    try {
      recovered = await recoverJob(jobStore, jobId, attemptId, req.body.confirm, now());
    } catch (error) {
      res.status(503).json({ error: "Could not record the recovery; nothing was started." });
      return;
    }
    if (!recovered.ok) {
      res.status(409).json({ error: "The job cannot be recovered from its current state (" + recovered.reason + "). Nothing was started." });
      return;
    }
    await startExecution(res, checked.fields, attemptId);
  });

  // Read-only: reports facts about a render's external state and GCS artifacts.
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
