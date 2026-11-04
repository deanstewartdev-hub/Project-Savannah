import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryJobStore, storageError } from "./helpers/memoryJobStore.js";
import {
  reserveJob, startAttempt, finishAttempt, failBeforeStart, markUncertain, recoverJob, recoveryConfirmation,
  statePath, JOB_STATES
} from "../src/lib/jobState.js";

const JOB = "cr-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = "2026-11-03T20:00:00.000Z";
const status = (store) => store.objects.get(statePath(JOB)).value.status;

test("two simultaneous submissions of one jobId: exactly one reserves it", async () => {
  const store = createMemoryJobStore();
  const results = await Promise.all([
    reserveJob(store, { jobId: JOB, attemptId: "att-1", now: NOW }),
    reserveJob(store, { jobId: JOB, attemptId: "att-2", now: NOW })
  ]);
  assert.equal(results.filter((r) => r.reserved).length, 1, "exactly one reservation");
  assert.equal(results.filter((r) => !r.reserved)[0].existing.status, JOB_STATES.QUEUED);
  assert.equal(store.objects.get(statePath(JOB)).value.attemptId, results.find((r) => r.reserved).record.attemptId);
});

test("a duplicate while queued is refused and does not replace the reservation", async () => {
  const store = createMemoryJobStore();
  await reserveJob(store, { jobId: JOB, attemptId: "att-1", now: NOW });
  const again = await reserveJob(store, { jobId: JOB, attemptId: "att-2", now: NOW });
  assert.equal(again.reserved, false);
  assert.equal(store.objects.get(statePath(JOB)).value.attemptId, "att-1");
});

test("a duplicate while running is refused", async () => {
  const store = createMemoryJobStore();
  await reserveJob(store, { jobId: JOB, attemptId: "att-1", now: NOW });
  assert.equal((await startAttempt(store, JOB, "att-1", NOW)).ok, true);
  assert.equal((await reserveJob(store, { jobId: JOB, attemptId: "att-2", now: NOW })).reserved, false);
  assert.equal(status(store), JOB_STATES.RUNNING);
});

test("a duplicate after success is refused, and a succeeded job is never recoverable", async () => {
  const store = createMemoryJobStore();
  await reserveJob(store, { jobId: JOB, attemptId: "att-1", now: NOW });
  await startAttempt(store, JOB, "att-1", NOW);
  await finishAttempt(store, JOB, "att-1", { status: JOB_STATES.SUCCEEDED, videoUrl: "https://v/final.mp4" }, NOW);
  assert.equal((await reserveJob(store, { jobId: JOB, attemptId: "att-2", now: NOW })).reserved, false);
  const recovered = await recoverJob(store, JOB, "att-3", recoveryConfirmation(JOB), NOW);
  assert.equal(recovered.ok, false);
  assert.equal(status(store), JOB_STATES.SUCCEEDED);
});

test("a duplicate after failure is refused, and recovery needs the exact confirmation", async () => {
  const store = createMemoryJobStore();
  await reserveJob(store, { jobId: JOB, attemptId: "att-1", now: NOW });
  await startAttempt(store, JOB, "att-1", NOW);
  await finishAttempt(store, JOB, "att-1", { status: JOB_STATES.FAILED, error: "boom" }, NOW);
  assert.equal((await reserveJob(store, { jobId: JOB, attemptId: "att-2", now: NOW })).reserved, false);
  assert.equal((await recoverJob(store, JOB, "att-2", "yes please", NOW)).reason, "confirmation");
  assert.equal(status(store), JOB_STATES.FAILED, "a refused recovery changes nothing");
  const recovered = await recoverJob(store, JOB, "att-2", recoveryConfirmation(JOB), NOW);
  assert.equal(recovered.ok, true);
  assert.equal(status(store), JOB_STATES.QUEUED);
  assert.equal(store.objects.get(statePath(JOB)).value.history.length, 4, "the history keeps every attempt");
});

test("a Cloud Storage error on reserve throws, so the caller refuses to start (fails closed)", async () => {
  const store = createMemoryJobStore({ failOn: { create: storageError(503) } });
  await assert.rejects(reserveJob(store, { jobId: JOB, attemptId: "att-1", now: NOW }), /503/);
  assert.equal(store.objects.has(statePath(JOB)), false, "nothing was written");
});

