import { Router } from "express";
import { v4 as uuid } from "uuid";
import { config } from "../config.js";
import { runJob } from "../pipeline/runJob.js";
import { postCallback } from "../lib/callback.js";

export const jobsRouter = Router();

function requireAuth(req, res, next) {
  if (!config.jobSubmitSecret) {
    next();
    return;
  }
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (token !== config.jobSubmitSecret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

function validateBeats(beats) {
  if (!Array.isArray(beats) || beats.length === 0) {
    return "beats must be a non-empty array";
  }
  for (const [index, beat] of beats.entries()) {
    if (!beat || typeof beat.text !== "string" || beat.text.trim().length === 0) {
      return `beats[${index}].text is required`;
    }
    if (typeof beat.visualQuery !== "string" || beat.visualQuery.trim().length === 0) {
      return `beats[${index}].visualQuery is required`;
    }
  }
  return null;
}

jobsRouter.post("/jobs", requireAuth, (req, res) => {
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
  runJob({ jobId, beats, musicTrackPath })
    .then((result) => postCallback(callbackUrl, result))
    .catch((error) => {
      console.error(`Job ${jobId} failed:`, error);
      return postCallback(callbackUrl, {
        jobId,
        status: "failed",
        error: { message: error.message }
      }).catch((callbackError) => {
        console.error(`Job ${jobId} failed and callback also failed:`, callbackError);
      });
    });
});
