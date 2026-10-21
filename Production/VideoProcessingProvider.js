/****************************************************
 * Project Savannah v1.4 - video processing provider abstraction.
 *
 * See section 4 of SAVANNAH_AUDIT_AND_PLAN.md and ROADMAP.md (v1.4). Two
 * implementations of one interface:
 *
 * - CloudRunFFmpegProvider: new default. Submits a job to savannah-media-worker
 *   and waits for its webhook callback (see media-worker/README.md).
 * - CreatomateProviderAdapter: wraps the existing CreatomateService unchanged.
 *   Kept only until the first Cloud Run render is verified good (see
 *   APPROVALS_REQUIRED.md), then deleted along with Creatomate_Service.js.
 *
 * Interface every provider implements:
 *   testConnection() -> { connected, ... }
 *   submitRender(script, seoPack) -> { render: { id, status, progress, url,
 *     snapshot_url, error_message }, payload }
 *   getRender(job) -> same shape as submitRender().render, refreshed
 *
 * `job.renderId` doubles as the provider tag so no render-job schema change is
 * needed: CloudRunFFmpegProvider renderIds are always prefixed "cr-".
 *
 * CloudRunFFmpegProvider's render/getRender shape carries two extra, Cloud-Run-only
 * fields that ProductionController stores verbatim as providerResponse (see
 * RenderJobRepository — no Sheet schema change, this all lives inside the existing
 * "Response JSON" column):
 *   cloudRun: { executionName, operationName, lastObservedState, lastExternalProgressAt }
 *   reconciliation: { reason, reconciledAt, evidence } | null
 * getRender() calls the dispatcher's real POST /jobs/status (Increment 1) and turns its
 * factual response into a status/reconciliation decision via reconcileStatus_() — see that
 * function for the full up-to-date rulebook (FAILED/SUCCEEDED-with-artifact never auto-
 * expose a re-render, UNKNOWN/NOT_FOUND never terminally transition, createdAt-only
 * staleness for identifier-less historical rows).
 ****************************************************/
const VideoProcessingProvider = (() => {
  const RENDER_ID_PREFIX = "cr-";

  function get(name) {
    const selected = String(name || Secrets.getVideoProvider() || "cloud-run").toLowerCase();
    return selected === "creatomate" ? CreatomateProviderAdapter : CloudRunFFmpegProvider;
  }

  function forJob(job) {
    const renderId = String(job && job.renderId || "");
    return renderId.indexOf(RENDER_ID_PREFIX) === 0 ? CloudRunFFmpegProvider : CreatomateProviderAdapter;
  }

  function isCloudRunRenderId(renderId) {
    return String(renderId || "").indexOf(RENDER_ID_PREFIX) === 0;
  }

  return { get: get, forJob: forJob, isCloudRunRenderId: isCloudRunRenderId, RENDER_ID_PREFIX: RENDER_ID_PREFIX };
})();

const CreatomateProviderAdapter = (() => {
  function testConnection() {
    return CreatomateService.testConnection();
  }

  function submitRender(script, seoPack) {
    const result = CreatomateService.createRender(script, seoPack);
    const render = result.render;
    return {
      render: {
        id: render.id,
        status: render.status,
        progress: render.progress || 0,
        url: render.url || "",
        snapshot_url: render.snapshot_url || "",
        error_message: render.error_message || ""
      },
      payload: result.payload
    };
  }

  function getRender(job) {
    return CreatomateService.getRender(job.renderId);
  }

  return { testConnection: testConnection, submitRender: submitRender, getRender: getRender };
})();

