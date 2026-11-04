import { test } from "node:test";
import assert from "node:assert/strict";
import { executeRenderRequest } from "../src/lib/renderRequest.js";
import { reserveJob, startAttempt, statePath, JOB_STATES } from "../src/lib/jobState.js";
import { createMemoryJobStore, storageError } from "./helpers/memoryJobStore.js";

// The job-side request handler, with in-memory storage and job state. A pipeline stub and a recording callback stand in
// for the paid steps and the network. Only the handler's own decisions are under test here.

const JOB = "cr-66666666-6666-4666-8666-666666666666";
const PATH = "job-requests/" + JOB + ".json";
const NOW = "2026-11-04T09:00:00.000Z";
const silent = { log() {}, error() {} };
const REQUEST = { jobId: JOB, beats: [{ text: "x", visualQuery: "y" }], musicTrackId: "t", callbackUrl: "https://script.example.test/staging-exec", callbackSecret: "s" };

function storageWith(request = REQUEST) {
  const objects = new Map([[PATH, JSON.parse(JSON.stringify(request))]]);
  const calls = { deletes: 0 };
  return {
    objects,
    calls,
    downloadJson: async (path) => {
      if (!objects.has(path)) throw new Error("not found: " + path);
      return JSON.parse(JSON.stringify(objects.get(path)));
    },
    deleteObject: async (path) => { calls.deletes++; objects.delete(path); }
  };
}

async function reservedStore(attemptId = "att-1") {
  const store = createMemoryJobStore();
  await reserveJob(store, { jobId: JOB, attemptId, now: NOW });
  return store;
}

const successPipeline = async ({ jobId }) => ({ jobId, status: "completed", video: { url: "https://v/" + jobId + ".mp4" }, music: { id: "t", attribution: "" } });
const recordingCallback = () => {
  const calls = [];
  const post = async (url, body) => { calls.push({ url, body }); };
  return { calls, post };
};

test("the attempt that holds the job runs it, records success, and posts one callback", async () => {
  const store = await reservedStore();
  const callback = recordingCallback();
  const outcome = await executeRenderRequest({
    jobId: JOB, attemptId: "att-1", requestPath: PATH, storage: storageWith(), jobStore: store,
    runJob: successPipeline, postCallback: callback.post, now: () => NOW, log: silent
  });
  assert.equal(outcome.status, "completed");
  assert.equal(store.objects.get(statePath(JOB)).value.status, JOB_STATES.SUCCEEDED);
  assert.equal(callback.calls.length, 1);
});

test("an attempt that does not hold the job is refused, and nothing is read, deleted or rendered", async () => {
  const store = await reservedStore("att-1");
  const storage = storageWith();
  let rendered = false;
  const outcome = await executeRenderRequest({
    jobId: JOB, attemptId: "some-other-attempt", requestPath: PATH, storage, jobStore: store,
    runJob: async () => { rendered = true; }, postCallback: async () => {}, now: () => NOW, log: silent
  });
  assert.equal(outcome.status, "refused");
  assert.equal(rendered, false);
  assert.equal(storage.calls.deletes, 0);
  assert.equal(storage.objects.has(PATH), true, "the payload is left alone");
});

test("a callback endpoint outside this environment's allowlist fails the attempt before any render", async () => {
  const store = await reservedStore();
  const callback = recordingCallback();
  let rendered = false;
  const outcome = await executeRenderRequest({
    jobId: JOB, attemptId: "att-1", requestPath: PATH, storage: storageWith(), jobStore: store,
    runJob: async () => { rendered = true; }, postCallback: callback.post,
    callbackAllowlist: ["https://script.example.test/only-this"], now: () => NOW, log: silent
  });
  assert.equal(outcome.status, "failed");
  assert.equal(rendered, false, "nothing is rendered for an endpoint this environment may not use");
  assert.equal(callback.calls.length, 0, "nothing is posted");
  assert.equal(store.objects.get(statePath(JOB)).value.status, JOB_STATES.FAILED);
});

test("a payload that cannot be deleted is logged, and the job still runs and records its outcome", async () => {
  const store = await reservedStore();
  const storage = storageWith();
  storage.deleteObject = async () => { throw storageError(500); };
  const errors = [];
  const outcome = await executeRenderRequest({
    jobId: JOB, attemptId: "att-1", requestPath: PATH, storage, jobStore: store,
    runJob: successPipeline, postCallback: async () => {}, now: () => NOW,
    log: { log() {}, error: (...args) => errors.push(args.join(" ")) }
  });
  assert.equal(outcome.status, "completed");
  assert.ok(errors.some((line) => /payload could not be deleted/.test(line)));
  assert.equal(store.objects.get(statePath(JOB)).value.status, JOB_STATES.SUCCEEDED);
});

test("a callback that cannot be delivered is logged; the outcome is still recorded as succeeded", async () => {
  const store = await reservedStore();
  const errors = [];
  const outcome = await executeRenderRequest({
    jobId: JOB, attemptId: "att-1", requestPath: PATH, storage: storageWith(), jobStore: store,
    runJob: successPipeline, postCallback: async () => { throw new Error("network down"); }, now: () => NOW,
    log: { log() {}, error: (...args) => errors.push(args.join(" ")) }
  });
  assert.equal(outcome.status, "completed");
  assert.equal(store.objects.get(statePath(JOB)).value.status, JOB_STATES.SUCCEEDED);
});

test("a state write that fails after a successful render is logged and the job stays running (blocked, not guessed)", async () => {
  // Only the success write fails: starting the attempt works, and the render then completes.
  const store = await reservedStore();
  const realReplace = store.replaceIfGeneration.bind(store);
  store.replaceIfGeneration = async (path, value, generation) => {
    if (value.status === JOB_STATES.SUCCEEDED) throw storageError(503);
    return realReplace(path, value, generation);
  };
  const callback = recordingCallback();
  const errors = [];
  const outcome = await executeRenderRequest({
    jobId: JOB, attemptId: "att-1", requestPath: PATH, storage: storageWith(), jobStore: store,
    runJob: successPipeline, postCallback: callback.post, now: () => NOW,
    log: { log() {}, error: (...args) => errors.push(args.join(" ")) }
  });
  assert.equal(outcome.status, "completed", "the render is real, so the callback is still posted");
  assert.equal(callback.calls.length, 1);
  assert.ok(errors.some((line) => /stays running until recovered/.test(line)));
  assert.equal(store.objects.get(statePath(JOB)).value.status, JOB_STATES.RUNNING);
});

test("an unreadable payload fails the attempt and records why", async () => {
  const store = await reservedStore();
  const storage = storageWith();
  storage.objects.delete(PATH);
  const outcome = await executeRenderRequest({
    jobId: JOB, attemptId: "att-1", requestPath: PATH, storage, jobStore: store,
    runJob: successPipeline, postCallback: async () => {}, now: () => NOW, log: silent
  });
  assert.equal(outcome.status, "failed");
  assert.match(store.objects.get(statePath(JOB)).value.error, /could not be read/);
});
