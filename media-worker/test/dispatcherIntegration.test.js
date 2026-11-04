import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createDispatcherApp } from "../src/lib/dispatcherApp.js";
import { executeRenderRequest } from "../src/lib/renderRequest.js";
import { postCallbackWithRetry } from "../src/lib/callback.js";
import { createStubPipeline } from "../src/lib/stubPipeline.js";
import { statePath, recoveryConfirmation, startAttempt, reserveJob, JOB_STATES } from "../src/lib/jobState.js";
import { createMemoryJobStore, storageError } from "./helpers/memoryJobStore.js";

// The dispatcher's real HTTP app, with in-memory Cloud Storage, job-state and Cloud Run clients. The render execution
// is the real request handler with the stub pipeline (real music preparation, paid steps skipped). The callback is a
// real HTTP POST to a local receiver. Nothing here touches Google Cloud, a paid service or YouTube.

const IMAGE = "europe-west2-docker.pkg.dev/p/r/media-worker@sha256:verified";
const OLD_IMAGE = "europe-west2-docker.pkg.dev/p/r/media-worker@sha256:old";
const SECRET = "submit-secret-for-tests";
const TRACK_ID = "scott-buckley-beyond-these-walls";
const CREDIT = "'Beyond These Walls' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au";
const MANIFEST = { tracks: [{
  id: TRACK_ID, file: "music/scott-buckley-beyond-these-walls.mp3", title: "Beyond These Walls", licence: "CC-BY-4.0",
  sourceUrl: "https://www.scottbuckley.com.au/library/beyond-these-walls/",
  termsUrl: "https://www.scottbuckley.com.au/library/beyond-these-walls/",
  verifiedBy: "integration-test", verifiedOn: "2026-11-03", attributionRequired: true, attribution: CREDIT,
  monetizationAllowed: true
}] };
const BEATS = [{ text: "Blue walls and quiet streets.", visualQuery: "blue street" }];
const AUDIO_PROBE = { streams: [{ codec_type: "audio", codec_name: "mp3", sample_rate: "44100" }], format: { duration: "60" } };
const silentLog = { log() {}, error() {} };
const JOB_A = "cr-11111111-1111-4111-8111-111111111111";

// Cloud Storage for request payloads and outputs. A failUpload error makes the next upload throw.
function memoryStorage() {
  const objects = new Map();
  const events = [];
  const storage = {
    objects,
    events,
    uploadJson: async (path, body) => {
      if (storage.failUpload) throw storage.failUpload;
      objects.set(path, JSON.parse(JSON.stringify(body)));
      events.push("upload " + path);
    },
    downloadJson: async (path) => {
      if (!objects.has(path)) throw new Error("not found: " + path);
      return JSON.parse(JSON.stringify(objects.get(path)));
    },
    objectExists: async (path) => objects.has(path),
    deleteObject: async (path) => { objects.delete(path); events.push("delete " + path); }
  };
  return storage;
}

// Records Cloud Run calls. runError makes runJob throw, to model uncertain and definite start failures.
function fakeJobsClient(image = IMAGE) {
  const client = {
    runs: [],
    runError: null,
    getJob: async () => [{ template: { template: { containers: [{ image }] } } }],
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

const CONFIG = {
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
};

// The execution's pipeline: real music preparation, paid steps skipped. `fail` makes the render fail afterwards.
function pipeline({ fail = false } = {}) {
  return createStubPipeline({
    manifest: MANIFEST, existsFn: async () => true, downloadFn: async () => {}, probeFn: async () => AUDIO_PROBE,
    minSeconds: 3, fail: fail
  });
}

function closeServer(server) {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
}

async function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, base: "http://127.0.0.1:" + server.address().port };
}

// A callback receiver that answers the way Apps Script does (success: true).
async function callbackReceiver() {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      received.push({ url: req.url, body: JSON.parse(body || "{}") });
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{\"success\":true}");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { received, url: "http://127.0.0.1:" + server.address().port + "/exec", close: () => closeServer(server) };
}

