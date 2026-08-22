/****************************************************
 * Project Savannah - Media Worker Callback Bridge (SAV-15)
 *
 * WHY THIS PROJECT EXISTS
 *
 * The main Savannah Apps Script project serves the full operator UI via doGet() and
 * exposes every controller's global functions (script generation, approval, SEO,
 * rendering, YouTube publishing, Sheet reads/writes - see App/*Controller.js) through
 * google.script.run. Apps Script's access control is per-DEPLOYMENT, not per-function:
 * whatever "access" a deployment is configured with applies to *every* global function
 * in that deployment's code, regardless of whether the loaded page's own JS happens to
 * call it. There is no way to make doPost() anonymous while keeping doGet()/
 * google.script.run private within one deployment.
 *
 * The media-worker's completion callback is an unauthenticated (from Google's point of
 * view) external HTTP POST from a Cloud Run Job - it cannot complete a Google sign-in
 * flow, so it needs an ANYONE_ANONYMOUS deployment to reach doPost() at all. Making the
 * *main* deployment anonymous to satisfy that (as it was until SAV-15) makes every
 * operator function anonymously callable too - including rendering and YouTube
 * publishing, with no session/user check possible, because executeAs: USER_DEPLOYING
 * means the code always runs as the deploying user regardless of caller, so there is no
 * caller identity to check even if we wanted to.
 *
 * Two deployments of the *same* project do not solve this either: every deployment of
 * one project shares the same global functions, so an anonymous deployment of the main
 * project would still expose every operator controller function under a different URL.
 *
 * This is therefore a genuinely separate Apps Script project - its own script ID, its
 * own deployment, its own manifest (access: ANYONE_ANONYMOUS) - whose *entire* codebase
 * is this one file. It defines exactly one global function (doPost) and nothing else
 * global, so there is nothing else for google.script.run to expose, regardless of
 * deployment access. It cannot import or call the main project's controllers (separate
 * projects, no shared runtime) - only a minimal, narrowly-scoped Render Jobs row update
 * is reimplemented here, deliberately not full parity with RenderJobModel/
 * RenderJobRepository, so a mismatch here can only affect render-completion bookkeeping
 * columns, never trigger a render, a Sheet-wide write, or a YouTube action.
 *
 * DEPLOYMENT (not done by this commit - see repo root HANDOFF.md for status):
 * 1. `clasp create` a new standalone Apps Script project from this directory.
 * 2. Set this project's own Script Properties:
 *    - MEDIA_WORKER_SHARED_SECRET: the exact same value as the main project's property
 *      of the same name (Services/Services_Secrets.js). Script Properties are per
 *      project, not shared - this must be copied over manually, never logged.
 *    - RENDER_JOBS_SPREADSHEET_ID: the ID of the same spreadsheet the main project uses.
 * 3. Deploy as a web app (access: ANYONE_ANONYMOUS, matching this manifest) and note its
 *    /exec URL.
 * 4. Update the main project's MEDIA_WORKER_CALLBACK_URL Script Property to that new
 *    URL (Secrets.setMediaWorkerCallbackUrl() - see Production/VideoProcessingProvider.js
 *    callbackUrl_()). No code change needed there; the callback base URL was already
 *    externalized to a Script Property before this change.
 * 5. Only then redeploy the main project with appsscript.json's access: MYSELF from this
 *    same commit - deploying that alone, first, would break the callback.
 * 6. Verify with one real render before considering this migration complete.
 *
 * SAV-16 (pre-deploy hardening, before any of the above deployment happens): render IDs
 * are validated against the same strict cr-<UUID> pattern the dispatcher already
 * enforces, callback status is an explicit allow-list (completed/failed) rather than
 * "anything but completed means failed", the Render Jobs header row is verified to
 * match RENDER_JOBS_HEADERS exactly before any write (never repaired or guessed at),
 * and the whole row update happens through exactly one setValues() call so there is no
 * window where Status is written but a later column update fails.
 ****************************************************/

// Must exactly match RenderJobRepository's HEADERS order (Production/RenderJob_Repository.js)
// so column indices below stay correct. Duplicated deliberately, not imported - see the
// isolation rationale above.
var RENDER_JOBS_HEADERS = ["Job ID", "Render ID", "Script ID", "SEO Pack ID", "Template ID", "Status",
  "Progress", "Video URL", "Snapshot URL", "Error Message", "Request JSON", "Response JSON",
  "Created At", "Updated At", "Version", "Model Version"];

