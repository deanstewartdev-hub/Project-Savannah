/****************************************************
 * Project Savannah v1.4 - single-writer Cloud Run callback inbox.
 *
 * The standalone anonymous CallbackBridge can append receipts to this sheet,
 * but MUST NOT write Render Jobs. This main-project service is the only
 * consumer, applying receipts while holding the SAME script lock as
 * ProductionController's status-refresh and render-submission actions.
 *
 * For safe migration: deploy the main app and worker before switching the
 * callback URL to the append-only bridge. A pending receipt is durable and
 * can survive a fast callback before the render ID is persisted.
 ****************************************************/
const MediaWorkerCallbackInbox = (() => {
  const HEADERS = ["Receipt ID", "Render ID", "Status", "Payload JSON", "Received At", "Handled At", "Result"];
  const SHEET_NAME = "Render Callback Inbox";
  const MAX_BATCH = 25;
  const RENDER_ID = /^cr-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // A receipt whose render ID never appears in Render Jobs (e.g. submitRender
  // failed after the worker accepted the job) is set aside after this long.
  // The row and its payload are kept; it simply stops being re-read.
  const ORPHAN_AFTER_MS = 48 * 60 * 60 * 1000;
  const MAX_ERROR_ATTEMPTS = 10;

  // Best effort for read paths (page loads, queue ticks): if another production
  // action holds the lock, skip this pass rather than failing the caller. Any
  // receipt left pending is drained by the next pass, or by the locked writes
  // that call processPendingLocked() directly.
  function processPending() {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return emptyStats_({ skipped: true });
    try {
      return processPendingLocked();
    } finally {
      lock.releaseLock();
    }
  }

  // Only call while the MAIN Apps Script project script lock is held.
  // No external network requests are made under the lock.
  function processPendingLocked() {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) throw new Error("Main spreadsheet is unavailable for callback processing.");
    const sheet = spreadsheet.getSheetByName(SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return emptyStats_();
    const headers = sheet.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0];
    if (headers.join("|") !== HEADERS.join("|")) {
      throw new Error("Render Callback Inbox schema mismatch; refusing to process.");
    }
    // Snapshot rows: bridge only appends, while this service updates columns 6-7.
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues();
    const stats = emptyStats_();
    const now = Date.now();
    let attempts = 0;

    for (let i = 0; i < rows.length && attempts < MAX_BATCH; i++) {
      const row = rows[i];
      if (row[5]) continue; // Acknowledged receipt: never replay.
      try {
        if (handleReceipt_(sheet, i + 2, row, now, stats)) attempts++;
      } catch (caught) {
        // Leave the receipt pending (a transient Sheets error must not lose
        // it) and keep going: one bad row must not block the page or queue.
        stats.errors++;
        attempts++;
        recordError_(sheet, i + 2, row, caught, stats);
      }
    }
    return stats;
  }

  // Returns true when the receipt counted toward this pass's batch budget.
  function handleReceipt_(sheet, rowNumber, row, now, stats) {
    const renderId = String(row[1] || "").trim();
    const status = String(row[2] || "");
    let body;
    try { body = JSON.parse(String(row[3] || "")); } catch (ignored) { body = null; }
    if (!RENDER_ID.test(renderId) || ["completed", "failed"].indexOf(status) === -1 ||
        !body || typeof body !== "object" || body.jobId !== renderId || body.status !== status) {
      mark_(sheet, rowNumber, "REJECTED");
      stats.rejected++;
      return true;
    }
    // A "completed" callback with no deliverable video is not proof of success.
    // Never record SUCCEEDED without media evidence; leave the render active so
    // status reconciliation (which inspects the real artifact) decides instead.
    if (status === "completed" && !videoUrl_(body)) {
      mark_(sheet, rowNumber, "REJECTED_NO_VIDEO");
      stats.rejected++;
      return true;
    }
    const current = RenderJobRepository.getByRenderId(renderId);
    if (!current) {
      const receivedAt = timeOf_(row[4]);
      if (isFinite(receivedAt) && now - receivedAt > ORPHAN_AFTER_MS) {
        mark_(sheet, rowNumber, "ORPHANED");
        stats.orphaned++;
        return true;
      }
      // The callback may have arrived before submitRender persisted its ID.
      // Do not acknowledge or discard: retry on the next UI/queue cycle.
      stats.deferred++;
      return false;
    }
    if (["SUCCEEDED", "FAILED", "CANCELLED"].indexOf(current.status) !== -1 ||
        !!current.videoUrl) {
      // The one change allowed after completion: delivery recovery re-signing the
      // SAME artifact (signed links expire). Status and evidence stay untouched.
      if (VideoLinkService.isSameArtifactRefresh(current, body)) {
        RenderJobRepository.update(RenderJobModel.update(current, VideoLinkService.refreshChanges(current, body)));
        mark_(sheet, rowNumber, "LINK_REFRESHED");
        stats.processed++;
        return true;
      }
      mark_(sheet, rowNumber, "IGNORED_TERMINAL");
      stats.ignored++;
      return true;
    }
    const changes = status === "completed" ? completedChanges_(body) : failedChanges_(body);
    // Persist before acknowledgement. A crash between these writes replays
    // safely: next pass sees the terminal render and acknowledges a no-op.
    RenderJobRepository.update(RenderJobModel.update(current, changes));
    mark_(sheet, rowNumber, "APPLIED");
    stats.processed++;
    return true;
  }

  // Pending receipts keep "Handled At" empty; their Result column counts failed
  // attempts ("ERROR 3: ...") so an operator can see them. A receipt that keeps
  // failing is set aside after MAX_ERROR_ATTEMPTS so it cannot consume the
  // batch budget forever. The payload is kept, and the render stays active for
  // status reconciliation, exactly as with REJECTED_NO_VIDEO.
  function recordError_(sheet, rowNumber, row, caught, stats) {
    const previous = /^ERROR (\d+):/.exec(String(row[6] || ""));
    const count = (previous ? Number(previous[1]) : 0) + 1;
    const message = String(caught && caught.message || caught).slice(0, 200);
    try {
      if (count >= MAX_ERROR_ATTEMPTS) {
        mark_(sheet, rowNumber, "FAILED_PERMANENT: " + message);
        stats.failedPermanent++;
      } else {
        sheet.getRange(rowNumber, 7).setValue("ERROR " + count + ": " + message);
      }
    } catch (ignored) {
      // Sheets itself is failing; the receipt simply stays pending.
    }
  }

  // Sheets returns a Date for date-formatted cells but a string for text cells.
  function timeOf_(value) {
    if (value && typeof value.getTime === "function") return value.getTime();
    return Date.parse(String(value || ""));
  }

  function emptyStats_(extra) {
    return Object.assign({ processed: 0, ignored: 0, deferred: 0, rejected: 0, orphaned: 0, errors: 0, failedPermanent: 0 }, extra || {});
  }

  function videoUrl_(body) {
    const video = body.video && typeof body.video === "object" ? body.video : {};
    const url = String(video.url || "").trim();
    return /^https:\/\/\S+$/i.test(url) ? url : "";
  }

  function mark_(sheet, row, result) {
    sheet.getRange(row, 6, 1, 2).setValues([[new Date(), result]]);
  }

  function completedChanges_(body) {
    const video = body.video && typeof body.video === "object" ? body.video : {};
    const probe = body.probe && typeof body.probe === "object" ? body.probe : {};
    const videoUrl = videoUrl_(body);
    return {
      status: "SUCCEEDED", progress: 100, videoUrl: videoUrl,
      errorMessage: "",
      providerResponse: {
        status: "succeeded", progress: 100, url: videoUrl,
        snapshot_url: "", error_message: "", video: video, probe: probe
      }
    };
  }

  function failedChanges_(body) {
    const message = String(
      (body.error && body.error.message) || "The media worker reported a failure."
    ).slice(0, 500);
    return {
      status: "FAILED", errorMessage: message,
      providerResponse: { status: "failed", error_message: message }
    };
  }

  // READ-ONLY summary of the most recent receipts for health checks (no payloads,
  // no lock). Advisory: a missing or mismatched sheet returns [] instead of throwing.
  function recentReceipts(limit) {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet && spreadsheet.getSheetByName(SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return [];
    const headers = sheet.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0];
    if (headers.join("|") !== HEADERS.join("|")) return [];
    const count = Math.min(Math.max(1, Number(limit) || 100), sheet.getLastRow() - 1);
    return sheet.getRange(sheet.getLastRow() - count + 1, 1, count, HEADERS.length).getValues().map(function (row) {
      const received = timeOf_(row[4]);
      return {
        renderId: String(row[1] || "").trim(), status: String(row[2] || ""),
        receivedAt: isFinite(received) ? new Date(received).toISOString() : "",
        handled: !!row[5], result: String(row[6] || "").split(":")[0]
      };
    });
  }

  return { processPending: processPending, processPendingLocked: processPendingLocked,
    recentReceipts: recentReceipts, timeOf: timeOf_ };
})();