async function setup({ image = IMAGE, config = CONFIG } = {}) {
  const storage = memoryStorage();
  const jobsClient = fakeJobsClient(image);
  const jobStore = createMemoryJobStore();
  const app = createDispatcherApp({
    config,
    jobsClient,
    executionsClient: { getExecution: async () => [{}] },
    storage,
    jobStore,
    manifest: MANIFEST,
    buildStatusResponse: async () => ({ status: 200, body: {} }),
    log: silentLog
  });
  const { server, base } = await listen(app);
  return { storage, jobsClient, jobStore, server, base };
}

function post(base, body, path = "/jobs", secret = SECRET) {
  return fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + secret },
    body: JSON.stringify(body)
  });
}

// What the Cloud Run Job does for one execution: it reads JOB_ID and ATTEMPT_ID from its environment and runs the real
// request handler against the same storage and job state.
function runExecution(jobsClient, { storage, jobStore, run = jobsClient.runs[jobsClient.runs.length - 1], runPipeline = pipeline() }) {
  const env = run.overrides.containerOverrides[0].env;
  const jobId = env.find((entry) => entry.name === "JOB_ID").value;
  const attemptId = env.find((entry) => entry.name === "ATTEMPT_ID").value;
  return executeRenderRequest({
    jobId,
    attemptId,
    requestPath: CONFIG.jobRequestPrefix + jobId + ".json",
    storage,
    jobStore,
    runJob: runPipeline,
    postCallback: postCallbackWithRetry,
    log: silentLog
  });
}

const attemptOf = (run) => run.overrides.containerOverrides[0].env.find((e) => e.name === "ATTEMPT_ID").value;
const stateOf = (jobStore, jobId) => jobStore.objects.get(statePath(jobId)).value;

test("a verified track request is accepted, executed with that track, and called back with its credit", async (t) => {
  const { storage, jobsClient, jobStore, server, base } = await setup();
  const receiver = await callbackReceiver();
  t.after(() => Promise.all([closeServer(server), receiver.close()]));

  const response = await post(base, { jobId: JOB_A, beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: receiver.url, callbackSecret: "callback-secret" });
  assert.equal(response.status, 202);
  const accepted = await response.json();
  assert.equal(accepted.music.id, TRACK_ID);
  assert.equal(accepted.music.attribution, CREDIT);
  assert.equal(accepted.executionName, "executions/ex-1");

  // The request is written once, with the verified track and no path or placeholder flag, and the job is queued.
  const stored = storage.objects.get("job-requests/" + JOB_A + ".json");
  assert.equal(stored.musicTrackId, TRACK_ID);
  assert.equal(stored.legacyPlaceholderMusic, false);
  assert.equal(stored.musicTrackPath, undefined);
  assert.equal(jobsClient.runs[0].overrides.containerOverrides[0].env[0].value, JOB_A);
  assert.equal(stateOf(jobStore, JOB_A).status, JOB_STATES.QUEUED);
  assert.equal(stateOf(jobStore, JOB_A).callbackSecret, undefined, "the job state holds no secret");

  // The execution starts the attempt, deletes the request before rendering, and posts the completed callback.
  const outcome = await runExecution(jobsClient, { storage, jobStore });
  assert.equal(outcome.status, "completed");
  assert.deepEqual(storage.events, ["upload job-requests/" + JOB_A + ".json", "delete job-requests/" + JOB_A + ".json"], "written once, then deleted before rendering");
  assert.equal(stateOf(jobStore, JOB_A).status, JOB_STATES.SUCCEEDED, "the outcome is recorded");

  assert.equal(receiver.received.length, 1);
  const callback = receiver.received[0];
  assert.equal(callback.body.status, "completed");
  assert.equal(callback.body.music.id, TRACK_ID);
  assert.equal(callback.body.music.attribution, CREDIT);
  assert.match(callback.body.video.url, /final\.mp4$/);
  assert.equal(callback.url.indexOf("callback-secret"), -1, "the secret is not in the URL");
});

