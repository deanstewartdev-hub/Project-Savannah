/****************************************************
 * Project Savannah v1.4 - main-project callback inbox consumer tests.
 *
 * Exercises MediaWorkerCallbackInbox against an in-memory "Render Callback
 * Inbox" sheet and an in-memory Render Jobs repository, using the real
 * RenderJobModel. No Google services, network, or provider clients are used.
 *
 * Covers: receipt ordering, crash replay, schema mismatch, fast callbacks that
 * arrive before the render ID is persisted, conflicting deliveries, completed
 * callbacks without a video, orphan expiry, lock behaviour and batch limits.
 *
 * Run with: node node-tests/CallbackInboxConsumer_Tests.js
 ****************************************************/
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { randomUUID } = require("crypto");

const REPO = path.join(__dirname, "..");
const HEADERS = ["Receipt ID", "Render ID", "Status", "Payload JSON", "Received At", "Handled At", "Result"];
const RENDER_A = "cr-c68c66f5-b646-4c1c-a88a-8748c5c0f1d9";
const RENDER_B = "cr-0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const VIDEO_URL = "https://storage.googleapis.com/savannah-media/renders/final.mp4?X-Goog-Signature=abc";

function makeSheet(rows, options) {
  const opts = options || {};
  const data = [opts.headers || HEADERS.slice()].concat(rows.map(r => r.slice()));
  const writes = [];
  return {
    data, writes,
    getLastRow: () => data.length,
    getRange(row, col, numRows, numCols) {
      return {
        getValues: () => data.slice(row - 1, row - 1 + numRows).map(r => r.slice(col - 1, col - 1 + numCols)),
        getDisplayValues: () => data.slice(row - 1, row - 1 + numRows).map(r => r.slice(col - 1, col - 1 + numCols).map(String)),
        setValues(values) {
          if (opts.failMark && col === 6) {
            opts.failMark--;
            throw new Error("Simulated Sheets failure while acknowledging.");
          }
          writes.push({ row, col, values });
          values.forEach((v, i) => v.forEach((cell, j) => { data[row - 1 + i][col - 1 + j] = cell; }));
        },
        setValue(value) { this.setValues([[value]]); }
      };
    }
  };
}

function receipt(renderId, status, payload, receivedAt) {
  const body = payload === undefined ? defaultBody(renderId, status) : payload;
  return [randomUUID(), renderId, status, typeof body === "string" ? body : JSON.stringify(body),
    receivedAt || new Date(), "", ""];
}

function defaultBody(renderId, status) {
  return status === "completed" ?
    { jobId: renderId, status, video: { url: VIDEO_URL, width: 1080, height: 1920 }, probe: { durationSeconds: 36.9 }, error: {} } :
    { jobId: renderId, status, video: {}, probe: {}, error: { message: "FFmpeg assembly failed." } };
}

function renderJob(overrides) {
  return Object.assign({
    id: "RND-AAAA0001", renderId: RENDER_A, scriptId: "SCR-1", templateId: "media-worker",
    status: "RENDERING", progress: 40, videoUrl: "", createdAt: "2026-10-01T00:00:00.000Z", version: 3
  }, overrides || {});
}

