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

  function processPending() {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) throw new Error("Callback inbox is busy; retry.");
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
    if (!sheet || sheet.getLastRow() < 2) {
      return { processed: 0, ignored: 0, deferred: 0, rejected: 0 };
    }
    const headers = sheet.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0];
    if (headers.join("|") !== HEADERS.join("|")) {
      throw new Error("Render Callback Inbox schema mismatch; refusing to process.");
    }
    // Snapshot rows: bridge only appends, while this service updates columns 6-7.
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues();
    const stats = { processed: 0, ignored: 0, deferred: 0, rejected: 0 };
    let attempts = 0;

    for (let i = 0; i < rows.length && attempts < MAX_BATCH; i++) {
      const row = rows[i];
      if (row[5]) continue; // Acknowledged receipt: never replay.
      const renderId = String(row[1] || "").trim();
      const status = String(row[2] || "");
      let body;
      try { body = JSON.parse(String(row[3] || "")); } catch (ignored) { body = null; }
      if (!RENDER_ID.test(renderId) || ["completed", "failed"].indexOf(status) === -1 ||
          !body || body.jobId !== renderId || body.status !== status) {
        mark_(sheet, i + 2, "REJECTED");
        stats.rejected++;
        attempts++;
        continue;
      }
      const current = RenderJobRepository.getByRenderId(renderId);
      if (!current) {
        // The callback may have arrived before submitRender persisted its ID.
        // Do not acknowledge or discard: retry on the next UI/queue cycle.
        stats.deferred++;
        continue;
      }
      attempts++;
      if (["SUCCEEDED", "FAILED", "CANCELLED"].indexOf(current.status) !== -1 ||
          !!current.videoUrl) {
        mark_(sheet, i + 2, "IGNORED_TERMINAL");
        stats.ignored++;
        continue;
      }
      const changes = status === "completed" ? completedChanges_(body) : failedChanges_(body);
      // Persist before acknowledgement. A crash between these writes replays
      // safely: next pass sees the terminal render and acknowledges a no-op.
      RenderJobRepository.update(RenderJobModel.update(current, changes));
      mark_(sheet, i + 2, "APPLIED");
      stats.processed++;
    }
    return stats;
  }

  function mark_(sheet, row, result) {
    sheet.getRange(row, 6, 1, 2).setValues([[new Date(), result]]);
  }

  function completedChanges_(body) {
    const video = body.video && typeof body.video === "object" ? body.video : {};
    const probe = body.probe && typeof body.probe === "object" ? body.probe : {};
    const videoUrl = String(video.url || "");
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

  return { processPending: processPending, processPendingLocked: processPendingLocked };
})();
