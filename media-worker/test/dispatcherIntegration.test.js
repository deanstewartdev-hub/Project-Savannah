import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createDispatcherApp } from "../src/lib/dispatcherApp.js";
import { executeRenderRequest } from "../src/lib/renderRequest.js";
import { prepareMusic } from "../src/pipeline/prepareMusic.js";
import { withJobWorkDir } from "../src/lib/tempDir.js";
import { postCallbackWithRetry } from "../src/lib/callback.js";

// Isolated dispatcher -> job request -> render execution -> callback -> persistence, with no Cloud Run, no
// Cloud Storage, no paid pipeline and no YouTube. The dispatcher's HTTP app is the real one; the clients and
// storage are in-memory fakes. The render execution is the real request handler (lib/renderRequest.js) with
// a stub pipeline that runs the real music preparation. The callback is a real HTTP POST to a local receiver.

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

function memoryStorage() {
  const objects = new Map();
  const events = [];
  return {
    objects,
    events,
    uploadJson: async (path, body) => { objects.set(path, JSON.parse(JSON.stringify(body))); events.push("upload " + path); },
    downloadJson: async (path) => {
      if (!objects.has(path)) throw new Error("not found: " + path);
      return JSON.parse(JSON.stringify(objects.get(path)));
    },
    objectExists: async (path) => objects.has(path),
    deleteObject: async (path) => { objects.delete(path); events.push("delete " + path); }
  };
}

// Records the Cloud Run calls. getJob reports the image the shared render job runs.
function fakeJobsClient(image = IMAGE) {
  const runs = [];
  return {
    runs,
    getJob: async () => [{ template: { template: { containers: [{ image }] } } }],
    runJob: async (args) => {
      runs.push(args);
      const n = runs.length;
      return [{ name: "operations/op-" + n, metadata: { name: "executions/ex-" + n } }];
    },
    checkRunJobProgress: async () => ({})
  };
}

const CONFIG = {
  jobRequestPrefix: "job-requests/",
  jobSubmitSecret: SECRET,
  previousJobSubmitSecret: undefined,
  project: "p",
  region: "europe-west2",
  renderJobName: "savannah-render-job",
  allowedRenderImages: [IMAGE]
};

// A stub pipeline: the real music preparation (manifest, refusal, cleanup), with the paid steps skipped.
// `fail` makes the render fail after the music is prepared, to test the failure callback.
function stubPipeline({ fail = false } = {}) {
  return async ({ jobId, musicTrackId, legacyPlaceholderMusic }) => withJobWorkDir(jobId, async (workDir) => {
    const music = await prepareMusic({
      musicTrackId, legacyPlaceholderMusic, manifest: MANIFEST, defaultPath: "music/default-bed.mp3", workDir, minSeconds: 3,
      existsFn: async () => true,
      downloadFn: async () => {},
      probeFn: async () => AUDIO_PROBE
    });
    if (fail) throw new Error("simulated render failure after music preparation");
    return {
      jobId,
      status: "completed",
      music: music.track ? { id: music.track.id, attribution: music.track.attributionRequired ? music.track.attribution : "" } : { id: "", attribution: "" },
      video: { url: "https://example.test/" + jobId + "/final.mp4", gcsPath: "renders/" + jobId + "/final.mp4", durationSeconds: 3, width: 1080, height: 1920 },
      probe: { durationSeconds: 3, width: 1080, height: 1920, reportUrl: "" }
    };
  });
}

// Closes open keep-alive connections as well, so the server stops even while fetch holds a socket.
function closeServer(server) {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
}

async function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, base: "http://127.0.0.1:" + server.address().port };
}

// A callback receiver, as Apps Script would see the POST.
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
  return { received, url: "http://127.0.0.1:" + server.address().port + "/exec", close: () => new Promise((r) => server.close(r)) };
}

async function setup({ image = IMAGE, config = CONFIG } = {}) {
  const storage = memoryStorage();
  const jobsClient = fakeJobsClient(image);
  const app = createDispatcherApp({
    config,
    jobsClient,
    executionsClient: { getExecution: async () => [{}] },
    storage,
    manifest: MANIFEST,
    buildStatusResponse: async () => ({ status: 200, body: {} })
  });
  const { server, base } = await listen(app);
  return { storage, jobsClient, server, base };
}

function post(base, body, secret = SECRET) {
  return fetch(base + "/jobs", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + secret },
    body: JSON.stringify(body)
  });
}

// Runs what the Cloud Run Job does for the execution the dispatcher just started: the job reads JOB_ID from its
// environment and runs the real request handler against the same storage.
function executeLastRun(jobsClient, { storage, callback, pipeline }) {
  const run = jobsClient.runs[jobsClient.runs.length - 1];
  const jobId = run.overrides.containerOverrides[0].env.find((entry) => entry.name === "JOB_ID").value;
  return executeRenderRequest({
    jobId,
    requestPath: CONFIG.jobRequestPrefix + jobId + ".json",
    storage,
    runJob: pipeline,
    postCallback: postCallbackWithRetry,
    log: silentLog
  }).then((outcome) => ({ jobId, outcome, callback }));
}

