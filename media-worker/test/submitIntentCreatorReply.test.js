import { test } from "node:test";
import assert from "node:assert/strict";
import { createDispatcherApp } from "../src/lib/dispatcherApp.js";
import { intentPath, renderVersionPath } from "../src/lib/submitIntent.js";
import { statePath } from "../src/lib/jobState.js";
import { createMemoryJobStore } from "./helpers/memoryJobStore.js";

// The reply to the request that CREATED a submission intent, when a duplicate of the same owner action (same
// submitIntentId) overtakes it. prepareSubmission marks only the later requests as replays, so before this fix the
// creator was answered 409 "already submitted" with no jobId, although its own render had started. Seen as an
// intermittent failure of submitConcurrentProcesses.test.js (2 in 52 runs on Windows).
//
// These tests force the interleaving instead of hoping for it: the creator is held at one step while the duplicate
// runs to completion, then released. Storage, job state and Cloud Run are in-memory fakes; nothing is started.

const IMAGE = "europe-west2-docker.pkg.dev/p/r/media-worker@sha256:verified";
const TRACK_ID = "scott-buckley-beyond-these-walls";
const MANIFEST = { tracks: [{
  id: TRACK_ID, file: "music/scott-buckley-beyond-these-walls.mp3", title: "Beyond These Walls", licence: "CC-BY-4.0",
  sourceUrl: "https://www.scottbuckley.com.au/library/beyond-these-walls/",
  termsUrl: "https://www.scottbuckley.com.au/library/beyond-these-walls/",
  verifiedBy: "integration-test", verifiedOn: "2026-11-03", attributionRequired: true,
  attribution: "'Beyond These Walls' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au.",
  monetizationAllowed: true
}] };
const SECRET = "submit-secret-for-tests";
const BEATS = [{ text: "Blue walls and quiet streets.", visualQuery: "blue street" }];
const SCRIPT = "SCR-creator-reply";
const INTENT_1 = "intent-creator-0001";
const INTENT_2 = "intent-creator-0002";

function memoryStorage() {
  const objects = new Map();
  return {
    objects,
    uploadJson: async (path, body) => { objects.set(path, JSON.parse(JSON.stringify(body))); },
    downloadJson: async (path) => JSON.parse(JSON.stringify(objects.get(path))),
    objectExists: async (path) => objects.has(path),
    deleteObject: async (path) => { objects.delete(path); }
  };
}

function fakeJobsClient() {
  const client = {
    runs: [],
    getJob: async () => [{ template: { template: { containers: [{ image: IMAGE }] } } }],
    runJob: async (args) => {
      client.runs.push(args);
      const n = client.runs.length;
      return [{ name: "operations/op-" + n, metadata: { name: "executions/ex-" + n } }];
    },
    checkRunJobProgress: async () => ({})
  };
  return client;
}

const CONFIG = {
  environment: "production", serviceName: "savannah-media-worker-dispatcher", jobRequestPrefix: "job-requests/",
  jobSubmitSecret: SECRET, previousJobSubmitSecret: undefined, project: "p", region: "europe-west2",
  renderJobName: "savannah-render-job", allowedRenderImages: [IMAGE], callbackUrlAllowlist: [], requireSubmitIntent: true
};