test("a failed render calls back as failed, exits non-zero, and still leaves no request behind", async (t) => {
  const { storage, jobsClient, jobStore, server, base } = await setup();
  const receiver = await callbackReceiver();
  t.after(() => Promise.all([closeServer(server), receiver.close()]));
  const response = await post(base, { jobId: JOB_A, beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: receiver.url, callbackSecret: "s" });
  assert.equal(response.status, 202);
  const outcome = await runExecution(jobsClient, { storage, jobStore, runPipeline: pipeline({ fail: true }) });
  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.status, "failed");
  assert.equal(storage.objects.has("job-requests/" + JOB_A + ".json"), false);
  assert.equal(stateOf(jobStore, JOB_A).status, JOB_STATES.FAILED);
  assert.equal(receiver.received.length, 1);
  assert.equal(receiver.received[0].body.status, "failed");
  assert.match(receiver.received[0].body.error.message, /Simulated render failure/);
});

test("refused requests are refused before anything is uploaded, recorded or started", async (t) => {
  const { storage, jobsClient, jobStore, server, base } = await setup();
  t.after(() => closeServer(server));
  const callbackUrl = "http://127.0.0.1:1/exec";
  const refusals = [
    ["no track", { jobId: JOB_A, beats: BEATS, callbackUrl }, 400, /musicTrackId from the verified manifest is required/],
    ["an unknown track", { jobId: JOB_A, beats: BEATS, callbackUrl, musicTrackId: "not-a-track" }, 400, /not an approved track/],
    ["a file path", { jobId: JOB_A, beats: BEATS, callbackUrl, musicTrackId: TRACK_ID, musicTrackPath: "music/x.mp3" }, 400, /not accepted/],
    ["a placeholder that names a track", { jobId: JOB_A, beats: BEATS, callbackUrl, legacyPlaceholderMusic: true, musicTrackId: TRACK_ID }, 400, /cannot also name/],
    ["a malformed jobId", { jobId: "../../etc/x", beats: BEATS, callbackUrl, musicTrackId: TRACK_ID }, 400, /jobId must be/]
  ];
  for (const [label, body, status, message] of refusals) {
    const response = await post(base, body);
    assert.equal(response.status, status, label);
    assert.match((await response.json()).error, message, label);
  }
  assert.equal(storage.events.length, 0, "no request was written");
  assert.equal(jobStore.objects.size, 0, "no job state was reserved");
  assert.equal(jobsClient.runs.length, 0, "no execution was started");
});

test("no render starts while the shared render job is not on a verified image", async (t) => {
  const withOldJob = await setup({ image: OLD_IMAGE });
  t.after(() => closeServer(withOldJob.server));
  const response = await post(withOldJob.base, { jobId: JOB_A, beats: BEATS, callbackUrl: "http://127.0.0.1:1/exec", musicTrackId: TRACK_ID });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /not running a music-verified image/);
  assert.equal(withOldJob.storage.events.length, 0);
  assert.equal(withOldJob.jobStore.objects.size, 0);
  assert.equal(withOldJob.jobsClient.runs.length, 0);

  const withoutAllowlist = await setup({ config: Object.assign({}, CONFIG, { allowedRenderImages: [] }) });
  t.after(() => closeServer(withoutAllowlist.server));
  const refused = await post(withoutAllowlist.base, { jobId: JOB_A, beats: BEATS, callbackUrl: "http://127.0.0.1:1/exec", musicTrackId: TRACK_ID });
  assert.equal(refused.status, 409);
  assert.equal(withoutAllowlist.jobsClient.runs.length, 0);
});

