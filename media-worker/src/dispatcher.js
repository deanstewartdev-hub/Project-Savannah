import "dotenv/config";
import { JobsClient, ExecutionsClient } from "@google-cloud/run";
import { dispatcherConfig } from "./dispatcherConfig.js";
import { uploadJson, downloadJson, objectExists, deleteObject, jobStateStore } from "./lib/storage.js";
import { MUSIC_MANIFEST } from "./lib/musicManifest.js";
import { createDispatcherApp } from "./lib/dispatcherApp.js";

// The HTTP surface lives in lib/dispatcherApp.js, where it is tested with fake clients. This file only
// connects the real Cloud Run, Cloud Storage and job-state clients and starts listening.
const app = createDispatcherApp({
  config: dispatcherConfig,
  jobsClient: new JobsClient(),
  executionsClient: new ExecutionsClient(),
  storage: { uploadJson, downloadJson, objectExists, deleteObject },
  jobStore: jobStateStore,
  manifest: MUSIC_MANIFEST
});

app.listen(dispatcherConfig.port, () => {
  console.log(`savannah-media-worker-dispatcher listening on port ${dispatcherConfig.port} (${dispatcherConfig.environment})`);
});