/**
 * Owner diagnostic, run from the Apps Script editor. READ-ONLY: it never writes
 * the inbox or Render Jobs. Use it to confirm the callback bridge's
 * RENDER_JOBS_SPREADSHEET_ID equals this project's spreadsheet, and to see the
 * inbox backlog. See CALLBACK_INBOX_STAGING.md.
 */
function diagnoseCallbackInbox() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("This project has no active (bound) spreadsheet.");
  const report = {
    spreadsheetId: spreadsheet.getId(),
    spreadsheetName: spreadsheet.getName(),
    inboxSheetPresent: false,
    headersMatch: null,
    receipts: 0,
    pending: 0,
    pendingWithErrors: 0,
    oldestPendingReceivedAt: "",
    results: {}
  };
  const sheet = spreadsheet.getSheetByName("Render Callback Inbox");
  if (sheet) {
    const expected = ["Receipt ID", "Render ID", "Status", "Payload JSON", "Received At", "Handled At", "Result"];
    report.inboxSheetPresent = true;
    report.headersMatch = sheet.getRange(1, 1, 1, expected.length).getDisplayValues()[0].join("|") === expected.join("|");
    let oldest = 0;
    if (sheet.getLastRow() >= 2) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, expected.length).getValues().forEach(function (row) {
        report.receipts++;
        const outcome = row[5] ? String(row[6] || "").split(":")[0] : "PENDING";
        report.results[outcome] = (report.results[outcome] || 0) + 1;
        if (!row[5]) {
          report.pending++;
          if (/^ERROR \d+:/.test(String(row[6] || ""))) report.pendingWithErrors++;
          const received = MediaWorkerCallbackInbox.timeOf(row[4]);
          if (isFinite(received) && (!oldest || received < oldest)) oldest = received;
        }
      });
    }
    if (oldest) report.oldestPendingReceivedAt = new Date(oldest).toISOString();
  }
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

/**
 * Owner/staging helper, run from the Apps Script editor: drains the inbox once,
 * exactly as opening the Production page does, without polling any provider.
 */
function drainCallbackInboxNow() {
  const stats = MediaWorkerCallbackInbox.processPending();
  Logger.log(JSON.stringify(stats));
  return stats;
}
