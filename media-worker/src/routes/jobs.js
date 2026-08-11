import { Router } from "express";
import { v4 as uuid } from "uuid";
import { config } from "../config.js";
import { runJob } from "../pipeline/runJob.js";
import { postCallback } from "../lib/callback.js";
import { requireAuth } from "../lib/auth.js";
import { validateBeats } from "../lib/validateBeats.js";

export const jobsRouter = Router();

// This worker runs on a single memory-constrained instance, so two jobs' ffmpeg encodes
// running concurrently is exactly the kind of pressure that gets a process SIGKILLed.
// A simple promise chain serializes execution without needing an external queue.
let queue = Promise.resolve();
function runSerialized(task) {
  const result = queue.then(task, task);
  queue = result.then(
    () => {},
    () => {}
  );
  return result;
}

jobsRouter.post("/jobs", requireAuth(config.jobSubmitSecret), (req, res) => {
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

  // Deliberately not awaited: the caller gets an immediate 202 and the result arrives via
  // callbackUrl once the pipeline finishes. Cloud Run requests are billed for wall-clock
  // time either way, so this is about keeping the HTTP contract simple, not performance.
  //
  // Render outcome and callback delivery are two separate things that can each fail
  // independently - a render that succeeds but whose callback delivery fails must NOT be
  // reported to Apps Script as a failed render (there's nothing wrong with the video;
  // Apps Script just doesn't know about it yet). Callback delivery failures are only
  // logged here, not retried - this worker is a deliberately single-attempt v1.4 scaffold
  // (see media-worker/README.md "What isn't here yet").
  runSerialized(() => runJob({ jobId, beats, musicTrackPath })).then(
    (result) => {
      postCallback(callbackUrl, result).catch((callbackError) => {
        console.error(`Job ${jobId} succeeded, but delivering its callback failed:`, callbackError);
      });
    },
    (renderError) => {
      console.error(`Job ${jobId} failed:`, renderError);
      postCallback(callbackUrl, {
        jobId,
        status: "failed",
        error: { message: renderError.message }
      }).catch((callbackError) => {
        console.error(`Job ${jobId} failed, and delivering that failure's callback also failed:`, callbackError);
      });
    }
  );
});