test("a Cloud Storage error while reading state throws, so an execution cannot start", async () => {
  const store = createMemoryJobStore({ failOn: { read: storageError(500) } });
  await assert.rejects(startAttempt(store, JOB, "att-1", NOW), /500/);
});

test("a Cloud Storage error while recording the outcome throws, and the job stays running (blocked)", async () => {
  const store = createMemoryJobStore();
  await reserveJob(store, { jobId: JOB, attemptId: "att-1", now: NOW });
  await startAttempt(store, JOB, "att-1", NOW);
  // The same state, but the outcome write fails.
  const failing = createMemoryJobStore({ failOn: { replace: storageError(503) } });
  failing.objects.set(statePath(JOB), store.objects.get(statePath(JOB)));
  await assert.rejects(finishAttempt(failing, JOB, "att-1", { status: JOB_STATES.SUCCEEDED }, NOW), /503/);
  assert.equal(failing.objects.get(statePath(JOB)).value.status, JOB_STATES.RUNNING);
});

test("an uncertain Cloud Run start is never restarted automatically; only recovery restarts it", async () => {
  const store = createMemoryJobStore();
  await reserveJob(store, { jobId: JOB, attemptId: "att-1", now: NOW });
  assert.equal((await markUncertain(store, JOB, "att-1", "deadline exceeded", NOW)).ok, true);
  assert.equal(status(store), JOB_STATES.UNCERTAIN);
  assert.equal((await reserveJob(store, { jobId: JOB, attemptId: "att-2", now: NOW })).reserved, false);
  assert.equal((await recoverJob(store, JOB, "att-2", recoveryConfirmation(JOB), NOW)).ok, true);
});

test("a definite failure to start ends the attempt as failed", async () => {
  const store = createMemoryJobStore();
  await reserveJob(store, { jobId: JOB, attemptId: "att-1", now: NOW });
  assert.equal((await failBeforeStart(store, JOB, "att-1", "permission denied", NOW)).ok, true);
  assert.equal(status(store), JOB_STATES.FAILED);
});

test("an interrupted process leaves the job running; recovery starts a new attempt and the old one cannot finish", async () => {
  const store = createMemoryJobStore();
  await reserveJob(store, { jobId: JOB, attemptId: "att-1", now: NOW });
  await startAttempt(store, JOB, "att-1", NOW);
  // The process dies here. The state still says running, so a duplicate is refused.
  assert.equal((await reserveJob(store, { jobId: JOB, attemptId: "att-2", now: NOW })).reserved, false);
  assert.equal((await recoverJob(store, JOB, "att-2", recoveryConfirmation(JOB), NOW)).ok, true);
  // A stale execution of attempt 1 wakes up: it must not start or finish anything.
  assert.equal((await startAttempt(store, JOB, "att-1", NOW)).ok, false);
  assert.equal((await finishAttempt(store, JOB, "att-1", { status: JOB_STATES.SUCCEEDED }, NOW)).ok, false);
  assert.equal(status(store), JOB_STATES.QUEUED);
  // The recovered attempt runs normally.
  assert.equal((await startAttempt(store, JOB, "att-2", NOW)).ok, true);
});

test("a stale write that lost the generation race is refused, so one writer wins", async () => {
  const store = createMemoryJobStore();
  await reserveJob(store, { jobId: JOB, attemptId: "att-1", now: NOW });
  const stale = await store.read(statePath(JOB));
  await startAttempt(store, JOB, "att-1", NOW); // advances the generation
  const outcome = await store.replaceIfGeneration(statePath(JOB), Object.assign({}, stale.value, { status: "failed" }), stale.generation);
  assert.deepEqual(outcome, { ok: false, reason: "changed" });
  assert.equal(status(store), JOB_STATES.RUNNING);
});

test("a state record is kept with no request payload: duplicate protection does not depend on the payload", async () => {
  const store = createMemoryJobStore();
  await reserveJob(store, { jobId: JOB, attemptId: "att-1", now: NOW });
  const record = store.objects.get(statePath(JOB)).value;
  assert.equal(record.beats, undefined);
  assert.equal(record.callbackSecret, undefined, "no secret is stored in the state record");
  assert.equal(record.jobId, JOB);
});
