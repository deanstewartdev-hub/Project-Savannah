function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT) || 8080,
  jobSubmitSecret: process.env.JOB_SUBMIT_SECRET || "",
  openaiApiKey: required("OPENAI_API_KEY"),
  elevenLabsApiKey: required("ELEVENLABS_API_KEY"),
  elevenLabsVoiceId: required("ELEVENLABS_VOICE_ID"),
  pexelsApiKey: required("PEXELS_API_KEY"),
  gcsBucket: required("GCS_BUCKET"),
  // Inline service-account key JSON, for hosts without Cloud Run's attached-service-account
  // metadata server (e.g. Railway). Leave unset on Cloud Run to keep using ADC.
  gcsCredentialsJson: process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "",
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
