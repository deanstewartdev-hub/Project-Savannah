// Non-paid checks for a STAGING dispatcher. By default it sends only requests the dispatcher must refuse, plus
// /health. None of them starts a Cloud Run execution, so none of them can render or spend on AI.
//
// Refuses to run unless the dispatcher host contains "staging" (or is a loopback address for a local test). It
// never prints the submit secret.
//
// Usage (PowerShell or bash):
//   STAGING_DISPATCHER_URL=https://<staging-dispatcher>  STAGING_SUBMIT_SECRET=<staging secret> \
//   node tools/staging/verify-worker-staging.mjs
//
// Optional, needs explicit approval because it STARTS one Cloud Run execution (dryRun: the job reads its request
// and exits before any paid call):
//   STAGING_ALLOW_EXECUTION=yes  (also set STAGING_CALLBACK_URL to the staging web app's callback route)

const url = process.env.STAGING_DISPATCHER_URL || "";
const secret = process.env.STAGING_SUBMIT_SECRET || "";
const executionAllowed = process.env.STAGING_ALLOW_EXECUTION === "yes";

function assertStagingTarget(value) {
  if (!value) throw new Error("STAGING_DISPATCHER_URL is required.");
  const host = new URL(value).hostname;
  const loopback = host === "127.0.0.1" || host === "localhost";
  if (!loopback && !/staging/i.test(host)) {
    throw new Error("Refusing to run: the dispatcher host must contain \"staging\". Production is never a target of this script.");
  }
}

if (!secret) throw new Error("STAGING_SUBMIT_SECRET is required.");
assertStagingTarget(url);

const BEATS = [{ text: "Blue walls and quiet streets.", visualQuery: "blue street" }];
const TRACK = "scott-buckley-beyond-these-walls";
const results = [];

async function post(body, bearer = secret) {
  const response = await fetch(new URL("/jobs", url), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + bearer },
    body: JSON.stringify(body)
  });
  return { status: response.status, text: await response.text() };
}

function record(name, ok, detail = "") {
  results.push({ name, ok });
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " - " + detail : ""));
}

// N1: the dispatcher reports the music protocol the main app checks before it sends a render.
{
  const response = await fetch(new URL("/health", url));
  const body = await response.json().catch(() => ({}));
  record("health reports musicProtocol verified-v1", response.status === 200 && body.musicProtocol === "verified-v1",
    "HTTP " + response.status);
}

// N2-N6: every request below must be refused before anything is uploaded or started.
const refusals = [
  ["wrong secret is refused (401)", { jobId: "cr-staging-check-0001", beats: BEATS, musicTrackId: TRACK, callbackUrl: "https://example.invalid/exec" }, 401, /unauthori/i, "wrong"],
  ["missing track is refused (400)", { jobId: "cr-staging-check-0002", beats: BEATS, callbackUrl: "https://example.invalid/exec" }, 400, /musicTrackId from the verified manifest is required/],
  ["unknown track is refused (400)", { jobId: "cr-staging-check-0003", beats: BEATS, musicTrackId: "not-a-track", callbackUrl: "https://example.invalid/exec" }, 400, /not an approved track/],
  ["file path is refused (400)", { jobId: "cr-staging-check-0004", beats: BEATS, musicTrackId: TRACK, musicTrackPath: "music/x.mp3", callbackUrl: "https://example.invalid/exec" }, 400, /not accepted/],
  ["placeholder that names a track is refused (400)", { jobId: "cr-staging-check-0005", beats: BEATS, legacyPlaceholderMusic: true, musicTrackId: TRACK, callbackUrl: "https://example.invalid/exec" }, 400, /cannot also name/]
];
for (const [name, body, status, message, bearer] of refusals) {
  const response = await post(body, bearer);
  const ok = response.status === status && message.test(response.text);
  record(name, ok, "HTTP " + response.status);
}

// N7: an optional execution check. It starts one Cloud Run execution, so it runs only with explicit approval.
if (executionAllowed) {
  const jobId = "cr-staging-exec-" + Date.now().toString(36);
  const callbackUrl = process.env.STAGING_CALLBACK_URL || "";
  if (!callbackUrl) throw new Error("STAGING_CALLBACK_URL is required for the execution check.");
  const response = await post({ jobId, beats: BEATS, musicTrackId: TRACK, dryRun: true, callbackUrl, callbackSecret: "staging-check" });
  const body = JSON.parse(response.text || "{}");
  record("accepted request starts one execution and returns the track summary",
    response.status === 202 && !!body.executionName && body.music && body.music.id === TRACK,
    "HTTP " + response.status + (body.executionName ? " execution " + body.executionName : ""));
  const again = await post({ jobId, beats: BEATS, musicTrackId: TRACK, dryRun: true, callbackUrl, callbackSecret: "staging-check" });
  record("a repeat of the same jobId is refused while the request is waiting", again.status === 409, "HTTP " + again.status);
} else {
  console.log("SKIP execution check (set STAGING_ALLOW_EXECUTION=yes with approval; it starts one Cloud Run execution)");
}

const failed = results.filter((entry) => !entry.ok).length;
console.log(failed === 0 ? "Staging non-paid checks: all " + results.length + " passed." : "Staging non-paid checks: " + failed + " failed.");
process.exit(failed === 0 ? 0 : 1);
