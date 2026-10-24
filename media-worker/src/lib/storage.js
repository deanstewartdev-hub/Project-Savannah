import { Storage } from "@google-cloud/storage";

// Reads GCS_BUCKET directly from process.env rather than importing config.js -
// config.js's required() throws synchronously at import time for OPENAI_API_KEY/
// ELEVENLABS_API_KEY/PEXELS_API_KEY, none of which the dispatcher process has or needs.
// This module is imported by both the full pipeline (job-runner.js) and the dispatcher,
// so it can't depend on either config module specifically.
if (!process.env.GCS_BUCKET) {
  throw new Error("Missing required environment variable: GCS_BUCKET");
}

// Storage always authenticates as the attached Cloud Run service account (Application
// Default Credentials). Inline service-account keys were only for the retired Railway
// host; a downloadable key is a long-lived credential, so a leftover setting fails loudly
// instead of being silently used or ignored.
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_B64) {
  throw new Error(
    "GOOGLE_APPLICATION_CREDENTIALS_B64 is no longer supported: inline service-account keys were " +
    "only for the retired Railway host. Remove it; Cloud Run uses its attached service account."
  );
}

const storage = new Storage();
const bucket = storage.bucket(process.env.GCS_BUCKET);

export async function uploadFile(localPath, destination, contentType) {
  await bucket.upload(localPath, { destination, contentType });
  return destination;
}

export async function downloadToFile(sourcePath, localPath) {
  await bucket.file(sourcePath).download({ destination: localPath });
  return localPath;
}

export async function getSignedReadUrl(destination, expiresInMs = 7 * 24 * 60 * 60 * 1000) {
  const [url] = await bucket.file(destination).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + expiresInMs
  });
  return url;
}

// Used by the dispatcher/job-runner split (Cloud Run) to hand a job request off to a Job
// execution via GCS rather than a fragile inline argument - not used by the Railway/single-
// process HTTP path, which still calls runJob() directly in-process.
export async function uploadJson(destination, value) {
  await bucket.file(destination).save(JSON.stringify(value), { contentType: "application/json" });
  return destination;
}

export async function downloadJson(sourcePath) {
  const [contents] = await bucket.file(sourcePath).download();
  return JSON.parse(contents.toString("utf8"));
}

export async function deleteObject(destination) {
  await bucket.file(destination).delete({ ignoreNotFound: true });
}

// Metadata-only existence check - never downloads the object body. Used by the
// dispatcher's /jobs/status endpoint to check for a finished render's final.mp4
// without pulling megabytes of video through the request.
export async function objectExists(destination) {
  const [exists] = await bucket.file(destination).exists();
  return exists;
}
