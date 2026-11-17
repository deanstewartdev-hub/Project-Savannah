import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

// Parallel submissions across separate processes, each one a request to the real dispatcher HTTP app, sharing one
// on-disk state (the file stores in test/helpers/fileStores.js). In production the processes are Cloud Run instances
// and the state is Cloud Storage; the create-only write is what decides, and it is the same here. Nothing reaches
// Cloud Run: the job client only counts starts.

const HELPER = fileURLToPath(new URL("../harness/workerRequest.mjs", import.meta.url));
const IMAGE = "europe-west2-docker.pkg.dev/p/r/media-worker@sha256:verified";
const TRACK_ID = "scott-buckley-beyond-these-walls";
const SECRET = "submit-secret-for-tests";
const CALLBACK = "https://script.google.com/macros/s/TEST/exec?route=media-worker-callback";
const MANIFEST = { tracks: [{
  id: TRACK_ID, file: "music/scott-buckley-beyond-these-walls.mp3", title: "Beyond These Walls", licence: "CC-BY-4.0",
  sourceUrl: "https://www.scottbuckley.com.au/library/beyond-these-walls/",
  termsUrl: "https://www.scottbuckley.com.au/library/beyond-these-walls/",
  verifiedBy: "integration-test", verifiedOn: "2026-11-03", attributionRequired: true,
  attribution: "'Beyond These Walls' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au.",
  monetizationAllowed: true
}] };
const CONFIG = {
  environment: "production", serviceName: "savannah-media-worker-dispatcher", jobRequestPrefix: "job-requests/",
  jobSubmitSecret: SECRET, project: "p", region: "europe-west2", renderJobName: "savannah-render-job",
  allowedRenderImages: [IMAGE], callbackUrlAllowlist: [CALLBACK], requireSubmitIntent: true
};

const dirs = [];
process.on("exit", () => { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); });

function newStateDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "savannah-concurrent-"));
  dirs.push(dir);
  return dir;
}

function submission(overrides) {
  return Object.assign({
    jobId: "cr-" + randomUUID(),
    beats: [{ text: "Blue walls and quiet streets.", visualQuery: "blue street" }],
    musicTrackId: TRACK_ID,
    callbackUrl: CALLBACK,
    submitIntentId: "rq-concurrent-0001",
    scriptId: "SCR-1",
    renderVersion: 1
  }, overrides);
}

// One worker process per request, started at the same time as the others.
function postConcurrently(stateDir, bodies) {
  return Promise.all(bodies.map((body) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HELPER], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 || !out) return reject(new Error("worker process failed: " + err));
      resolve(JSON.parse(out.trim()));
    });
    child.stdin.end(JSON.stringify({ stateDir, config: CONFIG, manifest: MANIFEST, request: {
      method: "POST", path: "/jobs", headers: { Authorization: "Bearer " + SECRET }, body: JSON.stringify(body)
    } }));
  })));
}

function executions(stateDir) {
  const file = path.join(stateDir, "executions.log");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).length : 0;
}

test("eight simultaneous submissions with one request ID start exactly one execution, and all name one job", async () => {
  const stateDir = newStateDir();
  const bodies = Array.from({ length: 8 }, () => submission());
  const answers = await postConcurrently(stateDir, bodies);
  assert.equal(executions(stateDir), 1, "exactly one execution");
  assert.equal(answers.filter((answer) => answer.status === 202).length, 1, "exactly one acceptance");
  const jobIds = new Set(answers.map((answer) => JSON.parse(answer.body).jobId));
  assert.equal(jobIds.size, 1, "every answer names the same job");
  for (const answer of answers) assert.ok([200, 202].includes(answer.status), "no conflict for a replay: HTTP " + answer.status);
});

test("two tabs that submit different request IDs for the same script and version: one runs, the other is refused", async () => {
  const stateDir = newStateDir();
  const answers = await postConcurrently(stateDir, [
    submission({ submitIntentId: "rq-tab-a-0001" }),
    submission({ submitIntentId: "rq-tab-b-0002" })
  ]);
  assert.equal(executions(stateDir), 1, "exactly one execution");
  assert.deepEqual(answers.map((answer) => answer.status).sort(), [202, 409], "one accepted, one refused");
});

test("simultaneous submissions across two script versions start one execution per version", async () => {
  const stateDir = newStateDir();
  const answers = await postConcurrently(stateDir, [
    submission({ submitIntentId: "rq-v1-aaaa-0001", renderVersion: 1 }),
    submission({ submitIntentId: "rq-v1-bbbb-0002", renderVersion: 1 }),
    submission({ submitIntentId: "rq-v2-cccc-0003", renderVersion: 2 }),
    submission({ submitIntentId: "rq-v2-dddd-0004", renderVersion: 2 })
  ]);
  assert.equal(executions(stateDir), 2, "one execution for version 1 and one for version 2");
  assert.equal(answers.filter((answer) => answer.status === 202).length, 2);
  assert.equal(answers.filter((answer) => answer.status === 409).length, 2);
});
