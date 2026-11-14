import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createDispatcherApp } from "../src/lib/dispatcherApp.js";
import { createMemoryJobStore } from "./helpers/memoryJobStore.js";

// The maintenance gate: while submissions are paused, no route may write job state or start an execution. Everything is
// in-memory and fake. Nothing reaches Cloud Run or a paid service.

const IMAGE = "europe-west2-docker.pkg.dev/p/r/media-worker@sha256:verified";
const TRACK_ID = "scott-buckley-beyond-these-walls";
const SECRET = "gate-secret-for-tests";
const CALLBACK = "https://script.google.com/macros/s/TEST/exec?route=media-worker-callback";
const MANIFEST = { tracks: [{
  id: TRACK_ID, file: "music/scott-buckley-beyond-these-walls.mp3", title: "Beyond These Walls", licence: "CC-BY-4.0",
  sourceUrl: "https://www.scottbuckley.com.au/library/beyond-these-walls/",
  termsUrl: "https://www.scottbuckley.com.au/library/beyond-these-walls/",
  verifiedBy: "integration-test", verifiedOn: "2026-11-03", attributionRequired: true,
  attribution: "'Beyond These Walls' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au.",
  monetizationAllowed: true
}] };

function config(extra = {}) {
  return Object.assign({
    environment: "production", serviceName: "savannah-media-worker-dispatcher", jobRequestPrefix: "job-requests/",
    jobSubmitSecret: SECRET, project: "p", region: "europe-west2", renderJobName: "savannah-render-job",
    allowedRenderImages: [IMAGE], callbackUrlAllowlist: [CALLBACK]
  }, extra);
}

function fakeStorage() {
  const objects = new Map();
  return {
    objects,
    uploadJson: async (p, body) => { objects.set(p, JSON.parse(JSON.stringify(body))); },
    downloadJson: async (p) => JSON.parse(JSON.stringify(objects.get(p))),
    objectExists: async (p) => objects.has(p),
    deleteObject: async (p) => { objects.delete(p); }
  };
}

function fakeJobsClient() {
  const client = { runs: [],
    getJob: async () => [{ template: { template: { containers: [{ image: IMAGE }] } } }],
    runJob: async (args) => { client.runs.push(args); return [{ name: "operations/1", metadata: { name: "executions/1" } }]; },
    checkRunJobProgress: async () => ({}) };
  return client;
}

// Starts the real dispatcher app on a random local port, runs the requests, and closes it.
async function withDispatcher(cfg, run) {
  const jobStore = createMemoryJobStore();
  const jobsClient = fakeJobsClient();
  const app = createDispatcherApp({ config: cfg, jobsClient, executionsClient: { getExecution: async () => [{}] },
    storage: fakeStorage(), jobStore, manifest: MANIFEST, buildStatusResponse: async () => ({ status: 200, body: {} }) });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    return await run({ base, jobStore, jobsClient });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function submission() {
  return {
    jobId: "cr-" + randomUUID(),
    beats: [{ text: "Blue walls and quiet streets.", visualQuery: "blue street" }],
    musicTrackId: TRACK_ID, callbackUrl: CALLBACK,
    submitIntentId: "rq-gate-0001", scriptId: "SCR-1", renderVersion: 1
  };
}

async function post(base, route, body) {
  const response = await fetch(base + route, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

test("while paused, a submission is refused with 503 before any job state is written or any execution starts", async () => {
  await withDispatcher(config({ submissionsPaused: true }), async ({ base, jobStore, jobsClient }) => {
    const answer = await post(base, "/jobs", submission());
    assert.equal(answer.status, 503);
    assert.equal(answer.body.paused, true);
    assert.equal(jobStore.objects.size, 0, "no job state was written");
    assert.equal(jobsClient.runs.length, 0, "no execution was started");
  });
});

test("while paused, recovery is refused before it reads or changes a job, and starts nothing", async () => {
  await withDispatcher(config({ submissionsPaused: true }), async ({ base, jobStore, jobsClient }) => {
    const answer = await post(base, "/jobs/recover", { jobId: "cr-" + randomUUID(), confirm: true });
    assert.equal(answer.status, 503);
    assert.equal(jobStore.objects.size, 0, "no job state was touched");
    assert.equal(jobsClient.runs.length, 0);
  });
});

test("the health report says whether submissions are paused and whether intents are required", async () => {
  await withDispatcher(config({ submissionsPaused: true, requireSubmitIntent: false }), async ({ base }) => {
    const health = await (await fetch(base + "/health")).json();
    assert.equal(health.submissionsPaused, true);
    assert.equal(health.requireSubmitIntent, false);
  });
  await withDispatcher(config({ requireSubmitIntent: true }), async ({ base }) => {
    const health = await (await fetch(base + "/health")).json();
    assert.equal(health.submissionsPaused, false, "unset means open");
    assert.equal(health.requireSubmitIntent, true);
  });
});

test("when not paused, the same submission is accepted (the gate changes nothing else)", async () => {
  await withDispatcher(config({ submissionsPaused: false }), async ({ base, jobsClient }) => {
    const answer = await post(base, "/jobs", submission());
    assert.equal(answer.status, 202, answer.body && answer.body.error);
    assert.equal(jobsClient.runs.length, 1);
  });
});

test("the environment switches map exactly: only the value yes turns each one on", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const script = "import('./src/dispatcherConfig.js').then((m) => console.log(JSON.stringify({" +
    "paused: m.dispatcherConfig.submissionsPaused, intent: m.dispatcherConfig.requireSubmitIntent })))";
  const base = {
    CLOUD_RUN_PROJECT: "savannah-media-worker", GCS_BUCKET: "savannah-media-worker-bucket",
    RENDER_JOB_NAME: "savannah-render-job", JOB_SUBMIT_SECRET: SECRET
  };
  const run = (extra) => {
    const result = spawnSync(process.execPath, ["-e", script], { cwd: path.resolve(here, ".."), encoding: "utf8",
      env: Object.assign({}, process.env, base, extra) });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout.trim());
  };
  assert.deepEqual(run({}), { paused: false, intent: false }, "unset means open and not required");
  assert.deepEqual(run({ SUBMISSIONS_PAUSED: "yes", REQUIRE_SUBMIT_INTENT: "yes" }), { paused: true, intent: true });
  assert.deepEqual(run({ SUBMISSIONS_PAUSED: "true", REQUIRE_SUBMIT_INTENT: "1" }), { paused: false, intent: false },
    "anything other than the exact value yes leaves the switch off");
});
