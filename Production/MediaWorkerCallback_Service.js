/****************************************************
 * Project Savannah v1.4 - savannah-media-worker webhook receiver.
 *
 * Handles the POST savannah-media-worker sends back once a job finishes (or fails).
 * See media-worker/README.md for the callback payload shape and
 * Production/VideoProcessingProvider.js for how the job was submitted.
 ****************************************************/
const MediaWorkerCallbackService = (() => {
  function handle(event) {
    try {
      const parameters = event && event.parameter && typeof event.parameter === "object"
        ? event.parameter
        : {};
      const expectedSecret = Secrets.getMediaWorkerSharedSecret();
      if (!expectedSecret || String(parameters.secret || "") !== expectedSecret) {
        return { success: false, error: "Unauthorized." };
      }

      const raw = event && event.postData && event.postData.contents || "";
      let body;
      try { body = JSON.parse(raw); } catch (parseError) { body = null; }
      if (!body || !body.jobId) return { success: false, error: "A jobId is required." };

      const job = RenderJobRepository.getByRenderId(String(body.jobId));
      if (!job) return { success: false, error: "Render job was not found." };
      if (!VideoProcessingProvider.isCloudRunRenderId(job.renderId)) {
        return { success: false, error: "This job does not belong to the media worker." };
      }

      if (body.status !== "completed" && body.status !== "failed") {
        return { success: false, error: "Unknown or missing status." };
      }
      // Never record SUCCEEDED without a deliverable video. "Malformed" is a permanent
      // rejection for the worker's retry policy; status reconciliation, which inspects
      // the real artifact, decides the render instead.
      if (body.status === "completed" && !videoUrl_(body)) {
        return { success: false, error: "Malformed callback: completed without an https video URL." };
      }

      // Prevent concurrent delivery callbacks from racing each other's status writes.
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(30000)) {
        return { success: false, error: "Render callback is busy; retry." };
      }
      try {
        // Read again under the lock: another callback may have completed the row.
        const current = RenderJobRepository.getByRenderId(String(body.jobId));
        if (!current) return { success: false, error: "Render job was not found." };
        if (["SUCCEEDED", "FAILED", "CANCELLED"].indexOf(current.status) !== -1 || !!current.videoUrl) {
          return { success: true, ignored: true };
        }
        const changes = body.status === "completed" ? completedChanges_(body) : failedChanges_(body);
        RenderJobRepository.update(RenderJobModel.update(current, changes));
        return { success: true };
      } finally {
        lock.releaseLock();
      }
    } catch (caught) {
      Logger.log("MediaWorkerCallbackService failed: " + (caught && caught.message || caught));
      return { success: false, error: "Callback processing failed." };
    }
  }

  function videoUrl_(body) {
    const video = body.video && typeof body.video === "object" ? body.video : {};
    const url = String(video.url || "").trim();
    return /^https:\/\/\S+$/i.test(url) ? url : "";
  }

  function completedChanges_(body) {
    const video = body.video || {};
    const probe = body.probe || {};
    const videoUrl = videoUrl_(body);
    return {
      status: "SUCCEEDED",
      progress: 100,
      videoUrl: videoUrl,
      errorMessage: "",
      providerResponse: {
        status: "succeeded",
        progress: 100,
        url: videoUrl,
        snapshot_url: "",
        error_message: "",
        video: video,
        probe: probe
      }
    };
  }

  function failedChanges_(body) {
    const message = String(
      (body.error && body.error.message) || "The media worker reported a failure."
    ).slice(0, 500);
    return {
      status: "FAILED",
      errorMessage: message,
      providerResponse: {
        status: "failed",
        error_message: message
      }
    };
  }

  return { handle: handle };
})();
