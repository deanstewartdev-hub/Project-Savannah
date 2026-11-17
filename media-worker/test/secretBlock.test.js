import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDispatcherApp } from "../src/lib/dispatcherApp.js";
import { createMemoryJobStore } from "./helpers/memoryJobStore.js";

// The independent block on paid submissions: the worker accepts only its current secret. It needs no new code, so it
// also holds for a legacy caller (an Apps Script that predates the pause gate). The auth check runs before any handler,
// so a refused request writes no job state and starts no execution. Everything here is in memory and fake.

const IMAGE = "europe-west2-docker.pkg.dev/p/r/media-worker@sha256:verified";
const TRACK_ID = "scott-buckley-beyond-these-walls";
const LEGACY_SECRET = "legacy-secret-held-by-old-caller";
const CURRENT_SECRET = "current-secret-held-by-owner-only";
const CALLBACK = "https://script.google.com/macros/s/TEST/exec?route=media-worker-callback";
const MANIFEST = { tracks: [{
  id: TRACK_ID, file: "music/scott-buckley-beyond-these-walls.mp3", title: "Beyond These Walls", licence: "CC-BY-4.0",
  sourceUrl: "https://www.scottbuckley.com.au/library/beyond-these-walls/",
  termsUrl: "https://www.scottbuckley.com.au/library/beyond-these-walls/",
  verifiedBy: "integration-test", verifiedOn: "2026-11-03", attributionRequired: true,
  attribution: "'Beyond These Walls' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au.",
  monetizationAllowed: true
}] };

function fakeStorage() {
  const objects = new Map();
  return {
    uploadJson: async (p, body) => { objects.set(p, body); },
    downloadJson: async (p) => objects.get(p),
    objectExists: async (p) => objects.has(p),
    deleteObject: async (p) => { objects.delete(p); }
  };
}

async function withDispatcher(overrides, run) {
  const jobStore = createMemoryJobStore();
  const jobsClient = { runs: [],
    getJob: async () => [{ template: { template: { containers: [{ image: IMAGE }] } } }],
    runJob: async (args) => { jobsClient.runs.push(args); return [{ name: "operations/1", metadata: { name: "executions/1" } }]; },
    checkRunJobProgress: async () => ({}) };
  const config = Object.assign({
    environment: "production", serviceName: "savannah-media-worker-dispatcher", jobRequestPrefix: "job-requests/",
    jobSubmitSecret: CURRENT_SECRET, previousJobSubmitSecret: undefined, project: "savannah-media-worker",
    region: "europe-west2", renderJobName: "savannah-render-job", allowedRenderImages: [IMAGE],
    callbackUrlAllowlist: [CALLBACK], requireSubmitIntent: true, submissionsPaused: false
  }, overrides);
  const app = createDispatcherApp({ config, jobsClient, executionsClient: { getExecution: async () => [{}] },
    storage: fakeStorage(), jobStore, manifest: MANIFEST, buildStatusResponse: async () => ({ status: 200, body: {} }) });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    return await run({ base: "http://127.0.0.1:" + server.address().port, jobStore, jobsClient });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// A body that carries the intent fields, so only the secret decides the answer in the tests that use it.
function intentBody() {
  return Object.assign(legacyBody(), { submitIntentId: "rq-secret-0001", scriptId: "SCR-1", renderVersion: 1 });
}

// A legacy caller's body: no intent fields, so it is valid for the old code path. It would start a render if accepted.
function legacyBody() {
  return { jobId: "cr-" + randomUUID(), beats: [{ text: "Blue walls and quiet streets.", visualQuery: "blue street" }],
    musicTrackId: TRACK_ID, callbackUrl: CALLBACK };
}

async function post(base, route, secret, body) {
  const response = await fetch(base + route, { method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + secret }, body: JSON.stringify(body) });
  return { status: response.status };
}

test("after the worker rotates its secret, a legacy caller is refused with 401: no job state, no execution", async () => {
  await withDispatcher({}, async ({ base, jobStore, jobsClient }) => {
    const answer = await post(base, "/jobs", LEGACY_SECRET, legacyBody());
    assert.equal(answer.status, 401);
    assert.equal(jobStore.objects.size, 0, "no job state was written");
    assert.equal(jobsClient.runs.length, 0, "no execution was started");
  });
});

test("the same block refuses a legacy caller on recovery too", async () => {
  await withDispatcher({}, async ({ base, jobStore, jobsClient }) => {
    const answer = await post(base, "/jobs/recover", LEGACY_SECRET, { jobId: "cr-" + randomUUID(), confirm: true });
    assert.equal(answer.status, 401);
    assert.equal(jobStore.objects.size, 0);
    assert.equal(jobsClient.runs.length, 0);
  });
});

test("the block is about the secret, not a dead server: the current secret is still accepted", async () => {
  await withDispatcher({}, async ({ base, jobsClient }) => {
    const answer = await post(base, "/jobs", CURRENT_SECRET, intentBody());
    assert.equal(answer.status, 202);
    assert.equal(jobsClient.runs.length, 1);
  });
});

test("re-adding the previous secret as an overlap reopens the legacy caller: the runbook must never leave that set", async () => {
  await withDispatcher({ previousJobSubmitSecret: LEGACY_SECRET }, async ({ base, jobsClient }) => {
    const answer = await post(base, "/jobs", LEGACY_SECRET, intentBody());
    assert.equal(answer.status, 202, "the overlap accepts the legacy value, which is why it must be closed before any paid path reopens");
    assert.equal(jobsClient.runs.length, 1);
  });
});