test("a verified track request is accepted, executed with that track, and called back with its credit", async (t) => {
  const { storage, jobsClient, server, base } = await setup();
  const receiver = await callbackReceiver();
  t.after(() => Promise.all([closeServer(server), receiver.close()]));

  const jobId = "cr-11111111-1111-4111-8111-111111111111";
  const response = await post(base, { jobId, beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: receiver.url, callbackSecret: "callback-secret" });
  assert.equal(response.status, 202);
  const accepted = await response.json();
  assert.equal(accepted.music.id, TRACK_ID);
  assert.equal(accepted.music.attribution, CREDIT);
  assert.equal(accepted.executionName, "executions/ex-1");

  // Persistence: the request is written once, with the verified track and no path or placeholder flag.
  const stored = storage.objects.get("job-requests/" + jobId + ".json");
  assert.equal(stored.musicTrackId, TRACK_ID);
  assert.equal(stored.legacyPlaceholderMusic, false);
  assert.equal(stored.musicTrackPath, undefined);
  assert.equal(jobsClient.runs[0].overrides.containerOverrides[0].env[0].value, jobId);

  // Execution: the job reads the request, deletes it before rendering, and posts the completed callback.
  const { outcome } = await executeLastRun(jobsClient, { storage, pipeline: stubPipeline() });
  assert.equal(outcome.exitCode, 0);
  assert.equal(storage.objects.has("job-requests/" + jobId + ".json"), false, "the request is deleted");
  assert.deepEqual(storage.events, ["upload job-requests/" + jobId + ".json", "delete job-requests/" + jobId + ".json"], "written once, then deleted before rendering");

  // Callback: delivered once, with the track the worker actually used, and the secret not in the URL.
  assert.equal(receiver.received.length, 1);
  const callback = receiver.received[0];
  assert.equal(callback.body.status, "completed");
  assert.equal(callback.body.music.id, TRACK_ID);
  assert.equal(callback.body.music.attribution, CREDIT);
  assert.match(callback.body.video.url, /final\.mp4$/);
  assert.equal(callback.url.indexOf("callback-secret"), -1);

  // Replay: the request is gone, so the same execution cannot render again.
  await assert.rejects(executeRenderRequest({
    jobId, requestPath: "job-requests/" + jobId + ".json", storage, runJob: stubPipeline(), postCallback: postCallbackWithRetry, log: silentLog
  }), /not found/);
  assert.equal(receiver.received.length, 1, "no second callback");
});

test("a failed render calls back as failed, exits non-zero, and still leaves no request behind", async (t) => {
  const { storage, jobsClient, server, base } = await setup();
  const receiver = await callbackReceiver();
  t.after(() => Promise.all([closeServer(server), receiver.close()]));

  const jobId = "cr-22222222-2222-4222-8222-222222222222";
  const response = await post(base, { jobId, beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: receiver.url, callbackSecret: "s" });
  assert.equal(response.status, 202);
  const { outcome } = await executeLastRun(jobsClient, { storage, pipeline: stubPipeline({ fail: true }) });
  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.status, "failed");
  assert.equal(storage.objects.has("job-requests/" + jobId + ".json"), false);
  assert.equal(receiver.received.length, 1);
  assert.equal(receiver.received[0].body.status, "failed");
  assert.match(receiver.received[0].body.error.message, /simulated render failure/);
});

test("refused requests are refused before anything is uploaded or started", async (t) => {
  const { storage, jobsClient, server, base } = await setup();
  t.after(() => closeServer(server));
  const callbackUrl = "http://127.0.0.1:1/exec";
  const refusals = [
    ["no track", { beats: BEATS, callbackUrl }, 400, /musicTrackId from the verified manifest is required/],
    ["an unknown track", { beats: BEATS, callbackUrl, musicTrackId: "not-a-track" }, 400, /not an approved track/],
    ["a file path", { beats: BEATS, callbackUrl, musicTrackId: TRACK_ID, musicTrackPath: "music/x.mp3" }, 400, /not accepted/],
    ["a placeholder that names a track", { beats: BEATS, callbackUrl, legacyPlaceholderMusic: true, musicTrackId: TRACK_ID }, 400, /cannot also name/]
  ];
  for (const [label, body, status, message] of refusals) {
    const response = await post(base, body);
    assert.equal(response.status, status, label);
    assert.match((await response.json()).error, message, label);
  }
  assert.equal(storage.events.length, 0, "no request was written");
  assert.equal(jobsClient.runs.length, 0, "no execution was started");
});