test("a placeholder run is accepted only when it says so, and records no licensed track", async (t) => {
  const { storage, jobsClient, jobStore, server, base } = await setup();
  const receiver = await callbackReceiver();
  t.after(() => Promise.all([closeServer(server), receiver.close()]));
  const response = await post(base, { jobId: JOB_A, beats: BEATS, legacyPlaceholderMusic: true, callbackUrl: receiver.url });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).music, null, "no track summary is returned");
  assert.equal(storage.objects.get("job-requests/" + JOB_A + ".json").legacyPlaceholderMusic, true);
  await runExecution(jobsClient, { storage, jobStore });
  assert.equal(receiver.received[0].body.music.id, "");
  assert.equal(receiver.received[0].body.music.attribution, "");
});

test("a request with the wrong secret is refused before anything is uploaded or reserved", async (t) => {
  const { storage, jobsClient, jobStore, server, base } = await setup();
  t.after(() => closeServer(server));
  const response = await post(base, { jobId: JOB_A, beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: "http://127.0.0.1:1/exec" }, "/jobs", "wrong-secret");
  assert.equal(response.status, 401);
  assert.equal(storage.events.length, 0);
  assert.equal(jobStore.objects.size, 0);
  assert.equal(jobsClient.runs.length, 0);
});

test("the dispatcher reports the music protocol and its identity, which the main app and the staging verifier check", async (t) => {
  const { server, base } = await setup();
  t.after(() => closeServer(server));
  const health = await (await fetch(base + "/health")).json();
  assert.equal(health.musicProtocol, "verified-v1");
  assert.equal(health.environment, "production");
  assert.equal(health.project, "p");
  assert.equal(health.service, "savannah-media-worker-dispatcher");
});

test("two simultaneous submissions of one jobId: exactly one reserves it and starts one execution", async (t) => {
  const { jobsClient, jobStore, server, base } = await setup();
  t.after(() => closeServer(server));
  const body = { jobId: JOB_A, beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: "http://127.0.0.1:1/exec" };
  const responses = await Promise.all([post(base, body), post(base, body), post(base, body)]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [202, 409, 409]);
  assert.equal(jobsClient.runs.length, 1);
  assert.equal(stateOf(jobStore, JOB_A).status, JOB_STATES.QUEUED);
});

test("a duplicate while queued, while running, and after success never starts a second execution", async (t) => {
  const { storage, jobsClient, jobStore, server, base } = await setup();
  const receiver = await callbackReceiver();
  t.after(() => Promise.all([closeServer(server), receiver.close()]));
  const body = { jobId: JOB_A, beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: receiver.url, callbackSecret: "s" };
  assert.equal((await post(base, body)).status, 202);
  assert.equal((await post(base, body)).status, 409, "while queued");

  // A duplicate submitted from inside the running render is refused, even though the request payload is already deleted.
  const run = jobsClient.runs[0];
  let duplicateWhileRunning = null;
  const midRunPipeline = async (args) => {
    duplicateWhileRunning = (await post(base, body)).status;
    assert.equal(stateOf(jobStore, JOB_A).status, JOB_STATES.RUNNING);
    return pipeline()(args);
  };
  assert.equal((await runExecution(jobsClient, { storage, jobStore, run, runPipeline: midRunPipeline })).status, "completed");
  assert.equal(duplicateWhileRunning, 409, "while running");

  // Duplicates after success are refused, and a replay of the same execution does nothing: no second callback.
  assert.equal((await post(base, body)).status, 409, "after success");
  assert.equal((await runExecution(jobsClient, { storage, jobStore, run })).status, "refused", "a replayed execution is refused");
  assert.equal(jobsClient.runs.length, 1, "still one execution in total");
  assert.equal(receiver.received.length, 1, "still one callback");
});

