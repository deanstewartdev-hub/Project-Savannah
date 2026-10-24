import { assertSecretFormat, requireSecretEnv } from "./lib/secretFormat.js";

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Security-sensitive token/key values, validated for format (not trimmed or
// otherwise repaired) before anything tries to use them in an HTTP header. See
// src/lib/secretFormat.js for why: a malformed value here must fail loudly and
// immediately, before any paid provider call, not deep inside the pipeline.
function requiredSecret(name, fallback) {
  const value = required(name, fallback);
  assertSecretFormat(name, value);
  return value;
}

export const config = {
  port: Number(process.env.PORT) || 8080,
  // Must never resolve to "" - see requireSecretEnv: an empty JOB_SUBMIT_SECRET used
  // to make requireAuth() wave every request through unauthenticated (SAV-13).
  jobSubmitSecret: requireSecretEnv("JOB_SUBMIT_SECRET"),
  openaiApiKey: requiredSecret("OPENAI_API_KEY"),
  elevenLabsApiKey: requiredSecret("ELEVENLABS_API_KEY"),
  elevenLabsVoiceId: required("ELEVENLABS_VOICE_ID"),
  pexelsApiKey: requiredSecret("PEXELS_API_KEY"),
  gcsBucket: required("GCS_BUCKET"),
  defaultMusicTrackPath: process.env.DEFAULT_MUSIC_TRACK_PATH || "music/default-bed.mp3",
  video: {
    width: 1080,
    height: 1920,
    fps: 30,
    crossfadeSeconds: 0.4,
    targetLufs: -14,
    truePeakDb: -1.5,
    loudnessRangeLu: 11
  }
};
