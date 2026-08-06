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