test("a failed render is refused as a duplicate, and recovers only with the explicit operation and a new attempt", async (t) => {
  const { storage, jobsClient, jobStore, server, base } = await setup();
  const receiver = await callbackReceiver();
  t.after(() => Promise.all([closeServer(server), receiver.close()]));
  const body = { jobId: JOB_A, beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: receiver.url, callbackSecret: "s" };
  assert.equal((await post(base, body)).status, 202);
  const failed = await runExecution(jobsClient, { storage, jobStore, runPipeline: pipeline({ fail: true }) });
  assert.equal(failed.exitCode, 1);
  assert.equal(stateOf(jobStore, JOB_A).status, JOB_STATES.FAILED);

  assert.equal((await post(base, body)).status, 409, "a duplicate after failure is refused");
  assert.equal((await post(base, body, "/jobs/recover")).status, 400, "recovery needs the confirmation phrase");
  const recovered = await post(base, Object.assign({}, body, { confirm: recoveryConfirmation(JOB_A) }), "/jobs/recover");
  assert.equal(recovered.status, 202);
  assert.equal(jobsClient.runs.length, 2, "recovery starts exactly one new execution");
  assert.notEqual(attemptOf(jobsClient.runs[1]), stateOf(jobStore, JOB_A).history[0].attemptId);
  assert.equal((await runExecution(jobsClient, { storage, jobStore, run: jobsClient.runs[1] })).status, "completed");
  assert.equal(stateOf(jobStore, JOB_A).status, JOB_STATES.SUCCEEDED);
});

test("a jobId whose video was already delivered is never re-rendered, not even by recovery", async (t) => {
  const { storage, jobsClient, jobStore, server, base } = await setup();
  t.after(() => closeServer(server));
  const body = { jobId: JOB_A, beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: "http://127.0.0.1:1/exec", confirm: recoveryConfirmation(JOB_A) };
  storage.objects.set("renders/" + JOB_A + "/final.mp4", { delivered: true });
  assert.equal((await post(base, body, "/jobs/recover")).status, 409);
  assert.equal(jobsClient.runs.length, 0);
  assert.equal(jobStore.objects.size, 0);
});

test("an uncertain Cloud Run start is never restarted automatically; only recovery restarts it", async (t) => {
  const { jobsClient, jobStore, server, base } = await setup();
  t.after(() => closeServer(server));
  const body = { jobId: JOB_A, beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: "http://127.0.0.1:1/exec" };
  jobsClient.runError = Object.assign(new Error("deadline exceeded"), { code: 4 });
  const uncertain = await post(base, body);
  assert.equal(uncertain.status, 502);
  assert.equal((await uncertain.json()).state, JOB_STATES.UNCERTAIN);
  assert.equal(stateOf(jobStore, JOB_A).status, JOB_STATES.UNCERTAIN);
  jobsClient.runError = null;
  assert.equal((await post(base, body)).status, 409, "a resubmission is refused");
  assert.equal(jobsClient.runs.length, 0);
  assert.equal((await post(base, Object.assign({}, body, { confirm: recoveryConfirmation(JOB_A) }), "/jobs/recover")).status, 202);
  assert.equal(jobsClient.runs.length, 1);
});

test("a definite refusal from Cloud Run ends the attempt as failed, and the orphaned request is removed", async (t) => {
  const { storage, jobsClient, jobStore, server, base } = await setup();
  t.after(() => closeServer(server));
  const body = { jobId: JOB_A, beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: "http://127.0.0.1:1/exec" };
  jobsClient.runError = Object.assign(new Error("permission denied"), { code: 7 });
  const refused = await post(base, body);
  assert.equal(refused.status, 502);
  assert.equal((await refused.json()).state, JOB_STATES.FAILED);
  assert.equal(stateOf(jobStore, JOB_A).status, JOB_STATES.FAILED);
  assert.equal(storage.objects.has("job-requests/" + JOB_A + ".json"), false, "no stray request is left to run later");
});

test("a Cloud Storage error while reserving refuses the submission before anything is written or started", async (t) => {
  const { storage, jobsClient, jobStore, server, base } = await setup();
  t.after(() => closeServer(server));
  jobStore.createIfAbsent = async () => { throw storageError(503); };
  const response = await post(base, { jobId: JOB_A, beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: "http://127.0.0.1:1/exec" });
  assert.equal(response.status, 503);
  assert.equal(storage.events.length, 0);
  assert.equal(jobsClient.runs.length, 0);
});