function setup(rows, jobs, options) {
  const opts = options || {};
  const sheet = opts.noSheet ? null : makeSheet(rows, opts);
  const store = (jobs || []).map(j => j);
  const repoWrites = [];
  const lock = { held: false, released: 0, tryLock: () => !opts.busy, releaseLock() { lock.released++; } };
  let sheetReads = 0;
  const context = vm.createContext({
    console, Logger: { log() {} },
    Utilities: { getUuid: randomUUID },
    LockService: { getScriptLock: () => lock },
    UrlFetchApp: { fetch() { throw new Error("Network access is forbidden in consumer tests."); } },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getId: () => "main-sheet-id", getName: () => "Savannah", getSheetByName(name) { sheetReads++; return name === "Render Callback Inbox" ? sheet : null; } })
    },
    RenderJobRepository: {
      getByRenderId(renderId) {
        if (opts.repoThrowsFor === renderId) throw new Error("Simulated Render Jobs read failure.");
        const found = store.filter(j => j.renderId === renderId)[0];
        return found ? JSON.parse(JSON.stringify(found)) : null;
      },
      update(job) {
        repoWrites.push(job);
        const index = store.findIndex(j => j.id === job.id);
        if (index === -1) throw new Error("Render job was not found.");
        store[index] = JSON.parse(JSON.stringify(job));
        return job;
      }
    }
  });
  for (const file of ["Models/RenderJob.js", "Production/VideoLink_Service.js", "Production/MediaWorkerCallbackInbox_Service.js"]) {
    vm.runInContext(fs.readFileSync(path.join(REPO, file), "utf8"), context, { filename: file });
  }
  const inbox = vm.runInContext("MediaWorkerCallbackInbox", context);
  return { inbox, context, sheet, store, repoWrites, lock, sheetReads: () => sheetReads };
}

function result(sheet, index) { return sheet.data[index + 1][6]; }
function handled(sheet, index) { return sheet.data[index + 1][5]; }
function assert(condition, message) { if (!condition) throw new Error(message); }

