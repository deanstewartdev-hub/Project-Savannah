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
        error_message: ""
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

  // There is no polling endpoint on the worker (see media-worker/README.md) — the job's
  // true state only changes when handleMediaWorkerCallback_ in App/App.js writes it to
  // the sheet directly. This just reflects back whatever was last stored, so calling it
  // before the callback arrives is a harmless no-op rather than a wasted network call.
  function getRender(job) {
    const stored = job.providerResponse || {};
    return {
      status: stored.status || job.status || "RENDERING",
      progress: stored.progress || job.progress || 0,
      url: stored.url || job.videoUrl || "",
      snapshot_url: stored.snapshot_url || job.snapshotUrl || "",
      error_message: stored.error_message || job.errorMessage || ""
    };
  }

  function request_(method, path, payload) {
    const options = {
      method: method,
      muteHttpExceptions: true,
      contentType: "application/json",
      headers: { Authorization: "Bearer " + sharedSecret_() },
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
    // body, so the shared secret has to travel in the URL itself. handleMediaWorkerCallback_
    // in App/App.js re-checks it against Secrets.getMediaWorkerSharedSecret() on the way in.
    //
    // Deliberately NOT ScriptApp.getService().getUrl(): that returns whichever URL the
    // current execution happens to be running under, which is the /dev URL during
    // testing - and /dev is always restricted to the script owner/editors regardless of
    // the manifest's web app access setting, so a callback aimed at it can never succeed
    // from the worker. The callback must always target the production /exec deployment,
    // independent of where the render was submitted from.
    const webAppUrl = Secrets.getMediaWorkerCallbackUrl();
    if (!webAppUrl) throw error_("MEDIA_WORKER_CALLBACK_URL is not configured - set it to the production /exec URL before submitting Cloud Run render jobs.");
    return webAppUrl + "?route=media-worker-callback&secret=" + encodeURIComponent(sharedSecret_());
  }
  function workerUrl_() {
    const value = Secrets.getMediaWorkerUrl();
    if (!value) throw error_("The media worker URL is not configured.");
    return value;
  }
  function sharedSecret_() {
    const value = Secrets.getMediaWorkerSharedSecret();
    if (!value) throw error_("The media worker shared secret is not configured.");
    return value;
  }
  function error_(message) {
    const error = new Error(message);
    error.name = "CloudRunFFmpegProviderError";
    return error;
  }

  return { testConnection: testConnection, submitRender: submitRender, getRender: getRender };
})();
