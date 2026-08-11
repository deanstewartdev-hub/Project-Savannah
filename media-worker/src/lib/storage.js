import { Storage } from "@google-cloud/storage";
import { config } from "../config.js";

const storage = config.gcsCredentialsJson
  ? new Storage({ credentials: JSON.parse(config.gcsCredentialsJson) })
  : new Storage();
const bucket = storage.bucket(config.gcsBucket);

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