// Matches VideoProcessingProvider.RENDER_ID_PREFIX + Utilities.getUuid() exactly - the same
// pattern media-worker/src/lib/jobStatus.js's isValidJobId() already enforces server-side,
// reused here rather than reinvented (SAV-16). Deliberately strict: this value is looked up
// directly against a Sheet column, so anything this rejects (path separators, "../",
// arbitrary strings) never reaches SpreadsheetApp at all.
var RENDER_ID_PATTERN = /^cr-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// SAV-16: only these two are ever accepted; anything else fails closed rather than being
// silently treated as a failure.
var VALID_CALLBACK_STATUSES = ["completed", "failed"];

// Only the columns this bridge is ever allowed to touch, in the exact order they will be
// written. Every other Render Jobs column is read back unchanged and rewritten as-is (see
// writeCompletionColumns_), never left blank and never guessed at.
var WRITABLE_COLUMNS = ["Status", "Progress", "Video URL", "Error Message", "Response JSON", "Updated At"];

function doPost(event) {
  var parameters = resolveParameters_(event);
  var route = resolveRoute_(parameters);
  var result = route === "media-worker-callback" ? handleCallback_(event, parameters) : { success: false, error: "Unknown callback route." };
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function resolveParameters_(event) {
  return event && event.parameter && typeof event.parameter === "object" ? event.parameter : {};
}

// Pure - takes parameters directly rather than reading PropertiesService itself - so it
// can be unit tested deterministically with a synthetic secret, with no live Script
// Properties or Sheet access involved.
function resolveRoute_(parameters) {
  return String((parameters && parameters.route) || "").trim();
}

// Pure - see resolveRoute_. This is the SAV-15 fail-closed auth gate: no secret
// configured, or a mismatched/missing secret on the request, both reject.
function isAuthorizedCallback_(parameters, expectedSecret) {
  if (!expectedSecret) return false;
  var supplied = String((parameters && parameters.secret) || "");
  return supplied === expectedSecret;
}

// Pure (SAV-16). Rejects anything that isn't exactly cr-<UUID> - path separators,
// "../", blank values, and arbitrary strings all fail here, before any SpreadsheetApp
// call is ever made.
function isValidRenderId_(renderId) {
  return typeof renderId === "string" && RENDER_ID_PATTERN.test(renderId);
}

// Pure (SAV-16). Only "completed" or "failed" are accepted; anything else (unknown,
// missing, misspelled) fails closed rather than being silently treated as a failure -
// previously body.status === "completed" ? ... : failedChanges_(body) meant any other
// value fell through to failedChanges_ unnoticed.
function isValidCallbackStatus_(status) {
  return typeof status === "string" && VALID_CALLBACK_STATUSES.indexOf(status) !== -1;
}

// Pure (SAV-16). The anonymous bridge must never guess column positions against a
// changed schema - this must match RENDER_JOBS_HEADERS exactly (same length, same
// order, same text), not just contain the columns this bridge needs.
function headersMatchExpected_(actualHeaders) {
  if (!Array.isArray(actualHeaders) || actualHeaders.length !== RENDER_JOBS_HEADERS.length) return false;
  for (var i = 0; i < RENDER_JOBS_HEADERS.length; i++) {
    if (String(actualHeaders[i]) !== RENDER_JOBS_HEADERS[i]) return false;
  }
  return true;
}

function handleCallback_(event, parameters) {
  try {
    var expectedSecret = PropertiesService.getScriptProperties().getProperty("MEDIA_WORKER_SHARED_SECRET");
    if (!isAuthorizedCallback_(parameters, expectedSecret)) {
      return { success: false, error: "Unauthorized." };
    }

    var raw = (event && event.postData && event.postData.contents) || "";
    var body;
    try { body = JSON.parse(raw); } catch (parseError) { body = null; }
    if (!body || !body.jobId) return { success: false, error: "A jobId is required." };
    if (!isValidRenderId_(String(body.jobId))) return { success: false, error: "Malformed render ID." };
    if (!isValidCallbackStatus_(body.status)) return { success: false, error: "Unknown or missing status." };

    var updated = updateRenderJobByRenderId_(String(body.jobId), body);
    if (!updated) return { success: false, error: "Render job was not found." };
    return { success: true };
  } catch (caught) {
    Logger.log("CallbackBridge failed: " + (caught && caught.message || caught));
    return { success: false, error: "Callback processing failed." };
  }
}

// Deliberately narrow: updates only WRITABLE_COLUMNS (Status, Progress, Video URL,
// Error Message, Response JSON, Updated At), matched by Render ID. Every other column
// (Job ID, Script ID, SEO Pack ID, Template ID, Snapshot URL, Request JSON, Created At,
// Version, Model Version) is read back and rewritten unchanged, never guessed at -
// unlike RenderJobRepository.update()'s full-row overwrite, a safer subset for an
// isolated project that cannot reuse RenderJobModel's validation.
//
// SAV-16: everything - schema shape, row lookup, computed values - is validated before
// the first (and only) write. There is no code path that writes some columns and then
// fails on a later one: either every check upstream of the single setValues() call
// below passes, or nothing is written at all.
function updateRenderJobByRenderId_(renderId, body) {
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty("RENDER_JOBS_SPREADSHEET_ID");
  if (!spreadsheetId) throw new Error("RENDER_JOBS_SPREADSHEET_ID is not configured.");
  var sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName("Render Jobs");
  if (!sheet || sheet.getLastRow() < 2) return false;

  var actualHeaders = sheet.getRange(1, 1, 1, RENDER_JOBS_HEADERS.length).getDisplayValues()[0];
  if (!headersMatchExpected_(actualHeaders)) {
    throw new Error("Render Jobs sheet schema does not match the expected headers - refusing to write.");
  }

  var renderIdColumn = RENDER_JOBS_HEADERS.indexOf("Render ID") + 1;
  var values = sheet.getRange(2, renderIdColumn, sheet.getLastRow() - 1, 1).getDisplayValues();
  var rowIndex = -1;
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === renderId) { rowIndex = i + 2; break; }
  }
  if (rowIndex === -1) return false;

  var changes = body.status === "completed" ? completedChanges_(body) : failedChanges_(body);
  writeCompletionColumns_(sheet, rowIndex, changes);
  return true;
}

