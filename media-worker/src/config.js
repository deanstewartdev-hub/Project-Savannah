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

// Optional numeric setting in [min, max]. Invalid values fail at start-up, not mid-render.
function optionalNumber(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number from ${min} to ${max}`);
  }
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
  // Narration model and voice settings. The defaults are exactly what production has always sent, so an
  // unchanged environment behaves the same. Rolling back a voice or model is a configuration change.
  narration: {
    modelId: process.env.ELEVENLABS_MODEL_ID?.trim() || "eleven_multilingual_v2",
    stability: optionalNumber("ELEVENLABS_STABILITY", 0.5, 0, 1),
    similarityBoost: optionalNumber("ELEVENLABS_SIMILARITY_BOOST", 0.75, 0, 1),
    style: optionalNumber("ELEVENLABS_STYLE", 0.3, 0, 1),
    useSpeakerBoost: process.env.ELEVENLABS_SPEAKER_BOOST !== "false"
  },
  pexelsApiKey: requiredSecret("PEXELS_API_KEY"),
  gcsBucket: required("GCS_BUCKET"),
  defaultMusicTrackPath: process.env.DEFAULT_MUSIC_TRACK_PATH || "music/default-bed.mp3",
  video: {
    width: 1080,
    height: 1920,
    fps: 30,
    crossfadeSeconds: 0.4,
    // Background music under narration: level before ducking, and fades at the ends of the video.
    musicVolume: 0.25,
    musicFadeInSeconds: 0.5,
    musicFadeOutSeconds: 1.0,
    targetLufs: -14,
    truePeakDb: -1.5,
    loudnessRangeLu: 11
  }
};
