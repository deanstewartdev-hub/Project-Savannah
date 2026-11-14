// Non-paid checks for a STAGING dispatcher. By default it sends only requests the dispatcher must refuse, plus
// /health. None of them starts a Cloud Run execution, so none can render or spend on AI.
//
// Target identity is what decides whether it runs. A hostname containing "staging" is not enough. The dispatcher's
// /health must report, and the operator must expect, all of:
//   environment = staging, project = STAGING_PROJECT_ID, service = STAGING_SERVICE_NAME, musicProtocol = verified-v1.
// Any mismatch stops the run before a single job request is sent. The submit secret is never printed.
//
// Usage:
//   STAGING_DISPATCHER_URL=https://<staging-dispatcher> STAGING_PROJECT_ID=<staging project> \
//   STAGING_SERVICE_NAME=<staging dispatcher service> STAGING_SUBMIT_SECRET=<staging secret> \
//   node tools/staging/verify-worker-staging.mjs
//
// Optional, needs explicit approval because it STARTS one Cloud Run execution (dryRun: the job reads its request and
// exits before any paid call):
//   STAGING_ALLOW_EXECUTION=yes  and  STAGING_CALLBACK_URL=<a staging-only callback endpoint in CALLBACK_URL_ALLOWLIST>

import { pathToFileURL } from "node:url";

const BEATS = [{ text: "Blue walls and quiet streets.", visualQuery: "blue street" }];
const TRACK = "scott-buckley-beyond-these-walls";

// Returns the list of identity problems. An empty list means the deployment is the expected staging service.
export function identityProblems(health, expected) {
  const problems = [];
  if (!health || typeof health !== "object") return ["/health did not return an identity"];
  if (health.environment !== "staging") problems.push("environment is \"" + health.environment + "\", expected staging");
  if (health.project !== expected.project) problems.push("project is \"" + health.project + "\", expected \"" + expected.project + "\"");
  if (health.service !== expected.service) problems.push("service is \"" + health.service + "\", expected \"" + expected.service + "\"");
  if (health.musicProtocol !== "verified-v1") problems.push("musicProtocol is \"" + health.musicProtocol + "\", expected verified-v1");
  return problems;
}

// Refuses an expected identity that does not itself name staging, so the check cannot be pointed at production
// by filling in production names.
export function assertExpectedIsStaging(expected) {
  if (!/staging/i.test(expected.project || "")) throw new Error("STAGING_PROJECT_ID must name a staging project.");
  if (!/staging/i.test(expected.service || "")) throw new Error("STAGING_SERVICE_NAME must name a staging service.");
}

function assertUrlShape(value) {
  if (!value) throw new Error("STAGING_DISPATCHER_URL is required.");
  const host = new URL(value).hostname;
  const loopback = host === "127.0.0.1" || host === "localhost";
  if (!loopback && !/staging/i.test(host)) {
    throw new Error("Refusing to run: the dispatcher host does not contain \"staging\". This is a first filter only; identity is checked next.");
  }
}

async function main(env) {
  const url = env.STAGING_DISPATCHER_URL || "";
  const secret = env.STAGING_SUBMIT_SECRET || "";
  const expected = { project: env.STAGING_PROJECT_ID || "", service: env.STAGING_SERVICE_NAME || "" };
  if (!secret) throw new Error("STAGING_SUBMIT_SECRET is required.");
  if (!expected.project || !expected.service) throw new Error("STAGING_PROJECT_ID and STAGING_SERVICE_NAME are required.");
  assertExpectedIsStaging(expected);
  assertUrlShape(url);

  const results = [];
  const record = (name, ok, detail = "") => {
    results.push({ name, ok });
    console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " - " + detail : ""));
  };
  const post = async (body, bearer = secret) => {
    const response = await fetch(new URL("/jobs", url), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + bearer },
      body: JSON.stringify(body)
    });
    return { status: response.status, text: await response.text() };
  };

  // Identity first: nothing else is sent unless the target is the expected staging service.
  const healthResponse = await fetch(new URL("/health", url));
  const health = await healthResponse.json().catch(() => null);
  const problems = identityProblems(health, expected);
  record("target is the expected staging dispatcher (environment, project, service, protocol)", problems.length === 0,
    problems.length ? problems.join("; ") : "project " + health.project + ", service " + health.service);
  if (problems.length) {
    console.log("Staging non-paid checks: stopped before any request. Nothing was sent to the job endpoint.");
    return 1;
  }

  const refusals = [
    ["wrong secret is refused (401)", { jobId: "cr-staging-check-0001", beats: BEATS, musicTrackId: TRACK, callbackUrl: "https://example.invalid/exec" }, 401, /unauthori/i, "wrong"],
    ["missing track is refused (400)", { jobId: "cr-staging-check-0002", beats: BEATS, callbackUrl: "https://example.invalid/exec" }, 400, /musicTrackId from the verified manifest is required/],
    ["unknown track is refused (400)", { jobId: "cr-staging-check-0003", beats: BEATS, musicTrackId: "not-a-track", callbackUrl: "https://example.invalid/exec" }, 400, /not an approved track/],
    ["file path is refused (400)", { jobId: "cr-staging-check-0004", beats: BEATS, musicTrackId: TRACK, musicTrackPath: "music/x.mp3", callbackUrl: "https://example.invalid/exec" }, 400, /not accepted/],
    ["placeholder that names a track is refused (400)", { jobId: "cr-staging-check-0005", beats: BEATS, legacyPlaceholderMusic: true, musicTrackId: TRACK, callbackUrl: "https://example.invalid/exec" }, 400, /cannot also name/]
  ];
  for (const [name, body, status, message, bearer] of refusals) {
    const response = await post(body, bearer);
    record(name, response.status === status && message.test(response.text), "HTTP " + response.status);
  }

  if (env.STAGING_ALLOW_EXECUTION === "yes") {
    const jobId = "cr-staging-exec-" + Date.now().toString(36);
    const callbackUrl = env.STAGING_CALLBACK_URL || "";
    if (!callbackUrl) throw new Error("STAGING_CALLBACK_URL is required for the execution check.");
    const response = await post({ jobId, beats: BEATS, musicTrackId: TRACK, dryRun: true, callbackUrl, callbackSecret: "staging-check" });
    const body = JSON.parse(response.text || "{}");
    record("accepted request starts one execution and returns the track summary",
      response.status === 202 && !!body.executionName && !!body.music && body.music.id === TRACK,
      "HTTP " + response.status + (body.executionName ? " execution " + body.executionName : ""));
    const again = await post({ jobId, beats: BEATS, musicTrackId: TRACK, dryRun: true, callbackUrl, callbackSecret: "staging-check" });
    record("a repeat of the same jobId is refused", again.status === 409, "HTTP " + again.status);
  } else {
    console.log("SKIP execution check (set STAGING_ALLOW_EXECUTION=yes with approval; it starts one Cloud Run execution)");
  }

  const failed = results.filter((entry) => !entry.ok).length;
  console.log(failed === 0 ? "Staging non-paid checks: all " + results.length + " passed." : "Staging non-paid checks: " + failed + " failed.");
  return failed === 0 ? 0 : 1;
}

// Runs only when executed directly, so the identity functions can be imported by tests without side effects.
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  // Set the exit code and let the process end on its own. Calling process.exit() while keep-alive HTTP sockets are
  // still open can trip a libuv assertion on Windows (UV_HANDLE_CLOSING): every check had passed, then the process
  // crashed with a non-zero code. The idle sockets close themselves within seconds, so the process ends cleanly.
  main(process.env).then((code) => { process.exitCode = code; }, (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
