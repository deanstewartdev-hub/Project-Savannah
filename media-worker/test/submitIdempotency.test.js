import { test } from "node:test";
import assert from "node:assert/strict";
import { createDispatcherApp } from "../src/lib/dispatcherApp.js";
import { renderVersionPath, intentPath, validateIntentFields } from "../src/lib/submitIntent.js";
import { statePath, JOB_STATES } from "../src/lib/jobState.js";
import { createMemoryJobStore, storageError } from "./helpers/memoryJobStore.js";

// Cross-submission idempotency through the dispatcher's real HTTP app. Storage, job state and Cloud Run are in-memory
// fakes, so nothing here starts a render, calls a paid service or touches Google Cloud.

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
const SCRIPT = "SCR-6928b7a7-8575-42e1-925d-5d2bc8a8d6ef";
const INTENT_1 = "intent-0001-aaaa";
const INTENT_2 = "intent-0002-bbbb";

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
    runError: null,
    getJob: async () => [{ template: { template: { containers: [{ image: IMAGE }] } } }],
    runJob: async (args) => {
      if (client.runError) throw client.runError;
      client.runs.push(args);
      const n = client.runs.length;
      return [{ name: "operations/op-" + n, metadata: { name: "executions/ex-" + n } }];
    },
    checkRunJobProgress: async () => ({})
  };
  return client;
}

function config(extra = {}) {
  return Object.assign({
    environment: "production",
    serviceName: "savannah-media-worker-dispatcher",
    jobRequestPrefix: "job-requests/",
    jobSubmitSecret: SECRET,
    previousJobSubmitSecret: undefined,
    project: "p",
    region: "europe-west2",
    renderJobName: "savannah-render-job",
    allowedRenderImages: [IMAGE],
    callbackUrlAllowlist: []
  }, extra);
}

async function setup({ cfg = config(), jobStore = createMemoryJobStore(), jobsClient = fakeJobsClient() } = {}) {
  const storage = memoryStorage();
  const app = createDispatcherApp({
    config: cfg,
    jobsClient,
    executionsClient: { getExecution: async () => [{}] },
    storage,
    jobStore,
    manifest: MANIFEST,
    buildStatusResponse: async () => ({ status: 200, body: {} }),
    log: { log() {}, error() {} }
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return { storage, jobStore, jobsClient, server, base: "http://127.0.0.1:" + server.address().port };
}

function close(server) {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
}

let counter = 0;
function newJobId() {
  counter += 1;
  return "cr-0000000" + counter + "-0000-4000-8000-000000000000";
}

function post(base, body) {
  return fetch(base + "/jobs", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + SECRET },
    body: JSON.stringify(body)
  });
}

function submission(overrides = {}) {
  return Object.assign({
    jobId: newJobId(),
    beats: BEATS,
    musicTrackId: TRACK_ID,
    callbackUrl: "http://127.0.0.1:9/exec",
    submitIntentId: INTENT_1,
    scriptId: SCRIPT,
    renderVersion: 2
  }, overrides);
}

test("a replayed submission (double click or lost reply) returns the job it made and starts nothing new", async (t) => {
  const { server, base, jobsClient } = await setup();
  t.after(() => close(server));
  const first = submission();
  const a = await post(base, first);
  assert.equal(a.status, 202);
  const b = await post(base, { ...first, jobId: newJobId() }); // same intent, new jobId: the replay case
  assert.equal(b.status, 200);
  const replay = await b.json();
  assert.equal(replay.duplicate, true);
  assert.equal(replay.status, "already-submitted");
  assert.equal(replay.jobId, first.jobId, "the replay reports the job the intent created");
  assert.equal(jobsClient.runs.length, 1, "exactly one Cloud Run execution");
});

test("two simultaneous submissions with the same intent start exactly one execution", async (t) => {
  const { server, base, jobsClient } = await setup();
  t.after(() => close(server));
  const body = submission();
  const [x, y] = await Promise.all([post(base, body), post(base, { ...body, jobId: newJobId() })]);
  const statuses = [x.status, y.status].sort();
  assert.deepEqual(statuses, [200, 202]);
  assert.equal(jobsClient.runs.length, 1, "one execution for two racing requests");
});

test("a fresh tab or second session (new intent, same script and render version) is refused, whatever the earlier job's state", async (t) => {
  const { server, base, jobsClient } = await setup();
  t.after(() => close(server));
  const first = submission();
  assert.equal((await post(base, first)).status, 202);
  const second = await post(base, submission({ submitIntentId: INTENT_2 }));
  assert.equal(second.status, 409);
  const body = await second.json();
  assert.match(body.error, /already submitted/);
  assert.equal(body.jobId, first.jobId, "the refusal names the job that already exists");
  assert.equal(jobsClient.runs.length, 1, "no second execution");
});