test("a Cloud Storage error while checking for earlier submissions refuses rather than rendering", async (t) => {
  const { storage, jobsClient, jobStore, server, base } = await setup();
  t.after(() => closeServer(server));
  storage.objectExists = async () => { throw new Error("storage unavailable"); };
  const response = await post(base, { jobId: JOB_A, beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: "http://127.0.0.1:1/exec" });
  assert.equal(response.status, 503);
  assert.equal(jobStore.objects.size, 0);
  assert.equal(jobsClient.runs.length, 0);
});

test("a Cloud Storage error while storing the request marks the attempt failed and starts nothing", async (t) => {
  const { storage, jobsClient, jobStore, server, base } = await setup();
  t.after(() => closeServer(server));
  storage.failUpload = storageError(500);
  const response = await post(base, { jobId: JOB_A, beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: "http://127.0.0.1:1/exec" });
  assert.equal(response.status, 503);
  assert.equal(stateOf(jobStore, JOB_A).status, JOB_STATES.FAILED);
  assert.equal(jobsClient.runs.length, 0);
});

test("an interrupted render cannot be finished by its old attempt after recovery", async (t) => {
  const receiver = await callbackReceiver();
  t.after(() => receiver.close());
  const { storage, jobsClient, jobStore, server, base } = await setup();
  t.after(() => closeServer(server));
  const body = { jobId: JOB_A, beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: receiver.url };
  assert.equal((await post(base, body)).status, 202);
  const oldRun = jobsClient.runs[0];
  // The first attempt starts, then its process dies: the state is left running.
  await startAttempt(jobStore, JOB_A, attemptOf(oldRun), new Date().toISOString());
  assert.equal((await post(base, body)).status, 409, "a duplicate of an interrupted render is refused");
  assert.equal((await post(base, Object.assign({}, body, { confirm: recoveryConfirmation(JOB_A) }), "/jobs/recover")).status, 202);
  assert.equal((await runExecution(jobsClient, { storage, jobStore, run: oldRun })).status, "refused", "the old attempt cannot run");
  assert.equal((await runExecution(jobsClient, { storage, jobStore, run: jobsClient.runs[1] })).status, "completed");
});

test("a staging dispatcher refuses callbacks outside its allowlist, before anything is written", async (t) => {
  const stagingEndpoint = "https://script.example.test/staging-exec";
  const { storage, jobsClient, jobStore, server, base } = await setup({
    config: Object.assign({}, CONFIG, { environment: "staging", callbackUrlAllowlist: [stagingEndpoint] })
  });
  t.after(() => closeServer(server));
  const refused = await post(base, { jobId: JOB_A, beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: "https://script.example.test/production-exec" });
  assert.equal(refused.status, 400);
  assert.equal(storage.events.length, 0);
  assert.equal(jobStore.objects.size, 0);
  assert.equal(jobsClient.runs.length, 0);
  assert.equal((await post(base, { jobId: JOB_A, beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: stagingEndpoint })).status, 202);
});

// A new dispatcher process over the same storage and job state: what a restart or a second instance sees.
async function restartedDispatcher(storage, jobStore, jobsClient) {
  const app = createDispatcherApp({
    config: CONFIG, jobsClient, executionsClient: { getExecution: async () => [{}] }, storage, jobStore,
    manifest: MANIFEST, buildStatusResponse: async () => ({ status: 200, body: {} }), log: silentLog
  });
  return listen(app);
}

