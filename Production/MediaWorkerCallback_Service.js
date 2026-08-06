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

      const changes = body.status === "completed" ? completedChanges_(body) : failedChanges_(body);
      RenderJobRepository.update(RenderJobModel.update(job, changes));
      return { success: true };
    } catch (caught) {
      Logger.log("MediaWorkerCallbackService failed: " + (caught && caught.message || caught));
      return { success: false, error: "Callback processing failed." };
    }
  }

  function completedChanges_(body) {
    const video = body.video || {};
    const probe = body.probe || {};
    const videoUrl = String(video.url || "");
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
