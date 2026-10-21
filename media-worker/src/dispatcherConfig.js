import { requireSecretEnv } from "./lib/secretFormat.js";

// Deliberately separate from config.js: the dispatcher process must never require
// OPENAI_API_KEY/ELEVENLABS_API_KEY/ELEVENLABS_VOICE_ID/PEXELS_API_KEY just to boot, since
// it never renders anything itself - only the job-runner (which still uses config.js
// unchanged) needs those.
function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const dispatcherConfig = {
  port: Number(process.env.PORT) || 8080,
  // Must never resolve to "" - see requireSecretEnv: an empty JOB_SUBMIT_SECRET used
  // to make requireAuth() wave every request through unauthenticated (SAV-13).
  jobSubmitSecret: requireSecretEnv("JOB_SUBMIT_SECRET"),
  gcsBucket: required("GCS_BUCKET"),
  jobRequestPrefix: "job-requests/",
  project: required("CLOUD_RUN_PROJECT"),
  region: process.env.CLOUD_RUN_REGION || "europe-west2",
  renderJobName: required("RENDER_JOB_NAME")
};