test("a crash after reservation but before the request is stored blocks duplicates and recovers only explicitly", async (t) => {
  const { storage, jobsClient, jobStore, server, base } = await setup();
  t.after(() => closeServer(server));
  // The reservation was written, then the process died before any upload or execution.
  await reserveJob(jobStore, { jobId: JOB_A, attemptId: "crashed-1", now: new Date().toISOString() });
  const body = { jobId: JOB_A, beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: "http://127.0.0.1:1/exec" };
  assert.equal((await post(base, body)).status, 409, "a duplicate is refused");
  assert.equal(storage.events.length, 0);
  assert.equal(jobsClient.runs.length, 0);
  assert.equal((await post(base, Object.assign({}, body, { confirm: recoveryConfirmation(JOB_A) }), "/jobs/recover")).status, 202);
  assert.equal(jobsClient.runs.length, 1);
});

test("a crash after the request is stored but before the execution is created blocks duplicates and never runs twice", async (t) => {
  const { storage, jobsClient, jobStore, server, base } = await setup();
  t.after(() => closeServer(server));
  await reserveJob(jobStore, { jobId: JOB_A, attemptId: "crashed-2", now: new Date().toISOString() });
  await storage.uploadJson("job-requests/" + JOB_A + ".json", { jobId: JOB_A, beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: "http://127.0.0.1:1/exec" });
  const body = { jobId: JOB_A, beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: "http://127.0.0.1:1/exec" };
  assert.equal((await post(base, body)).status, 409, "a waiting request is never overwritten by a duplicate");
  assert.equal(jobsClient.runs.length, 0);
});

test("a crash after Cloud Run created the execution never causes a second execution", async (t) => {
  const receiver = await callbackReceiver();
  t.after(() => receiver.close());
  const { storage, jobsClient, jobStore, server, base } = await setup();
  t.after(() => closeServer(server));
  const body = { jobId: JOB_A, beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: receiver.url };
  assert.equal((await post(base, body)).status, 202);
  // The response was lost in a crash; the caller does not know it succeeded and retries.
  assert.equal((await post(base, body)).status, 409);
  assert.equal(jobsClient.runs.length, 1, "exactly one execution exists");
  assert.equal((await runExecution(jobsClient, { storage, jobStore })).status, "completed", "the one execution still runs");
});

test("queued and succeeded states survive a restart, and a restarted dispatcher still refuses duplicates", async (t) => {
  const receiver = await callbackReceiver();
  t.after(() => receiver.close());
  const { storage, jobsClient, jobStore, server } = await setup();
  t.after(() => closeServer(server));
  const body = { jobId: JOB_A, beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: receiver.url };
  const first = await restartedDispatcher(storage, jobStore, jobsClient);
  t.after(() => closeServer(first.server));
  assert.equal((await post(first.base, body)).status, 202);
  await closeServer(first.server);

  const second = await restartedDispatcher(storage, jobStore, jobsClient);
  t.after(() => closeServer(second.server));
  assert.equal((await post(second.base, body)).status, 409, "queued survives the restart");
  assert.equal((await runExecution(jobsClient, { storage, jobStore })).status, "completed");
  const third = await restartedDispatcher(storage, jobStore, jobsClient);
  t.after(() => closeServer(third.server));
  assert.equal((await post(third.base, body)).status, 409, "succeeded survives the restart");
  assert.equal(jobsClient.runs.length, 1);
});

test("a running state survives a restart: a duplicate after the restart is refused and recovery is explicit", async (t) => {
  const { storage, jobsClient, jobStore, server, base } = await setup();
  t.after(() => closeServer(server));
  const body = { jobId: JOB_A, beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: "http://127.0.0.1:1/exec" };
  assert.equal((await post(base, body)).status, 202);
  await startAttempt(jobStore, JOB_A, attemptOf(jobsClient.runs[0]), new Date().toISOString());
  await closeServer(server);
  const restarted = await restartedDispatcher(storage, jobStore, jobsClient);
  t.after(() => closeServer(restarted.server));
  assert.equal((await post(restarted.base, body)).status, 409, "running survives the restart");
  assert.equal((await post(restarted.base, Object.assign({}, body, { confirm: recoveryConfirmation(JOB_A) }), "/jobs/recover")).status, 202);
  assert.equal(jobsClient.runs.length, 2);
});
