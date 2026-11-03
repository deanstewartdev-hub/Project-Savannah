// One Cloud Run Job execution handles exactly one render: read its request from storage (written by the
// dispatcher), delete the request so it can never run twice, run the pipeline, post the callback, and report
// the exit code. Render failure and callback-delivery failure are separate outcomes: a render that succeeds
// but whose callback POST fails must never be reported to Apps Script as a failed render.
//
// Everything that touches the outside world is passed in, so the same code is tested with in-memory storage
// and stub pipelines (media-worker/test/dispatcherIntegration.test.js). job-runner.js passes the real ones.

export function parseJobRequest(raw) {
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
    musicTrackId: raw.musicTrackId,
    legacyPlaceholderMusic: raw.legacyPlaceholderMusic === true,
    callbackUrl: raw.callbackUrl,
    callbackSecret: typeof raw.callbackSecret === "string" && raw.callbackSecret.length > 0 ? raw.callbackSecret : undefined
  };
}

// Returns { status, exitCode }: "dry-run" (exit 0), "completed" (exit 0), or "failed" (exit 1).
// Errors from reading or parsing the request are not caught: the caller exits non-zero, as before.
export async function executeRenderRequest({ jobId, requestPath, storage, runJob, postCallback, dryRun = false, log = console }) {
  const request = parseJobRequest(await storage.downloadJson(requestPath));

  if (dryRun) {
    log.log(`[${jobId}] dry-run: loaded ${requestPath}, beats=${request.beats.length}`);
    return { status: "dry-run", exitCode: 0 };
  }

  await storage.deleteObject(requestPath);

  try {
    const result = await runJob({
      jobId,
      beats: request.beats,
      musicTrackId: request.musicTrackId,
      legacyPlaceholderMusic: request.legacyPlaceholderMusic
    });
    await postCallback(request.callbackUrl, result, { callbackSecret: request.callbackSecret }).catch((callbackError) => {
      log.error(`Job ${jobId} succeeded, but delivering its callback failed:`, callbackError);
    });
    return { status: "completed", exitCode: 0 };
  } catch (renderError) {
    log.error(`Job ${jobId} failed:`, renderError);
    await postCallback(request.callbackUrl, {
      jobId,
      status: "failed",
      error: { message: renderError.message }
    }, { callbackSecret: request.callbackSecret }).catch((callbackError) => {
      log.error(`Job ${jobId} failed, and delivering that failure's callback also failed:`, callbackError);
    });
    return { status: "failed", exitCode: 1 };
  }
}