function runCallbackInboxConsumerTests() {
  const results = [];
  function test(name, callback) {
    try {
      callback();
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, error: String(error && error.message || error) });
    }
  }

  test("completed receipt sets SUCCEEDED with the video URL and is acknowledged", () => {
    const t = setup([receipt(RENDER_A, "completed")], [renderJob()]);
    const stats = t.inbox.processPending();
    assert(stats.processed === 1, "Expected one applied receipt.");
    const job = t.store[0];
    assert(job.status === "SUCCEEDED" && job.progress === 100 && job.videoUrl === VIDEO_URL, "Render was not completed with its video.");
    assert(job.providerResponse.probe.durationSeconds === 36.9, "Probe evidence was not preserved.");
    assert(job.version === 4, "Model version was not advanced exactly once.");
    assert(result(t.sheet, 0) === "APPLIED" && handled(t.sheet, 0), "Receipt was not acknowledged.");
    assert(t.lock.released === 1, "Script lock was not released.");
  });

  test("failed receipt sets FAILED with the worker's error message", () => {
    const t = setup([receipt(RENDER_A, "failed")], [renderJob()]);
    t.inbox.processPending();
    assert(t.store[0].status === "FAILED", "Render was not failed.");
    assert(t.store[0].errorMessage === "FFmpeg assembly failed.", "Worker error message was lost.");
    assert(t.store[0].videoUrl === "", "A failed render must not gain a video URL.");
    assert(result(t.sheet, 0) === "APPLIED", "Receipt was not acknowledged.");
  });

  test("fast callback before render ID is persisted is deferred, then applied", () => {
    const t = setup([receipt(RENDER_A, "completed")], []);
    const first = t.inbox.processPending();
    assert(first.deferred === 1 && first.processed === 0, "Early receipt should be deferred.");
    assert(!handled(t.sheet, 0) && !result(t.sheet, 0), "Deferred receipt must stay pending.");
    assert(t.repoWrites.length === 0, "No render write is allowed before the job exists.");
    t.store.push(renderJob());
    const second = t.inbox.processPending();
    assert(second.processed === 1 && t.store[0].status === "SUCCEEDED", "Receipt was not applied once the job existed.");
  });

  test("crash between render write and acknowledgement replays as a no-op", () => {
    const t = setup([receipt(RENDER_A, "completed")], [renderJob()], { failMark: 1 });
    const first = t.inbox.processPending();
    assert(first.errors === 1 && t.repoWrites.length === 1, "Render write should land before the failed acknowledgement.");
    assert(!handled(t.sheet, 0), "Receipt must remain pending after the crash.");
    const second = t.inbox.processPending();
    assert(second.ignored === 1 && result(t.sheet, 0) === "IGNORED_TERMINAL", "Replay should acknowledge as terminal no-op.");
    assert(t.repoWrites.length === 1, "Replay must not write the render a second time.");
  });

  test("conflicting deliveries: first receipt wins, later one is ignored", () => {
    const t = setup([receipt(RENDER_A, "completed"), receipt(RENDER_A, "failed")], [renderJob()]);
    const stats = t.inbox.processPending();
    assert(stats.processed === 1 && stats.ignored === 1, "Expected one applied and one ignored receipt.");
    assert(t.store[0].status === "SUCCEEDED" && t.store[0].videoUrl === VIDEO_URL, "Later failure overwrote a completed render.");
    assert(result(t.sheet, 1) === "IGNORED_TERMINAL", "Conflicting receipt was not acknowledged as ignored.");
  });

  test("receipts are applied in arrival order (failed before completed stays FAILED)", () => {
    const t = setup([receipt(RENDER_A, "failed"), receipt(RENDER_A, "completed")], [renderJob()]);
    t.inbox.processPending();
    assert(t.store[0].status === "FAILED" && t.store[0].videoUrl === "", "Arrival order was not respected.");
    assert(t.repoWrites.length === 1, "Only the first receipt may write the render.");
  });

  test("completed receipt without a video URL never records SUCCEEDED", () => {
    const noUrl = { jobId: RENDER_A, status: "completed", video: {}, probe: {} };
    const t = setup([receipt(RENDER_A, "completed", noUrl)], [renderJob()]);
    const stats = t.inbox.processPending();
    assert(stats.rejected === 1 && result(t.sheet, 0) === "REJECTED_NO_VIDEO", "Missing video should be rejected.");
    assert(t.repoWrites.length === 0 && t.store[0].status === "RENDERING", "Render must stay active for reconciliation.");
  });

  test("completed receipt with a non-HTTPS or blank video URL is rejected", () => {
    for (const url of ["http://example.test/v.mp4", "   ", "javascript:alert(1)", "gs://bucket/v.mp4"]) {
      const body = { jobId: RENDER_A, status: "completed", video: { url }, probe: {} };
      const t = setup([receipt(RENDER_A, "completed", body)], [renderJob()]);
      t.inbox.processPending();
      assert(result(t.sheet, 0) === "REJECTED_NO_VIDEO" && t.repoWrites.length === 0, "Accepted unsafe video URL: " + url);
    }
  });

  test("malformed or mismatched receipts are rejected without touching Render Jobs", () => {
    const rows = [
      receipt(RENDER_A, "completed", "{not json"),
      receipt(RENDER_A, "completed", { jobId: RENDER_B, status: "completed", video: { url: VIDEO_URL } }),
      receipt(RENDER_A, "failed", { jobId: RENDER_A, status: "completed", video: { url: VIDEO_URL } }),
      receipt("RND-NOTACRID", "completed"),
      receipt(RENDER_A, "succeeded"),
      receipt(RENDER_A, "completed", "null")
    ];
    const t = setup(rows, [renderJob()]);
    const stats = t.inbox.processPending();
    assert(stats.rejected === rows.length, "Expected every malformed receipt to be rejected, got " + JSON.stringify(stats));
    assert(t.repoWrites.length === 0 && t.store[0].status === "RENDERING", "A rejected receipt changed the render.");
    rows.forEach((_, i) => assert(result(t.sheet, i) === "REJECTED", "Row " + i + " was not marked REJECTED."));
  });

  test("schema mismatch refuses to process and writes nothing", () => {
    const wrong = HEADERS.slice(); wrong[3] = "Payload";
    const t = setup([receipt(RENDER_A, "completed")], [renderJob()], { headers: wrong });
    let threw = false;
    try { t.inbox.processPending(); } catch (error) { threw = /schema mismatch/.test(error.message); }
    assert(threw, "Schema mismatch should throw.");
    assert(t.sheet.writes.length === 0 && t.repoWrites.length === 0, "Nothing may be written on schema mismatch.");
    assert(t.lock.released === 1, "Lock must be released after a thrown error.");
  });

  test("acknowledged receipts are never replayed", () => {
    const done = receipt(RENDER_A, "failed"); done[5] = new Date(); done[6] = "APPLIED";
    const t = setup([done], [renderJob()]);
    const stats = t.inbox.processPending();
    assert(stats.processed + stats.ignored + stats.rejected === 0, "Acknowledged receipt was reprocessed.");
    assert(t.repoWrites.length === 0 && t.sheet.writes.length === 0, "Acknowledged receipt caused a write.");
  });

  test("receipt for a render that never appears is orphaned after 48 hours", () => {
    const old = new Date(Date.now() - 49 * 60 * 60 * 1000);
    const recent = new Date(Date.now() - 47 * 60 * 60 * 1000);
    const t = setup([receipt(RENDER_A, "completed", undefined, old), receipt(RENDER_B, "completed", undefined, recent)], []);
    const stats = t.inbox.processPending();
    assert(stats.orphaned === 1 && result(t.sheet, 0) === "ORPHANED", "Old receipt should be orphaned.");
    assert(stats.deferred === 1 && !result(t.sheet, 1), "Recent receipt should still be deferred.");
    assert(JSON.parse(t.sheet.data[1][3]).video.url === VIDEO_URL, "Orphaned payload must be kept, not erased.");
  });

  test("busy script lock skips the pass instead of failing the caller", () => {
    const t = setup([receipt(RENDER_A, "completed")], [renderJob()], { busy: true });
    const stats = t.inbox.processPending();
    assert(stats.skipped === true, "Busy pass should report skipped.");
    assert(t.sheetReads() === 0 && t.repoWrites.length === 0, "A skipped pass must not read or write.");
    assert(t.lock.released === 0, "A lock that was never acquired must not be released.");
  });

  test("processPendingLocked does not take the lock itself", () => {
    const t = setup([receipt(RENDER_A, "completed")], [renderJob()], { busy: true });
    const stats = t.inbox.processPendingLocked();
    assert(stats.processed === 1, "Locked variant should process under the caller's lock.");
    assert(t.lock.released === 0, "Locked variant must not release the caller's lock.");
  });

  test("one failing receipt does not block later receipts", () => {
    const job2 = renderJob({ id: "RND-BBBB0002", renderId: RENDER_B });
    const t = setup([receipt(RENDER_A, "completed"), receipt(RENDER_B, "completed")], [renderJob(), job2], { repoThrowsFor: RENDER_A });
    const stats = t.inbox.processPending();
    assert(stats.errors === 1 && stats.processed === 1, "Expected one error and one applied receipt.");
    assert(!handled(t.sheet, 0), "Failed receipt must stay pending for retry.");
    assert(t.store[1].status === "SUCCEEDED", "Later receipt was blocked by an earlier failure.");
  });

  test("failing receipt records its attempt count but stays pending", () => {
    const t = setup([receipt(RENDER_A, "completed")], [renderJob()], { repoThrowsFor: RENDER_A });
    t.inbox.processPending();
    t.inbox.processPending();
    assert(!handled(t.sheet, 0), "Receipt must stay pending while under the attempt limit.");
    assert(/^ERROR 2: Simulated Render Jobs read failure/.test(result(t.sheet, 0)), "Attempt count not recorded: " + result(t.sheet, 0));
  });

  test("receipt that keeps failing is set aside after 10 attempts, payload kept, render untouched", () => {
    const row = receipt(RENDER_A, "completed"); row[6] = "ERROR 9: earlier failure";
    const t = setup([row], [renderJob()], { repoThrowsFor: RENDER_A });
    const stats = t.inbox.processPending();
    assert(stats.failedPermanent === 1, "Expected the receipt to be set aside.");
    assert(handled(t.sheet, 0) && /^FAILED_PERMANENT: /.test(result(t.sheet, 0)), "Receipt was not acknowledged as permanent failure.");
    assert(JSON.parse(t.sheet.data[1][3]).video.url === VIDEO_URL, "Payload must be kept.");
    assert(t.repoWrites.length === 0 && t.store[0].status === "RENDERING", "Render must stay active for reconciliation.");
    const again = t.inbox.processPending();
    assert(again.errors === 0, "A set-aside receipt must not be retried.");
  });

  test("render that already has a video URL is never overwritten", () => {
    const t = setup([receipt(RENDER_A, "failed")], [renderJob({ status: "RENDERING", videoUrl: VIDEO_URL })]);
    t.inbox.processPending();
    assert(result(t.sheet, 0) === "IGNORED_TERMINAL" && t.repoWrites.length === 0, "Render with media evidence was modified.");
  });

  test("terminal CANCELLED render is not resurrected by a late completion", () => {
    const t = setup([receipt(RENDER_A, "completed")], [renderJob({ status: "CANCELLED" })]);
    t.inbox.processPending();
    assert(t.store[0].status === "CANCELLED" && t.repoWrites.length === 0, "Cancelled render was overwritten.");
  });

  test("batch is capped at 25 counted receipts per pass", () => {
    const rows = [];
    for (let i = 0; i < 30; i++) rows.push(receipt("bad-" + i, "completed"));
    const t = setup(rows, []);
    const first = t.inbox.processPending();
    assert(first.rejected === 25, "Expected 25 rejected in the first pass, got " + first.rejected);
    const second = t.inbox.processPending();
    assert(second.rejected === 5, "Remaining receipts should drain next pass.");
  });

  test("deferred receipts do not consume the batch budget", () => {
    const rows = [];
    for (let i = 0; i < 30; i++) rows.push(receipt(RENDER_B, "completed"));
    rows.push(receipt(RENDER_A, "completed"));
    const t = setup(rows, [renderJob()]);
    const stats = t.inbox.processPending();
    assert(stats.deferred === 30 && stats.processed === 1, "A deferred backlog starved a ready receipt.");
  });

  test("missing inbox sheet is a no-op", () => {
    const t = setup([], [renderJob()], { noSheet: true });
    const stats = t.inbox.processPending();
    assert(stats.processed === 0 && stats.rejected === 0 && t.repoWrites.length === 0, "Missing sheet should do nothing.");
  });

  test("diagnoseCallbackInbox reports spreadsheet identity and backlog without writing", () => {
    const done = receipt(RENDER_A, "failed"); done[5] = new Date(); done[6] = "APPLIED";
    const erroring = receipt(RENDER_B, "completed", undefined, new Date("2026-10-20T10:00:00Z")); erroring[6] = "ERROR 2: boom";
    const fresh = receipt(RENDER_B, "completed", undefined, new Date("2026-10-21T10:00:00Z"));
    const t = setup([done, erroring, fresh], [renderJob()]);
    const report = vm.runInContext("diagnoseCallbackInbox()", t.context);
    assert(report.spreadsheetId === "main-sheet-id" && report.inboxSheetPresent && report.headersMatch === true, "Identity/schema not reported.");
    assert(report.receipts === 3 && report.pending === 2 && report.pendingWithErrors === 1, "Backlog counts wrong: " + JSON.stringify(report));
    assert(report.results.APPLIED === 1 && report.results.PENDING === 2, "Result breakdown wrong.");
    assert(report.oldestPendingReceivedAt === "2026-10-20T10:00:00.000Z", "Oldest pending wrong: " + report.oldestPendingReceivedAt);
    assert(t.sheet.writes.length === 0 && t.repoWrites.length === 0, "Diagnostic must be read-only.");
  });

  test("diagnoseCallbackInbox flags a schema mismatch instead of throwing", () => {
    const wrong = HEADERS.slice(); wrong[1] = "Render";
    const t = setup([receipt(RENDER_A, "completed")], [renderJob()], { headers: wrong });
    const report = vm.runInContext("diagnoseCallbackInbox()", t.context);
    assert(report.headersMatch === false && t.sheet.writes.length === 0, "Mismatch not flagged read-only.");
  });

  test("delivery for an ambiguous submission (QUEUED with reserved render ID, PR #19) is applied", () => {
    const t = setup([receipt(RENDER_A, "completed")], [renderJob({ status: "QUEUED", progress: 0 })]);
    const stats = t.inbox.processPending();
    assert(stats.processed === 1 && result(t.sheet, 0) === "APPLIED", "Delivery for a QUEUED reserved render was not applied.");
    assert(t.store[0].status === "SUCCEEDED" && t.store[0].videoUrl === VIDEO_URL, "QUEUED render did not complete.");
  });

  test("synthetic staging receipt reaching a production inbox is rejected and never applied", () => {
    const synthetic = Object.assign(defaultBody(RENDER_A, "completed"), { synthetic: true });
    const t = setup([receipt(RENDER_A, "completed", synthetic)], [renderJob()]);
    const stats = t.inbox.processPending();
    assert(stats.rejected === 1 && result(t.sheet, 0) === "REJECTED_SYNTHETIC", "Synthetic receipt was not rejected.");
    assert(t.repoWrites.length === 0 && t.store[0].status === "RENDERING", "A synthetic receipt changed a production render.");
  });

  test("synthetic receipt is applied only where the project is marked staging", () => {
    const synthetic = Object.assign(defaultBody(RENDER_A, "completed"), { synthetic: true });
    const t = setup([receipt(RENDER_A, "completed", synthetic)], [renderJob()]);
    vm.runInContext("function isStagingEnvironment_() { return true; }", t.context);
    t.inbox.processPending();
    assert(result(t.sheet, 0) === "APPLIED" && t.store[0].status === "SUCCEEDED", "Staging should apply synthetic receipts.");
  });

  test("recentReceipts returns the latest rows without payloads, read-only", () => {
    const done = receipt(RENDER_A, "failed"); done[5] = new Date(); done[6] = "ORPHANED";
    const t = setup([receipt(RENDER_B, "completed"), done, receipt(RENDER_A, "completed")], [renderJob()]);
    const rows = JSON.parse(JSON.stringify(t.inbox.recentReceipts(2)));
    assert(rows.length === 2, "Expected the last 2 rows.");
    assert(rows[0].renderId === RENDER_A && rows[0].handled === true && rows[0].result === "ORPHANED", "Row summary wrong: " + JSON.stringify(rows[0]));
    assert(rows[1].status === "completed" && rows[1].handled === false && rows[1].receivedAt, "Pending row summary wrong.");
    assert(!JSON.stringify(rows).includes("video"), "Payloads must not be returned.");
    assert(t.sheet.writes.length === 0 && t.lock.released === 0, "recentReceipts must not write or lock.");
  });

  test("recentReceipts is advisory: missing sheet or schema mismatch returns []", () => {
    assert(setup([], [], { noSheet: true }).inbox.recentReceipts(10).length === 0, "Missing sheet should give [].");
    const wrong = HEADERS.slice(); wrong[2] = "State";
    assert(setup([receipt(RENDER_A, "completed")], [], { headers: wrong }).inbox.recentReceipts(10).length === 0, "Mismatch should give [].");
  });

  test("consumer source makes no network calls under the lock", () => {
    const source = fs.readFileSync(path.join(REPO, "Production/MediaWorkerCallbackInbox_Service.js"), "utf8");
    assert(!/UrlFetchApp|fetch\(/.test(source), "Inbox consumer must not make external requests.");
  });

  const failures = results.filter((r) => !r.passed);
  return { passed: failures.length === 0, total: results.length, failures, results };
}

if (require.main === module) {
  const outcome = runCallbackInboxConsumerTests();
  for (const r of outcome.results) console.log((r.passed ? "PASS " : "FAIL ") + r.name + (r.passed ? "" : " - " + r.error));
  console.log(`CallbackInboxConsumer: ${outcome.total - outcome.failures.length}/${outcome.total} passed.`);
  process.exit(outcome.passed ? 0 : 1);
}

module.exports = { runCallbackInboxConsumerTests };