test("a failed job does not give blanket permission: a new intent for the same version is still refused", async (t) => {
  const jobsClient = fakeJobsClient();
  const { server, base, jobStore } = await setup({ jobsClient });
  t.after(() => close(server));
  const first = submission();
  jobsClient.runError = Object.assign(new Error("invalid argument"), { code: 400 }); // definitely not started: FAILED
  const a = await post(base, first);
  assert.equal(a.status, 502);
  assert.equal(jobStore.objects.get(statePath(first.jobId)).value.status, JOB_STATES.FAILED);
  jobsClient.runError = null;
  const retry = await post(base, submission({ submitIntentId: INTENT_2 }));
  assert.equal(retry.status, 409, "a new intent for a failed version is refused");
  assert.equal(jobsClient.runs.length, 0);
});

test("an uncertain start blocks a new intent for the same version (never restarted automatically)", async (t) => {
  const jobsClient = fakeJobsClient();
  const { server, base, jobStore } = await setup({ jobsClient });
  t.after(() => close(server));
  const first = submission();
  jobsClient.runError = new Error("deadline exceeded"); // unknown outcome: UNCERTAIN
  assert.equal((await post(base, first)).status, 502);
  assert.equal(jobStore.objects.get(statePath(first.jobId)).value.status, JOB_STATES.UNCERTAIN);
  jobsClient.runError = null;
  assert.equal((await post(base, submission({ submitIntentId: INTENT_2 }))).status, 409);
  assert.equal(jobsClient.runs.length, 0);
});

test("a new render version of the same script is a new claim and may run", async (t) => {
  const { server, base, jobsClient } = await setup();
  t.after(() => close(server));
  assert.equal((await post(base, submission({ renderVersion: 2 }))).status, 202);
  assert.equal((await post(base, submission({ renderVersion: 3, submitIntentId: INTENT_2 }))).status, 202);
  assert.equal(jobsClient.runs.length, 2);
});

test("a storage error on the claim refuses the submission: nothing starts (fail closed)", async (t) => {
  const jobStore = createMemoryJobStore({ failOn: { create: storageError(503) } });
  const { server, base, jobsClient } = await setup({ jobStore });
  t.after(() => close(server));
  const response = await post(base, submission());
  assert.equal(response.status, 503);
  assert.equal(jobsClient.runs.length, 0);
});

test("malformed intent fields are refused before anything is claimed", async (t) => {
  const { server, base, jobsClient, jobStore } = await setup();
  t.after(() => close(server));
  for (const bad of [{ submitIntentId: "x" }, { scriptId: "a" }, { renderVersion: 0 }, { renderVersion: 2.5, scriptId: SCRIPT }, { renderVersion: 2 }]) {
    const response = await post(base, { jobId: newJobId(), beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: "http://127.0.0.1:9/exec", ...bad });
    assert.equal(response.status, 400, JSON.stringify(bad));
  }
  assert.equal(jobsClient.runs.length, 0);
  assert.equal(jobStore.objects.size, 0, "nothing was claimed or recorded");
});

test("a deployment that requires intents refuses a submission without them", async (t) => {
  const { server, base, jobsClient } = await setup({ cfg: config({ requireSubmitIntent: true }) });
  t.after(() => close(server));
  const response = await post(base, { jobId: newJobId(), beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: "http://127.0.0.1:9/exec" });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /requires submitIntentId, scriptId and renderVersion/);
  assert.equal(jobsClient.runs.length, 0);
});

// A store whose render-version write fails while `failing.version` is true: the intent is written, the version is not.
function storeFailingVersionWrite() {
  const store = createMemoryJobStore();
  const original = store.createIfAbsent;
  const failing = { version: true };
  store.createIfAbsent = async (path, value) => {
    if (failing.version && path.startsWith("renders-by-version/")) throw storageError(503);
    return original(path, value);
  };
  return { store, failing };
}

test("non-atomic claims: a storage failure between the intent and the version refuses, then the same intent resumes with one execution", async (t) => {
  const { store, failing } = storeFailingVersionWrite();
  const { server, base, jobsClient, jobStore } = await setup({ jobStore: store });
  t.after(() => close(server));
  const first = submission();
  const a = await post(base, first);
  assert.equal(a.status, 503, "the claim cannot be confirmed, so nothing starts");
  assert.equal(jobsClient.runs.length, 0);
  assert.ok(jobStore.objects.has(intentPath(INTENT_1)), "the intent record was written first");
  failing.version = false; // storage recovers
  const retry = await post(base, submission({ jobId: newJobId() })); // the same owner action, retried
  assert.equal(retry.status, 202, "the replay completes the claim and starts the render");
  assert.equal((await retry.json()).jobId, first.jobId, "under the original jobId, not a new one");
  assert.equal(jobsClient.runs.length, 1, "exactly one execution after the resume");
  assert.ok(jobStore.objects.has(renderVersionPath(SCRIPT, 2)), "the version claim now exists");
});

