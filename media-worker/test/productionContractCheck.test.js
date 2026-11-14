import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createDispatcherApp } from "../src/lib/dispatcherApp.js";
import { createMemoryJobStore } from "./helpers/memoryJobStore.js";
import { identityProblems, assertRefusedByConstruction } from "../../tools/production/verify-worker-contract.mjs";

// The production contract check runs as a separate process against the real dispatcher app (in memory, with fake Cloud
// Run). Every request it sends must be refused, so the fake job client must record no execution and the store no state.

const SCRIPT = fileURLToPath(new URL("../../tools/production/verify-worker-contract.mjs", import.meta.url));
const IMAGE = "europe-west2-docker.pkg.dev/p/r/media-worker@sha256:verified";
const SECRET = "contract-secret-for-tests";
const PROJECT = "savannah-media-worker";
const SERVICE = "savannah-media-worker-dispatcher";
const CALLBACK = "https://script.google.com/macros/s/TEST/exec?route=media-worker-callback";

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
    environment: "production", serviceName: SERVICE, jobRequestPrefix: "job-requests/", jobSubmitSecret: SECRET,
    project: PROJECT, region: "europe-west2", renderJobName: "savannah-render-job", allowedRenderImages: [IMAGE],
    callbackUrlAllowlist: [CALLBACK], requireSubmitIntent: true, submissionsPaused: false
  }, overrides);
  const app = createDispatcherApp({ config, jobsClient, executionsClient: { getExecution: async () => [{}] },
    storage: fakeStorage(), jobStore, manifest: { tracks: [] }, buildStatusResponse: async () => ({ status: 200, body: {} }) });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    return await run({ url, jobStore, jobsClient });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function runScript(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT], { env: Object.assign({}, process.env, env), stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("close", (code) => resolve({ code, output }));
  });
}

const env = (url, extra = {}) => Object.assign({
  PRODUCTION_DISPATCHER_URL: url, PRODUCTION_PROJECT_ID: PROJECT, PRODUCTION_SERVICE_NAME: SERVICE,
  PRODUCTION_SUBMIT_SECRET: SECRET, EXPECT_SUBMISSIONS_PAUSED: "no", EXPECT_REQUIRE_SUBMIT_INTENT: "yes"
}, extra);

test("the contract check passes against the expected production state, and starts nothing", async () => {
  await withDispatcher({}, async ({ url, jobStore, jobsClient }) => {
    const result = await runScript(env(url));
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Production contract check \(non-executing\): 10\/10 passed/);
    assert.equal(jobsClient.runs.length, 0, "no execution");
    assert.equal(jobStore.objects.size, 0, "no job state");
    assert.ok(!result.output.includes(SECRET), "the secret is never printed");
  });
});

test("a paused worker passes the check when paused is the expected state, and still starts nothing", async () => {
  await withDispatcher({ submissionsPaused: true }, async ({ url, jobStore, jobsClient }) => {
    const result = await runScript(env(url, { EXPECT_SUBMISSIONS_PAUSED: "yes" }));
    assert.equal(result.code, 0, result.output);
    assert.equal(jobsClient.runs.length, 0);
    assert.equal(jobStore.objects.size, 0);
  });
});

test("a deployment whose switches differ from the expected state fails the check, and starts nothing", async () => {
  await withDispatcher({ submissionsPaused: false }, async ({ url, jobsClient }) => {
    const result = await runScript(env(url, { EXPECT_SUBMISSIONS_PAUSED: "yes" }));
    assert.equal(result.code, 1);
    assert.match(result.output, /FAIL the maintenance switch is as expected/);
    assert.equal(jobsClient.runs.length, 0);
  });
});

test("the check refuses to run against a staging identity, before any request is made", async () => {
  await withDispatcher({}, async ({ url, jobsClient }) => {
    const result = await runScript(env(url, { PRODUCTION_PROJECT_ID: "savannah-staging-worker", PRODUCTION_SERVICE_NAME: "savannah-staging-dispatcher" }));
    assert.equal(result.code, 1);
    assert.match(result.output, /REFUSED TO RUN: The expected identity names staging/);
    assert.ok(!/PASS |FAIL /.test(result.output), "no check ran");
    assert.equal(jobsClient.runs.length, 0);
  });
});

test("the check refuses an unset switch expectation and a staging-named URL", () => {
  assert.ok(identityProblems({ PRODUCTION_DISPATCHER_URL: "https://x.test", PRODUCTION_PROJECT_ID: PROJECT,
    PRODUCTION_SERVICE_NAME: SERVICE, PRODUCTION_SUBMIT_SECRET: SECRET }).some((p) => /EXPECT_SUBMISSIONS_PAUSED/.test(p)));
  assert.ok(identityProblems({ PRODUCTION_DISPATCHER_URL: "https://staging-dispatcher.test", PRODUCTION_PROJECT_ID: PROJECT,
    PRODUCTION_SERVICE_NAME: SERVICE, PRODUCTION_SUBMIT_SECRET: SECRET, EXPECT_SUBMISSIONS_PAUSED: "no",
    EXPECT_REQUIRE_SUBMIT_INTENT: "yes" }).some((p) => /URL names staging/.test(p)));
});

test("every POST body in the check is invalid by construction: a body that could start a render cannot be sent", () => {
  assert.doesNotThrow(() => assertRefusedByConstruction({ beats: [] }));
  assert.throws(() => assertRefusedByConstruction({ beats: [{ text: "x", visualQuery: "y" }] }), /Not sent/);
  assert.equal(typeof randomUUID(), "string");
});
