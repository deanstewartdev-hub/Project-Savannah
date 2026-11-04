import { test } from "node:test";
import assert from "node:assert/strict";
import { createJobStateStore } from "../src/lib/jobStateStore.js";
import {
  reserveJob, startAttempt, finishAttempt, failBeforeStart, recoverJob, recoveryConfirmation, statePath, JOB_STATES
} from "../src/lib/jobState.js";
import { createMemoryJobStore } from "./helpers/memoryJobStore.js";

// A fake Cloud Storage bucket with generation semantics and no object versioning: a download of a generation that has
// been replaced fails with 404, as it does for a bucket without versioning. Hooks let a competing writer act between
// the steps of one operation, which is the race under test. putRaw is a competitor that ignores preconditions.

const JOB = "cr-77777777-7777-4777-8777-777777777777";
const PATH = statePath(JOB);
const NOW = "2026-11-04T10:00:00.000Z";

function httpError(code) {
  return Object.assign(new Error("simulated HTTP " + code), { code: code });
}

function fakeBucket() {
  let counter = 0;
  const current = new Map();
  const hooks = { beforeMetadata: null, afterMetadata: null, beforeSave: null };
  const bucket = {
    current,
    hooks,
    putRaw(path, text) {
      counter += 1;
      current.set(path, { generation: counter, text: text });
      return counter;
    },
    file(path, options = {}) {
      return {
        async exists() { return [current.has(path)]; },
        async getMetadata() {
          if (hooks.beforeMetadata) { const hook = hooks.beforeMetadata; hooks.beforeMetadata = null; await hook(path); }
          const version = current.get(path);
          if (!version) throw httpError(404);
          const generation = version.generation;
          if (hooks.afterMetadata) { const hook = hooks.afterMetadata; hooks.afterMetadata = null; await hook(path); }
          return [{ generation: generation }];
        },
        async download() {
          const version = current.get(path);
          if (!version) throw httpError(404);
          if (options.generation !== undefined && options.generation !== version.generation) throw httpError(404);
          return [Buffer.from(version.text, "utf8")];
        },
        async save(data, saveOptions = {}) {
          if (hooks.beforeSave) { const hook = hooks.beforeSave; hooks.beforeSave = null; await hook(path); }
          const precondition = saveOptions.preconditionOpts || {};
          const version = current.get(path);
          if (precondition.ifGenerationMatch === 0) {
            if (version) throw httpError(412);
          } else if (precondition.ifGenerationMatch !== undefined) {
            if (!version || version.generation !== precondition.ifGenerationMatch) throw httpError(412);
          }
          bucket.putRaw(path, data);
        }
      };
    }
  };
  return bucket;
}

const recordOf = (bucket) => JSON.parse(bucket.current.get(PATH).text);

// ---- consistent reads ----

test("a read returns a value together with the generation that wrote it", async () => {
  const bucket = fakeBucket();
  const store = createJobStateStore(bucket);
  await reserveJob(store, { jobId: JOB, attemptId: "att-1", now: NOW });
  const read = await store.read(PATH);
  assert.equal(read.generation, String(bucket.current.get(PATH).generation));
  assert.equal(read.value.status, JOB_STATES.QUEUED);
});

test("a writer that replaces the object between the metadata read and the download is retried, and the result is consistent", async () => {
  const bucket = fakeBucket();
  const store = createJobStateStore(bucket);
  await reserveJob(store, { jobId: JOB, attemptId: "att-1", now: NOW });
  // Between reading the generation and downloading it, another writer moves the job to running.
  bucket.hooks.afterMetadata = async () => {
    bucket.putRaw(PATH, JSON.stringify(Object.assign(recordOf(bucket), { status: JOB_STATES.RUNNING })));
  };
  const read = await store.read(PATH);
  assert.equal(read.value.status, JOB_STATES.RUNNING, "the newer content is returned");
  assert.equal(read.generation, String(bucket.current.get(PATH).generation), "with the generation that wrote it");
});

test("a read that keeps racing fails closed rather than returning a value from one write with another write's generation", async () => {
  const bucket = fakeBucket();
  const store = createJobStateStore(bucket);
  await reserveJob(store, { jobId: JOB, attemptId: "att-1", now: NOW });
  let races = 0;
  const racing = async () => {
    races += 1;
    bucket.putRaw(PATH, JSON.stringify(Object.assign(recordOf(bucket), { error: "race " + races })));
    bucket.hooks.afterMetadata = racing;
  };
  bucket.hooks.afterMetadata = racing;
  await assert.rejects(store.read(PATH), /kept changing during the read/);
});

test("an object deleted during the read is reported as absent, not as an error", async () => {
  const bucket = fakeBucket();
  const store = createJobStateStore(bucket);
  await reserveJob(store, { jobId: JOB, attemptId: "att-1", now: NOW });
  bucket.hooks.beforeMetadata = async () => { bucket.current.delete(PATH); };
  assert.equal(await store.read(PATH), null);
});

test("a storage error other than the expected outcomes is thrown, so the caller fails closed", async () => {
  const bucket = fakeBucket();
  const store = createJobStateStore(bucket);
  await reserveJob(store, { jobId: JOB, attemptId: "att-1", now: NOW });
  const file = bucket.file.bind(bucket);
  bucket.file = (path, options) => {
    const handle = file(path, options);
    return Object.assign({}, handle, { download: async () => { throw httpError(503); } });
  };
  await assert.rejects(store.read(PATH), /503/);
});

// ---- stale writes never overwrite a newer state ----

