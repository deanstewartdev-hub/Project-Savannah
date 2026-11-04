import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createDispatcherApp } from "../src/lib/dispatcherApp.js";
import { createMemoryJobStore } from "./helpers/memoryJobStore.js";
import { identityProblems, assertExpectedIsStaging } from "../../tools/staging/verify-worker-staging.mjs";

// The staging verifier is tested against a real in-process dispatcher app, with a staging identity, through a child
// process running the script. It sends no paid request: every job request the script makes is one the dispatcher
// refuses, and it stops before sending anything if the identity does not match.

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "tools", "staging", "verify-worker-staging.mjs");
const SECRET = "staging-verifier-secret";
const STAGING = { project: "savannah-staging-worker", service: "savannah-staging-dispatcher" };
const IMAGE = "europe-west2-docker.pkg.dev/savannah-staging-worker/r/media-worker@sha256:verified";

function stagingConfig(overrides = {}) {
  return Object.assign({
    environment: "staging",
    serviceName: STAGING.service,
    project: STAGING.project,
    region: "europe-west2",
    renderJobName: "staging-render-job",
    jobRequestPrefix: "job-requests/",
    jobSubmitSecret: SECRET,
    previousJobSubmitSecret: undefined,
    allowedRenderImages: [IMAGE],
    callbackUrlAllowlist: ["https://script.example.test/staging-exec"]
  }, overrides);
}

async function startDispatcher(config) {
  const storage = { objects: new Map(), uploadJson: async () => {}, downloadJson: async () => ({}), objectExists: async () => false, deleteObject: async () => {} };
  const jobsClient = { runs: [], getJob: async () => [{ template: { template: { containers: [{ image: IMAGE }] } } }],
    runJob: async (args) => { jobsClient.runs.push(args); return [{ name: "operations/1", metadata: { name: "executions/1" } }]; } };
  const app = createDispatcherApp({ config, jobsClient, executionsClient: { getExecution: async () => [{}] }, storage,
    jobStore: createMemoryJobStore(), manifest: { tracks: [] }, buildStatusResponse: async () => ({ status: 200, body: {} }) });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const jobRequests = { count: 0 };
  // Counts every request that reaches the job endpoint, whatever the dispatcher answers.
  server.prependListener("request", (req) => { if (req.method === "POST" && req.url === "/jobs") jobRequests.count++; });
  return {
    base: "http://127.0.0.1:" + server.address().port,
    jobRequests,
    jobsClient,
    close: () => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); }
  };
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

test("identity: every expected field must match, and environment must be staging", () => {
  const health = { environment: "staging", project: STAGING.project, service: STAGING.service, musicProtocol: "verified-v1" };
  assert.deepEqual(identityProblems(health, STAGING), []);
  assert.equal(identityProblems(Object.assign({}, health, { environment: "production" }), STAGING).length, 1);
  assert.equal(identityProblems(Object.assign({}, health, { project: "savannah-media-worker" }), STAGING).length, 1);
  assert.equal(identityProblems(Object.assign({}, health, { service: "savannah-media-worker-dispatcher" }), STAGING).length, 1);
  assert.equal(identityProblems(Object.assign({}, health, { musicProtocol: undefined }), STAGING).length, 1);
  assert.equal(identityProblems(null, STAGING).length, 1);
});

test("an expected identity that does not itself name staging is refused, so the check cannot be aimed at production", () => {
  assert.throws(() => assertExpectedIsStaging({ project: "savannah-media-worker", service: "savannah-staging-dispatcher" }), /STAGING_PROJECT_ID/);
  assert.throws(() => assertExpectedIsStaging({ project: "savannah-staging-worker", service: "savannah-media-worker-dispatcher" }), /STAGING_SERVICE_NAME/);
  assert.doesNotThrow(() => assertExpectedIsStaging(STAGING));
});

test("the verifier passes against the expected staging dispatcher and sends only refused requests", async (t) => {
  const dispatcher = await startDispatcher(stagingConfig());
  t.after(() => dispatcher.close());
  const result = await runScript({
    STAGING_DISPATCHER_URL: dispatcher.base, STAGING_SUBMIT_SECRET: SECRET,
    STAGING_PROJECT_ID: STAGING.project, STAGING_SERVICE_NAME: STAGING.service
  });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /all 6 passed/);
  assert.equal(dispatcher.jobsClient.runs.length, 0, "no execution was started");
  assert.equal(dispatcher.jobRequests.count, 5, "exactly the five refused requests were sent, and no accepted one");
  assert.ok(!result.output.includes(SECRET), "the submit secret is never printed");
});

test("a dispatcher whose identity does not match is refused before any job request is sent", async (t) => {
  const dispatcher = await startDispatcher(stagingConfig());
  t.after(() => dispatcher.close());
  const result = await runScript({
    STAGING_DISPATCHER_URL: dispatcher.base, STAGING_SUBMIT_SECRET: SECRET,
    STAGING_PROJECT_ID: STAGING.project, STAGING_SERVICE_NAME: "savannah-staging-other-dispatcher"
  });
  assert.equal(result.code, 1);
  assert.match(result.output, /stopped before any request/);
  assert.equal(dispatcher.jobRequests.count, 0, "no job request reached the dispatcher");
});

test("a production dispatcher is refused even when its hostname and names are filled in to match", async (t) => {
  const dispatcher = await startDispatcher(stagingConfig({ environment: "production", serviceName: "savannah-media-worker-dispatcher", project: "savannah-media-worker" }));
  t.after(() => dispatcher.close());
  const result = await runScript({
    STAGING_DISPATCHER_URL: dispatcher.base, STAGING_SUBMIT_SECRET: SECRET,
    STAGING_PROJECT_ID: "savannah-media-worker", STAGING_SERVICE_NAME: "savannah-media-worker-dispatcher"
  });
  assert.equal(result.code, 1, "the expected names must name staging, so this is refused before the request");
  assert.equal(dispatcher.jobRequests.count, 0);
});

test("the verifier refuses to run without its identity settings", async () => {
  const result = await runScript({ STAGING_DISPATCHER_URL: "http://127.0.0.1:1", STAGING_SUBMIT_SECRET: SECRET });
  assert.equal(result.code, 1);
  assert.match(result.output, /STAGING_PROJECT_ID and STAGING_SERVICE_NAME are required/);
});