async function setup() {
  const storage = memoryStorage();
  const jobStore = createMemoryJobStore();
  const jobsClient = fakeJobsClient();
  const app = createDispatcherApp({
    config: CONFIG, jobsClient, executionsClient: { getExecution: async () => [{}] }, storage, jobStore,
    manifest: MANIFEST, buildStatusResponse: async () => ({ status: 200, body: {} }), log: { log() {}, error() {} }
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return { storage, jobStore, jobsClient, server, base: "http://127.0.0.1:" + server.address().port };
}

function close(server) {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

let counter = 0;
function newJobId() {
  counter += 1;
  return "cr-1000000" + counter + "-0000-4000-8000-000000000000";
}

function submission(overrides = {}) {
  return Object.assign({
    jobId: newJobId(), beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: "http://127.0.0.1:9/exec",
    submitIntentId: INTENT_1, scriptId: SCRIPT, renderVersion: 1
  }, overrides);
}

async function post(base, body) {
  const response = await fetch(base + "/jobs", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + SECRET },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

// Holds the first job-state reservation until released. Every later reservation passes straight through.
function holdFirstReservation(jobStore) {
  const original = jobStore.createIfAbsent.bind(jobStore);
  const reached = deferred();
  const release = deferred();
  let held = false;
  jobStore.createIfAbsent = async (path, value) => {
    if (!held && path.startsWith("job-states/")) {
      held = true;
      reached.resolve();
      await release.promise;
    }
    return original(path, value);
  };
  return { reached: reached.promise, release: release.resolve };
}

// Holds the first duplicate check (both of its existence probes) until released. Later checks pass straight through.
function holdFirstDuplicateCheck(storage) {
  const original = storage.objectExists;
  const reached = deferred();
  const release = deferred();
  let holding = true;
  storage.objectExists = async (path) => {
    if (holding) {
      reached.resolve();
      await release.promise;
    }
    return original(path);
  };
  return {
    reached: reached.promise.then(() => { holding = false; }),
    release: release.resolve
  };
}

test("the intent creator overtaken at the reservation is told 200 with its own jobId, and one execution starts", async (t) => {
  const { server, base, jobStore, jobsClient } = await setup();
  t.after(() => close(server));
  const hold = holdFirstReservation(jobStore);
  const original = submission();

  const creator = post(base, original);
  await hold.reached; // the creator has written the intent and the version claim, and is about to reserve
  assert.ok(jobStore.objects.has(intentPath(INTENT_1)), "the creator wrote the intent record");

  const duplicate = await post(base, { ...original, jobId: newJobId() }); // same owner action, overtakes
  assert.equal(duplicate.status, 202, "the duplicate adopted the original jobId and reserved it first");
  assert.equal(duplicate.body.jobId, original.jobId);

  hold.release();
  const answer = await creator;
  assert.equal(answer.status, 200, "the creator is not refused: HTTP " + answer.status + " " + JSON.stringify(answer.body));
  assert.equal(answer.body.jobId, original.jobId, "the creator is told its own jobId");
  assert.equal(answer.body.status, "already-submitted");
  assert.equal(answer.body.duplicate, true);
  assert.equal(answer.body.state, "queued", "the recorded state of the job");
  assert.equal(jobsClient.runs.length, 1, "exactly one execution");
});

test("the intent creator overtaken at the duplicate check (request already stored) is told 200 with its own jobId", async (t) => {
  const { server, base, storage, jobsClient } = await setup();
  t.after(() => close(server));
  const hold = holdFirstDuplicateCheck(storage);
  const original = submission();

  const creator = post(base, original);
  await hold.reached; // the creator is inside the legacy duplicate check, before any reservation

  const duplicate = await post(base, { ...original, jobId: newJobId() });
  assert.equal(duplicate.status, 202);
  assert.equal(duplicate.body.jobId, original.jobId);
  assert.ok(storage.objects.has("job-requests/" + original.jobId + ".json"), "the duplicate stored the request");

  hold.release();
  const answer = await creator;
  assert.equal(answer.status, 200, "the creator is not refused: HTTP " + answer.status + " " + JSON.stringify(answer.body));
  assert.equal(answer.body.jobId, original.jobId);
  assert.equal(answer.body.status, "already-submitted");
  assert.equal(jobsClient.runs.length, 1, "exactly one execution");
});

// The refusals this fix must not soften.

test("a different intent that reuses a reserved jobId is still refused at the reservation (409, nothing started)", async (t) => {
  const { server, base, storage, jobsClient } = await setup();
  t.after(() => close(server));
  const first = submission();
  assert.equal((await post(base, first)).status, 202);
  storage.objects.delete("job-requests/" + first.jobId + ".json"); // the payload is gone; only the reservation decides
  const other = await post(base, submission({ jobId: first.jobId, submitIntentId: INTENT_2, renderVersion: 2 }));
  assert.equal(other.status, 409);
  assert.match(other.body.error, /already been submitted/);
  assert.equal(other.body.jobId, undefined, "a refusal of another owner action does not adopt the job");
  assert.equal(jobsClient.runs.length, 1);
});

test("a different intent that reuses a jobId whose request is stored is still refused at the duplicate check", async (t) => {
  const { server, base, jobsClient } = await setup();
  t.after(() => close(server));
  const first = submission();
  assert.equal((await post(base, first)).status, 202);
  const other = await post(base, submission({ jobId: first.jobId, submitIntentId: INTENT_2, renderVersion: 2 }));
  assert.equal(other.status, 409);
  assert.match(other.body.error, /already submitted/);
  assert.equal(jobsClient.runs.length, 1);
});

test("a reservation recorded without an intent (older job) refuses an intent that later names its jobId", async (t) => {
  const { server, base, jobStore, jobsClient } = await setup();
  t.after(() => close(server));
  const jobId = newJobId();
  await jobStore.createIfAbsent(statePath(jobId), {
    jobId, status: "failed", attemptId: "old-1", error: "", videoUrl: "", history: []
  });
  const answer = await post(base, submission({ jobId, submitIntentId: INTENT_2, renderVersion: 3 }));
  assert.equal(answer.status, 409);
  assert.equal(answer.body.state, "failed");
  assert.equal(jobsClient.runs.length, 0, "nothing started");
});

test("a different intent for the same version is still refused before any job work", async (t) => {
  const { server, base, jobStore, jobsClient } = await setup();
  t.after(() => close(server));
  assert.equal((await post(base, submission())).status, 202);
  const other = await post(base, submission({ submitIntentId: INTENT_2 }));
  assert.equal(other.status, 409);
  assert.match(other.body.error, /render version of the script was already submitted/);
  assert.ok(jobStore.objects.has(renderVersionPath(SCRIPT, 1)));
  assert.equal(jobsClient.runs.length, 1);
});

test("the reservation records the intent that made it", async (t) => {
  const { server, base, jobStore } = await setup();
  t.after(() => close(server));
  const first = submission();
  assert.equal((await post(base, first)).status, 202);
  assert.equal(jobStore.objects.get(statePath(first.jobId)).value.submitIntentId, INTENT_1);
});