// The state records each competitor would leave behind, computed with the same transitions on a memory store.
async function recordsFor() {
  const mem = createMemoryJobStore();
  await reserveJob(mem, { jobId: JOB, attemptId: "att-1", now: NOW });
  const queued = JSON.parse(JSON.stringify(mem.objects.get(PATH).value));
  await startAttempt(mem, JOB, "att-1", NOW);
  const running = JSON.parse(JSON.stringify(mem.objects.get(PATH).value));
  await finishAttempt(mem, JOB, "att-1", { status: JOB_STATES.FAILED, error: "boom" }, NOW);
  const failed = JSON.parse(JSON.stringify(mem.objects.get(PATH).value));
  await recoverJob(mem, JOB, "att-2", recoveryConfirmation(JOB), NOW);
  const recovered = JSON.parse(JSON.stringify(mem.objects.get(PATH).value));
  await startAttempt(mem, JOB, "att-2", NOW);
  await finishAttempt(mem, JOB, "att-2", { status: JOB_STATES.SUCCEEDED, videoUrl: "https://v/final.mp4" }, NOW);
  const succeeded = JSON.parse(JSON.stringify(mem.objects.get(PATH).value));
  return { queued: queued, running: running, failed: failed, recovered: recovered, succeeded: succeeded };
}

// Runs `operation` (which read the state before the competitor wrote its record) and checks that the write is refused
// and the competitor's newer state is what remains.
async function assertStaleRefused(name, competitor, stalePrepare, operation) {
  const bucket = fakeBucket();
  const store = createJobStateStore(bucket);
  await stalePrepare(store);
  bucket.hooks.beforeSave = async () => { bucket.putRaw(PATH, JSON.stringify(competitor)); };
  const result = await operation(store);
  assert.equal(result.ok, false, name + ": the stale write must be refused");
  assert.equal(result.reason, "changed", name + ": refused because the generation changed");
  assert.deepEqual(recordOf(bucket), competitor, name + ": the newer state is intact");
}

test("a stale write cannot overwrite a newer queued state (recovered by an operator)", async () => {
  const records = await recordsFor();
  await assertStaleRefused("queued",
    records.recovered,
    async (store) => { await reserveJob(store, { jobId: JOB, attemptId: "att-1", now: NOW }); await startAttempt(store, JOB, "att-1", NOW); await finishAttempt(store, JOB, "att-1", { status: JOB_STATES.FAILED }, NOW); },
    (store) => recoverJob(store, JOB, "att-3", recoveryConfirmation(JOB), NOW));
});

test("a stale write cannot overwrite a newer running state", async () => {
  const records = await recordsFor();
  await assertStaleRefused("running",
    records.running,
    async (store) => { await reserveJob(store, { jobId: JOB, attemptId: "att-1", now: NOW }); },
    (store) => failBeforeStart(store, JOB, "att-1", "stale failure", NOW));
});

test("a stale write cannot overwrite a newer failed state", async () => {
  const records = await recordsFor();
  await assertStaleRefused("failed",
    records.failed,
    async (store) => { await reserveJob(store, { jobId: JOB, attemptId: "att-1", now: NOW }); await startAttempt(store, JOB, "att-1", NOW); },
    (store) => finishAttempt(store, JOB, "att-1", { status: JOB_STATES.SUCCEEDED, videoUrl: "https://stale/v.mp4" }, NOW));
});

test("a stale write cannot overwrite a newer succeeded state", async () => {
  const records = await recordsFor();
  await assertStaleRefused("succeeded",
    records.succeeded,
    async (store) => { await reserveJob(store, { jobId: JOB, attemptId: "att-1", now: NOW }); await startAttempt(store, JOB, "att-1", NOW); },
    (store) => finishAttempt(store, JOB, "att-1", { status: JOB_STATES.FAILED, error: "stale" }, NOW));
});

test("a stale write cannot overwrite a newer recovered state", async () => {
  const records = await recordsFor();
  await assertStaleRefused("recovered",
    records.recovered,
    async (store) => { await reserveJob(store, { jobId: JOB, attemptId: "att-1", now: NOW }); await startAttempt(store, JOB, "att-1", NOW); await finishAttempt(store, JOB, "att-1", { status: JOB_STATES.FAILED }, NOW); },
    (store) => recoverJob(store, JOB, "att-9", recoveryConfirmation(JOB), NOW));
});

test("a stale creation cannot replace a state that another submission already created", async () => {
  const records = await recordsFor();
  const bucket = fakeBucket();
  const store = createJobStateStore(bucket);
  bucket.hooks.beforeSave = async () => { bucket.putRaw(PATH, JSON.stringify(records.queued)); };
  const result = await reserveJob(store, { jobId: JOB, attemptId: "att-late", now: NOW });
  assert.equal(result.reserved, false);
  assert.deepEqual(recordOf(bucket), records.queued);
});

test("with no competitor, the same operations succeed and leave a consistent record", async () => {
  const bucket = fakeBucket();
  const store = createJobStateStore(bucket);
  assert.equal((await reserveJob(store, { jobId: JOB, attemptId: "att-1", now: NOW })).reserved, true);
  assert.equal((await startAttempt(store, JOB, "att-1", NOW)).ok, true);
  assert.equal((await finishAttempt(store, JOB, "att-1", { status: JOB_STATES.SUCCEEDED, videoUrl: "https://v" }, NOW)).ok, true);
  assert.equal(recordOf(bucket).status, JOB_STATES.SUCCEEDED);
});
