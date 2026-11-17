import { existsSync } from "node:fs";
import { assertSecretFormat, requireSecretEnv } from "./lib/secretFormat.js";

// The first of these files that exists on this host, or null. Used only to pick the disclosure font.
function firstExistingFile(files) {
  return files.find((file) => existsSync(file)) || null;
}

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
  // Labelled AI stills: a job may use at most this many. The check runs on the plan before any image request,
  // so a job that needs more fails with no image generated. Quality is set explicitly to bound per-image cost.
  aiStills: {
    maxPerJob: 2,
    quality: "medium"
  },
  // Landscape (16:9) footage is used only when portrait footage fails for a beat, and is centre-cropped to 9:16.
  // FOOTAGE_LANDSCAPE_FALLBACK=false turns it off without a code change.
  footage: {
    landscapeFallback: process.env.FOOTAGE_LANDSCAPE_FALLBACK !== "false",
    // A beat with no location cannot have its footage checked for the place, so the job is refused before any
    // paid step. FOOTAGE_REQUIRE_LOCATION=false lifts this (subject-only relevance is then used).
    requireLocation: process.env.FOOTAGE_REQUIRE_LOCATION !== "false"
  },
  // The on-screen disclosure drawn on every labelled AI still. The font must exist on the render host (the CI installs
  // fonts-dejavu-core); without it no AI still is rendered.
  aiStillLabel: {
    fontFile: process.env.AI_STILL_LABEL_FONT || firstExistingFile([
      "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
      "C:/Windows/Fonts/arialbd.ttf",
      "C:/Windows/Fonts/arial.ttf"
    ]) || "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    text: "AI-GENERATED ILLUSTRATION"
  },
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