const CloudRunFFmpegProvider = (() => {
  function testConnection() {
    // /health, not /healthz: Cloud Run's platform layer intercepts the literal path
    // /healthz before it reaches any container (confirmed empirically - every other path,
    // including /readyz, routes through fine). /health works identically on both Railway
    // and Cloud Run, so this is the one path that's actually safe to depend on.
    const response = UrlFetchApp.fetch(workerUrl_() + "/health", { muteHttpExceptions: true });
    const status = response.getResponseCode();
    if (status !== 200) throw error_("Media worker health check failed (HTTP " + status + ").");
    return { connected: true, workerUrl: workerUrl_() };
  }

  // Beats come straight from script.scenes: whatever length the script actually has,
  // not a padded-or-truncated four. This is what retires the hard-coded four-slot
  // constraint described in section 2.5 of SAVANNAH_AUDIT_AND_PLAN.md for the render
  // path — the worker has no fixed template to satisfy.
  function submitRender(script, seoPack) {
    if (!script || !script.id) throw error_("A valid script is required.");
    const scenes = Array.isArray(script.scenes) ? script.scenes : [];
    if (!scenes.length) throw error_("The script has no scenes.");

    const beats = scenes.map(function (scene, index) {
      const narration = String(scene && scene.narration || "").trim();
      if (!narration) throw error_("Scene " + (index + 1) + " has no narration text.");
      const visualDirection = String(scene && scene.visualDirection || "").trim();
      return {
        text: narration,
        visualQuery: (visualDirection || script.title || "travel").slice(0, 120),
        imagePrompt: (visualDirection || narration).slice(0, 400)
      };
    });

    // Redundant with ScriptValidator's word-count check by design: existing approved
    // scripts may predate that fix, and this is also the only check that runs on the
    // EXACT text about to be sent (beats[].text), so it must run before request_() -
    // no Cloud Run Job, ElevenLabs, Pexels, OpenAI image fallback, or FFmpeg work can be
    // triggered for a script outside Savannah's narration-length bounds. Bounds/rate
    // calibrated 2026-08-14 from two real Cloud Run renders (2.21-2.30 words/sec measured).
    const narrationWordCount = beats.reduce(function (total, beat) {
      return total + countNarrationWords_(beat.text);
    }, 0);
    if (narrationWordCount < MINIMUM_NARRATION_WORDS || narrationWordCount > MAXIMUM_NARRATION_WORDS) {
      throw error_(
        "This script's rendered narration is " + narrationWordCount + " words; Savannah requires between " +
        MINIMUM_NARRATION_WORDS + " and " + MAXIMUM_NARRATION_WORDS +
        " words before submitting a Cloud Run render."
      );
    }

    const jobId = VideoProcessingProvider.RENDER_ID_PREFIX + Utilities.getUuid();
    const callbackUrl = callbackUrl_();
    const response = request_("post", "/jobs", {
      jobId: jobId,
      beats: beats,
      callbackUrl: callbackUrl
    });
    if (!response || response.jobId !== jobId) {
      throw error_("Media worker did not accept the render job.");
    }

    return {
      render: {
        id: jobId,
        status: "RENDERING",
        progress: 5,
        url: "",
        snapshot_url: "",
        error_message: "",
        // operationName/executionName are non-secret GCP resource identifiers, both returned
        // immediately in the /jobs 202 response (before the task even starts) - persisted here
        // so getRender() can look the execution up later without guessing from elapsed time.
        cloudRun: {
          executionName: response.executionName || "",
          operationName: response.operationName || "",
          lastObservedState: "PENDING",
          lastExternalProgressAt: new Date().toISOString()
        }
      },
      payload: {
        provider: "cloud-run",
        scriptId: script.id,
        seoPackId: seoPack && seoPack.id || "",
        beatCount: beats.length,
        callbackUrl: callbackUrl
      }
    };
  }

  // Mirrors Scripts/Script_Validator.js's DEFAULT_RULES.minimumWordCount/maximumWordCount -
  // kept as separate literal constants rather than a shared reference because Apps Script
  // has no cross-file import; the two are intentionally redundant (see submitRender()).
  const MINIMUM_NARRATION_WORDS = 90;
  const MAXIMUM_NARRATION_WORDS = 130;
  function countNarrationWords_(text) {
    return String(text || "").trim().split(/\s+/).filter(Boolean).length;
  }

  // A historical row with no execution identifiers at all is only judged stale after this
  // long from createdAt (never updatedAt — see reconcileStatus_).
  const STALE_NO_OPERATION_MS = 30 * 60 * 1000;

  // Reconciliation Increment 1 (dispatcher) is done; this is the Apps Script side of it.
  // Real authenticated status lookup via the same request_()/MEDIA_WORKER_JOB_SUBMIT_SECRET
  // path used for submission - the dispatcher reports facts only (state, artifact/probe
  // existence), never an inferred verdict; reconcileStatus_() below is where that verdict
  // is decided, kept as a pure function (no UrlFetchApp call) so it's directly testable.
  function getRender(job) {
    const stored = job.providerResponse || {};
    const cloudRun = stored.cloudRun || {};
    const statusResponse = request_("post", "/jobs/status", {
      jobId: job.renderId,
      executionName: cloudRun.executionName || "",
      operationName: cloudRun.operationName || ""
    });
    return reconcileStatus_(job, statusResponse);
  }

  // Pure decision logic, deliberately separate from getRender()'s network call (mirrors
  // media-worker/src/lib/jobStatus.js's own buildStatusResponse() split) so every branch
  // below is unit-testable with a fixture statusResponse, no UrlFetchApp/mocking required.
  //
  // Design constraints (carried from HANDOFF.md / the reconciliation increment plan, all
  // still binding):
  //   - Callback remains the primary success path; this is a fallback only.
  //   - createdAt is the only staleness clock — never updatedAt (polling itself must not
  //     reset it).
  //   - FAILED + artifact, or SUCCEEDED-while-still-active + artifact, must never auto-expose
  //     a paid re-render — represented as providerResponse.reconciliation only, the job's own
  //     `status` stays exactly as it was (retry()/submitCore_() gate re-render purely off
  //     job.status === "FAILED" / an active row, so leaving status untouched is what actually
  //     keeps "Re-render safely"/"Create Short" from appearing — no new status enum value
  //     needed, no Sheet schema change).
  //   - UNKNOWN and NOT_FOUND never cause a terminal transition by themselves.
  //   - No special-casing of any specific jobId anywhere in this function.
  function reconcileStatus_(job, statusResponse) {
    const stored = job.providerResponse || {};
    const priorCloudRun = stored.cloudRun || {};
    const priorReconciliation = stored.reconciliation || null;
    const isActive = ["QUEUED", "PLANNED", "RENDERING"].indexOf(job.status) !== -1;
    const hadIdentifiers = !!(priorCloudRun.executionName || priorCloudRun.operationName);
    const state = String(statusResponse.state || "UNKNOWN").toUpperCase();
    const artifactExists = !!statusResponse.artifactExists;
    const nowIso = new Date().toISOString();

    const cloudRun = {
      executionName: statusResponse.executionName || priorCloudRun.executionName || "",
      operationName: statusResponse.operationName || priorCloudRun.operationName || "",
      lastObservedState: priorCloudRun.lastObservedState || "",
      lastExternalProgressAt: priorCloudRun.lastExternalProgressAt || ""
    };
    // Only a genuinely different external state moves the progress clock — polling alone,
    // seeing the same state again, must never touch it.
    if (state !== cloudRun.lastObservedState) {
      cloudRun.lastObservedState = state;
      cloudRun.lastExternalProgressAt = nowIso;
    }

    let statusOut = String(job.status).toLowerCase(); // default: no terminal transition
    let errorMessage = "";
    let reconciliation = priorReconciliation;

    function recovery_(reason, evidence) {
      return { reason: reason, reconciledAt: nowIso, evidence: evidence };
    }

    if (state === "FAILED") {
      if (artifactExists) {
        errorMessage = "Cloud Run execution failed but a video artifact already exists — delivery recovery required, not an automatic re-render.";
        reconciliation = recovery_("DELIVERY_RECOVERY_REQUIRED", {
          state: state, artifactExists: artifactExists, probeExists: statusResponse.probeExists,
          probePassed: statusResponse.probePassed, failureDetail: statusResponse.failureDetail || ""
        });
      } else {
        statusOut = "failed";
        errorMessage = statusResponse.failureDetail || "Cloud Run execution failed.";
        reconciliation = recovery_("CLOUD_RUN_EXECUTION_FAILED", { state: state, failureDetail: statusResponse.failureDetail || "" });
      }
    } else if (state === "SUCCEEDED") {
      // Already SUCCEEDED locally: leave it exactly as-is, don't regress it.
      // Still active: an Execution success is not proof of callback delivery.
      if (isActive && artifactExists) {
        errorMessage = "Cloud Run execution succeeded and a video artifact exists, but no delivery callback has been recorded — delivery recovery required.";
        reconciliation = recovery_("DELIVERY_RECOVERY_REQUIRED", {
          state: state, artifactExists: artifactExists, probeExists: statusResponse.probeExists, probePassed: statusResponse.probePassed
        });
      }
    } else if (state === "NOT_FOUND") {
      // Never a terminal transition on one observation — just persist the observation for
      // later repeated-not-found logic.
      const priorEvidence = (priorReconciliation && priorReconciliation.evidence) || {};
      reconciliation = recovery_("NOT_FOUND_OBSERVED", {
        state: state,
        notFoundCount: Number(priorEvidence.notFoundCount || 0) + 1,
        firstObservedAt: priorEvidence.firstObservedAt || nowIso
      });
    } else if (state !== "RUNNING" && state !== "PENDING") {
      // UNKNOWN (or any other value — fails closed to the same handling). The only case
      // this function will ever promote to a terminal state on its own: a historical row
      // with no execution identifiers at all, stale by createdAt, with no artifact.
      if (!hadIdentifiers && isActive) {
        const ageMs = Date.now() - new Date(job.createdAt).getTime();
        if (ageMs > STALE_NO_OPERATION_MS) {
          if (artifactExists) {
            errorMessage = "This historical row has no execution identifiers but a video artifact exists — delivery recovery required, not an automatic re-render.";
            reconciliation = recovery_("DELIVERY_RECOVERY_REQUIRED", { state: state, artifactExists: artifactExists, ageMs: ageMs });
          } else {
            statusOut = "failed";
            errorMessage = "No execution identifiers and no artifact " + Math.round(ageMs / 60000) + " minutes after submission; treated as a stale, never-started job.";
            reconciliation = recovery_("STALE_NO_OPERATION", { state: state, ageMs: ageMs });
          }
        }
      }
    }
    // RUNNING/PENDING: stays active, nothing further beyond the progress-clock update above.

    return {
      status: statusOut,
      progress: job.progress,
      url: job.videoUrl,
      snapshot_url: job.snapshotUrl,
      error_message: errorMessage,
      cloudRun: cloudRun,
      reconciliation: reconciliation
    };
  }

  function request_(method, path, payload) {
    const options = {
      method: method,
      muteHttpExceptions: true,
      contentType: "application/json",
      headers: { Authorization: "Bearer " + submitSecret_() },
      payload: JSON.stringify(payload)
    };
    const response = UrlFetchApp.fetch(workerUrl_() + path, options);
    const status = response.getResponseCode();
    const body = response.getContentText();
    let parsed = {};
    try { parsed = body ? JSON.parse(body) : {}; } catch (parseError) { parsed = {}; }
    if (status >= 200 && status < 300) return parsed;
    const detail = String(parsed.error || body || "HTTP " + status).slice(0, 300);
    throw error_("Media worker request failed (HTTP " + status + "): " + detail);
  }

  function callbackUrl_() {
    // Apps Script doPost cannot read custom request headers, only the query string and
    // body, so the callback secret has to travel in the URL itself. MediaWorkerCallback_Service
    // re-checks it against Secrets.getMediaWorkerSharedSecret() on the way in.
    //
    // Deliberately NOT ScriptApp.getService().getUrl(): that returns whichever URL the
    // current execution happens to be running under, which is the /dev URL during
    // testing - and /dev is always restricted to the script owner/editors regardless of
    // the manifest's web app access setting, so a callback aimed at it can never succeed
    // from the worker. The callback must always target the production /exec deployment,
    // independent of where the render was submitted from.
    const webAppUrl = Secrets.getMediaWorkerCallbackUrl();
    if (!webAppUrl) throw error_("MEDIA_WORKER_CALLBACK_URL is not configured - set it to the production /exec URL before submitting Cloud Run render jobs.");
    return webAppUrl + "?route=media-worker-callback&secret=" + encodeURIComponent(callbackSecret_());
  }
  function workerUrl_() {
    const value = Secrets.getMediaWorkerUrl();
    if (!value) throw error_("The media worker URL is not configured.");
    return value;
  }
  // Dispatcher Bearer auth (POST /jobs, POST /jobs/status) - a separate trust boundary from
  // the callback secret below. Must match the dispatcher's own JOB_SUBMIT_SECRET. Deliberately
  // no fallback to the callback secret if this is unset: the two credentials must stay
  // independently rotatable.
  function submitSecret_() {
    const value = Secrets.getMediaWorkerJobSubmitSecret();
    if (!value) throw error_("The media worker job submission secret is not configured.");
    return value;
  }
  // Callback authentication only (the secret MediaWorkerCallback_Service validates on inbound
  // requests) - never used for dispatcher Bearer auth.
  function callbackSecret_() {
    const value = Secrets.getMediaWorkerSharedSecret();
    if (!value) throw error_("The media worker shared secret is not configured.");
    return value;
  }
  function error_(message) {
    const error = new Error(message);
    error.name = "CloudRunFFmpegProviderError";
    return error;
  }

  return {
    testConnection: testConnection, submitRender: submitRender, getRender: getRender,
    // Exposed only so Tests/CloudRunReconciliation_Tests.js can exercise the pure decision
    // logic with fixture responses, with no UrlFetchApp/mocking involved.
    reconcileStatus: reconcileStatus_
  };
})();