// One setValues() call across the narrowest contiguous span that covers every column in
// WRITABLE_COLUMNS - reads the current row first so any column inside that span that
// this bridge does not own (e.g. Snapshot URL, Request JSON, Created At, which all sit
// between Status and Updated At) is written back unchanged, never blanked.
function writeCompletionColumns_(sheet, row, changes) {
  var values = { Status: changes.status, Progress: changes.progress, "Video URL": changes.videoUrl,
    "Error Message": changes.errorMessage, "Response JSON": JSON.stringify(changes.providerResponse), "Updated At": new Date() };

  var columnIndexes = WRITABLE_COLUMNS.map(function (name) { return RENDER_JOBS_HEADERS.indexOf(name) + 1; });
  var startColumn = Math.min.apply(null, columnIndexes);
  var endColumn = Math.max.apply(null, columnIndexes);
  var span = endColumn - startColumn + 1;

  var current = sheet.getRange(row, startColumn, 1, span).getValues()[0];
  WRITABLE_COLUMNS.forEach(function (name) {
    var value = values[name];
    if (value === null || value === undefined) return;
    // RENDER_JOBS_HEADERS.indexOf(name) is 0-based; +1 makes it the real 1-based column
    // number, which is what startColumn also is - mixing a 0-based index directly
    // against a 1-based column would silently write into the wrong slot.
    current[(RENDER_JOBS_HEADERS.indexOf(name) + 1) - startColumn] = value;
  });

  sheet.getRange(row, startColumn, 1, span).setValues([current]);
}

function completedChanges_(body) {
  var video = body.video || {};
  var probe = body.probe || {};
  var videoUrl = String(video.url || "");
  return {
    status: "SUCCEEDED", progress: 100, videoUrl: videoUrl, errorMessage: "",
    providerResponse: { status: "succeeded", progress: 100, url: videoUrl, snapshot_url: "", error_message: "", video: video, probe: probe }
  };
}

function failedChanges_(body) {
  var message = String((body.error && body.error.message) || "The media worker reported a failure.").slice(0, 500);
  return { status: "FAILED", progress: null, videoUrl: null, errorMessage: message, providerResponse: { status: "failed", error_message: message } };
}