test("no render starts while the shared render job is not on a verified image", async (t) => {
  const withOldJob = await setup({ image: OLD_IMAGE });
  t.after(() => closeServer(withOldJob.server));
  const response = await post(withOldJob.base, { beats: BEATS, callbackUrl: "http://127.0.0.1:1/exec", musicTrackId: TRACK_ID });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /not running a music-verified image/);
  assert.equal(withOldJob.storage.events.length, 0);
  assert.equal(withOldJob.jobsClient.runs.length, 0);

  const withoutAllowlist = await setup({ config: Object.assign({}, CONFIG, { allowedRenderImages: [] }) });
  t.after(() => closeServer(withoutAllowlist.server));
  const refused = await post(withoutAllowlist.base, { beats: BEATS, callbackUrl: "http://127.0.0.1:1/exec", musicTrackId: TRACK_ID });
  assert.equal(refused.status, 409);
  assert.equal(withoutAllowlist.jobsClient.runs.length, 0);
});

test("a placeholder run is accepted only when it says so, and records no licensed track", async (t) => {
  const { storage, jobsClient, server, base } = await setup();
  const receiver = await callbackReceiver();
  t.after(() => Promise.all([closeServer(server), receiver.close()]));
  const jobId = "cr-33333333-3333-4333-8333-333333333333";
  const response = await post(base, { jobId, beats: BEATS, legacyPlaceholderMusic: true, callbackUrl: receiver.url });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).music, null, "no track summary is returned");
  assert.equal(storage.objects.get("job-requests/" + jobId + ".json").legacyPlaceholderMusic, true);
  await executeLastRun(jobsClient, { storage, pipeline: stubPipeline() });
  assert.equal(receiver.received[0].body.music.id, "");
  assert.equal(receiver.received[0].body.music.attribution, "");
});

test("a request with the wrong secret is refused before anything is uploaded", async (t) => {
  const { storage, jobsClient, server, base } = await setup();
  t.after(() => closeServer(server));
  const response = await post(base, { beats: BEATS, callbackUrl: "http://127.0.0.1:1/exec", musicTrackId: TRACK_ID }, "wrong-secret");
  assert.equal(response.status, 401);
  assert.equal(storage.events.length, 0);
  assert.equal(jobsClient.runs.length, 0);
});

test("the dispatcher reports the music protocol that the main app checks before sending a render", async (t) => {
  const { server, base } = await setup();
  t.after(() => closeServer(server));
  const health = await (await fetch(base + "/health")).json();
  assert.equal(health.musicProtocol, "verified-v1");
});

test("a jobId that is already waiting or already delivered starts no second execution", async (t) => {
  const { storage, jobsClient, server, base } = await setup();
  const receiver = await callbackReceiver();
  t.after(() => Promise.all([closeServer(server), receiver.close()]));
  const jobId = "cr-44444444-4444-4444-8444-444444444444";
  const body = { jobId, beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: receiver.url, callbackSecret: "s" };

  assert.equal((await post(base, body)).status, 202);
  assert.equal(jobsClient.runs.length, 1);

  // While the request is still waiting for its execution, a second submission is refused and writes nothing.
  const uploadsBefore = storage.events.length;
  const duplicate = await post(base, body);
  assert.equal(duplicate.status, 409);
  assert.equal(storage.events.length, uploadsBefore, "the waiting request is not overwritten");
  assert.equal(jobsClient.runs.length, 1, "no second execution");

  // After the render has delivered its video, the same jobId is still refused.
  await executeLastRun(jobsClient, { storage, pipeline: stubPipeline() });
  storage.objects.set("renders/" + jobId + "/final.mp4", { delivered: true });
  const afterDelivery = await post(base, body);
  assert.equal(afterDelivery.status, 409);
  assert.equal(jobsClient.runs.length, 1, "no re-render of a delivered video");
});

test("a malformed jobId is refused before it can name a storage path", async (t) => {
  const { storage, jobsClient, server, base } = await setup();
  t.after(() => closeServer(server));
  for (const jobId of ["../../etc/x", "short", "has spaces in it"]) {
    const response = await post(base, { jobId, beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: "http://127.0.0.1:1/exec" });
    assert.equal(response.status, 400, jobId);
  }
  assert.equal(storage.events.length, 0);
  assert.equal(jobsClient.runs.length, 0);
});

test("a storage failure while checking for duplicates refuses the submission rather than rendering", async (t) => {
  const { storage, jobsClient, server, base } = await setup();
  t.after(() => closeServer(server));
  storage.objectExists = async () => { throw new Error("storage unavailable"); };
  const response = await post(base, { jobId: "cr-55555555-5555-4555-8555-555555555555", beats: BEATS, musicTrackId: TRACK_ID, callbackUrl: "http://127.0.0.1:1/exec" });
  assert.equal(response.status, 503);
  assert.equal(storage.events.length, 0);
  assert.equal(jobsClient.runs.length, 0);
});