test("non-atomic claims: an interrupted intent (intent written, process stopped) is completed by a replay, not stranded", async (t) => {
  const jobStore = createMemoryJobStore();
  // Simulate a crash after the intent was written and before the version or the job existed.
  await jobStore.createIfAbsent(intentPath(INTENT_1), { submitIntentId: INTENT_1, scriptId: SCRIPT, renderVersion: 2, jobId: "cr-99999999-0000-4000-8000-000000000000", claimedAt: "t" });
  const { server, base, jobsClient } = await setup({ jobStore });
  t.after(() => close(server));
  const response = await post(base, submission({ jobId: newJobId() }));
  assert.equal(response.status, 202);
  assert.equal((await response.json()).jobId, "cr-99999999-0000-4000-8000-000000000000", "the interrupted attempt's jobId is used");
  assert.equal(jobsClient.runs.length, 1);
});

test("an intent reused for a different script or render version is refused, and nothing starts", async (t) => {
  const { server, base, jobsClient } = await setup();
  t.after(() => close(server));
  assert.equal((await post(base, submission())).status, 202);
  const otherVersion = await post(base, submission({ renderVersion: 3 })); // same intent, version 3
  assert.equal(otherVersion.status, 409);
  assert.match((await otherVersion.json()).error, /different script or render version/);
  assert.equal(jobsClient.runs.length, 1);
});

test("a version held by another intent refuses that intent on every replay (the refusal is consistent)", async (t) => {
  const { server, base, jobsClient } = await setup();
  t.after(() => close(server));
  assert.equal((await post(base, submission({ submitIntentId: INTENT_1 }))).status, 202);
  const other = submission({ submitIntentId: INTENT_2 });
  assert.equal((await post(base, other)).status, 409);
  assert.equal((await post(base, other)).status, 409, "the second attempt of the other intent is refused too");
  assert.equal(jobsClient.runs.length, 1);
});

test("a replay reports the recorded state of the original job and does not start it again (failed, running)", async (t) => {
  const jobsClient = fakeJobsClient();
  const { server, base, jobStore } = await setup({ jobsClient });
  t.after(() => close(server));
  const first = submission();
  jobsClient.runError = Object.assign(new Error("invalid argument"), { code: 400 });
  assert.equal((await post(base, first)).status, 502); // FAILED
  jobsClient.runError = null;
  const replay = await post(base, { ...first, jobId: newJobId() });
  assert.equal(replay.status, 200);
  const body = await replay.json();
  assert.equal(body.jobId, first.jobId);
  assert.equal(body.state, JOB_STATES.FAILED, "the replay reports the failed state");
  assert.equal(jobsClient.runs.length, 0, "a replay of a failed job starts nothing");
  assert.equal(jobStore.objects.get(statePath(first.jobId)).value.status, JOB_STATES.FAILED);
});

test("racing replays with different jobIds start exactly one execution and report the original jobId", async (t) => {
  const { server, base, jobsClient } = await setup();
  t.after(() => close(server));
  const body = submission();
  const results = await Promise.all([1, 2, 3, 4].map(() => post(base, { ...body, jobId: newJobId() })));
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 200, 200, 202]);
  const payloads = await Promise.all(results.map((r) => r.json()));
  // The request that won the intent named its own jobId; every other response must name that same job.
  const winner = results.findIndex((r) => r.status === 202);
  assert.ok(winner !== -1, "one request started the render");
  assert.ok(payloads.every((p) => p.jobId === payloads[winner].jobId), "every response names the one original jobId");
  assert.equal(jobsClient.runs.length, 1, "exactly one execution across four racing requests");
});

test("unit: paths and field rules are stable", () => {
  assert.equal(renderVersionPath(SCRIPT, 2), `renders-by-version/${SCRIPT}/v2.json`);
  assert.equal(intentPath(INTENT_1), `submit-intents/${INTENT_1}.json`);
  assert.equal(validateIntentFields({}, { requireIntent: false }), null);
  assert.match(validateIntentFields({}, { requireIntent: true }), /requires/);
  assert.match(validateIntentFields({ renderVersion: 2 }), /needs a scriptId/);
});
