/****************************************************
 * Project Savannah v1.3 - in-app failure monitoring.
 ****************************************************/
const NotificationService = (() => {
  const READ_AT_KEY = "SAVANNAH_NOTIFICATIONS_READ_AT";
  const MAX_SOURCE_ROWS = 250;
  const GROUP_WINDOW_MS = 60 * 60 * 1000;

  function listRecent(options) {
    const config = options || {}, limit = boundedInteger_(config.limit, 1, 50, 20);
    const sheet = logsSheet_(), lastRow = sheet.getLastRow();
    if (lastRow < 2) return emptyFeed_();
    const count = Math.min(MAX_SOURCE_ROWS, lastRow - 1), startRow = lastRow - count + 1;
    const rows = sheet.getRange(startRow, 1, count, 7).getValues();
    const readAt = PropertiesService.getUserProperties().getProperty(READ_AT_KEY) || "";
    return buildFeed(rows, { limit: limit, readAt: readAt, now: new Date().toISOString() });
  }

  function markAllRead() {
    const readAt = new Date().toISOString();
    PropertiesService.getUserProperties().setProperty(READ_AT_KEY, readAt);
    return { readAt: readAt, unreadCount: 0 };
  }

  function buildFeed(rows, options) {
    const config = options || {}, limit = boundedInteger_(config.limit, 1, 50, 20);
    const readAtMs = validTime_(config.readAt), nowMs = validTime_(config.now) || Date.now();
    const cutoffMs = nowMs - 14 * 24 * 60 * 60 * 1000;
    const candidates = (Array.isArray(rows) ? rows : []).map(function (row) {
      const timestampMs = validTime_(row && row[1]), status = String(row && row[4] || "").trim();
      if (!timestampMs || timestampMs < cutoffMs || ["FAILED", "FAILURE", "WARNING"].indexOf(status.toUpperCase()) === -1) return null;
      const action = safeText_(row[3], 80) || "APPLICATION";
      const message = notificationMessage_(status, row[5]);
      return { id: safeText_(row[0], 80), timestamp: new Date(timestampMs).toISOString(), timestampMs: timestampMs,
        runId: safeText_(row[2], 80), action: action, status: status, message: message,
        severity: status.toUpperCase() === "WARNING" ? "warning" : "error", occurrences: 1 };
    }).filter(Boolean).sort(function (a, b) { return b.timestampMs - a.timestampMs; });
    const grouped = [], latestByKey = {};
    candidates.forEach(function (item) {
      const key = item.action + "|" + item.status.toUpperCase() + "|" + item.message;
      const existing = latestByKey[key];
      if (existing && existing.timestampMs - item.timestampMs <= GROUP_WINDOW_MS) {
        existing.occurrences += 1;
        return;
      }
      latestByKey[key] = item; grouped.push(item);
    });
    const notifications = grouped.slice(0, limit).map(function (item) {
      return { id: item.id, timestamp: item.timestamp, runId: item.runId, action: item.action,
        status: item.status, message: item.message, severity: item.severity, occurrences: item.occurrences,
        unread: !readAtMs || item.timestampMs > readAtMs };
    });
    return { notifications: notifications,
      unreadCount: notifications.filter(function (item) { return item.unread; }).length,
      readAt: readAtMs ? new Date(readAtMs).toISOString() : "", generatedAt: new Date(nowMs).toISOString() };
  }

  function emptyFeed_() {
    return { notifications: [], unreadCount: 0, readAt: "", generatedAt: new Date().toISOString() };
  }
  function logsSheet_() {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) throw error_("Project Savannah could not access its spreadsheet.");
    const sheet = spreadsheet.getSheetByName(SHEETS.LOGS);
    if (!sheet) throw error_("Logs sheet was not found.");
    return sheet;
  }
  function safeText_(value, maximum) {
    return String(value || "").replace(/sk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]")
      .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
      .replace(/[A-Fa-f0-9]{32,}/g, "[REDACTED]").trim().slice(0, maximum);
  }
  function notificationMessage_(status, value) {
    const upperStatus = String(status || "").toUpperCase();
    const fallback = upperStatus === "WARNING" ? "A workflow warning was recorded." : "A workflow step failed.";
    const message = safeText_(value, 300) || fallback;
    if (upperStatus !== "FAILED" && upperStatus !== "FAILURE") return message;
    return /\b(fail(?:ed|ure)?|error|could not|unable)\b/i.test(message)
      ? message
      : "Failed while running: " + message;
  }
  function validTime_(value) { const time = value ? new Date(value).getTime() : 0; return isFinite(time) ? time : 0; }
  function boundedInteger_(value, minimum, maximum, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    const number = Number(value);
    if (!Number.isInteger(number) || number < minimum || number > maximum) throw error_("Notification limit is invalid.");
    return number;
  }
  function error_(message) { const error = new Error(message); error.name = "NotificationServiceError"; return error; }
  return { listRecent: listRecent, markAllRead: markAllRead, buildFeed: buildFeed };
})();
