/****************************************************
 * Project Savannah v1.3 - YouTube metric snapshots.
 ****************************************************/
const AnalyticsSnapshotRepository = (() => {
  const HEADERS = ["Snapshot ID", "YouTube Video ID", "Publishing Job ID", "Script ID", "Title",
    "Published At", "Views", "Likes", "Comments", "Duration Seconds", "Privacy", "Captured At"];

  function save(snapshot) {
    const record = normalise_(snapshot || {}), sheet = sheet_();
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, HEADERS.length).setValues([row_(record)]);
    return record;
  }

  function getAll() {
    const sheet = sheet_();
    if (sheet.getLastRow() < 2) return [];
    return sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues()
      .filter(function (row) { return String(row[0] || "").trim(); }).map(fromRow_);
  }

  function getLatestByVideoId(videoId) {
    const target = String(videoId || "").trim();
    return getAll().filter(function (record) { return record.youtubeVideoId === target; })
      .sort(function (a, b) { return new Date(b.capturedAt) - new Date(a.capturedAt); })[0] || null;
  }

  function sheet_() {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) throw error_("No active spreadsheet is available.");
    const name = SHEETS.ANALYTICS || "Analytics";
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) sheet = spreadsheet.insertSheet(name);
    const current = sheet.getLastColumn() >= HEADERS.length ?
      sheet.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0] : [];
    if (current.join("|") !== HEADERS.join("|")) {
      if (sheet.getLastRow() > 1 && String(sheet.getRange(2, 1).getDisplayValue()).trim()) {
        throw error_("The Analytics sheet uses an unsupported structure and contains data.");
      }
      sheet.clear();
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold");
      sheet.setFrozenRows(1);
    }
    return sheet;
  }

  function normalise_(source) {
    const capturedAt = source.capturedAt ? new Date(source.capturedAt) : new Date();
    const publishedAt = source.publishedAt ? new Date(source.publishedAt) : null;
    return {
      id: String(source.id || "ANA-" + Utilities.getUuid().slice(0, 8).toUpperCase()),
      youtubeVideoId: required_(source.youtubeVideoId, "YouTube video ID"),
      publishingJobId: String(source.publishingJobId || "").trim(),
      scriptId: String(source.scriptId || "").trim(), title: String(source.title || "Untitled video").trim().slice(0, 200),
      publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt.toISOString() : "",
      views: count_(source.views), likes: count_(source.likes), comments: count_(source.comments),
      durationSeconds: Math.max(0, Number(source.durationSeconds || 0)),
      privacyStatus: String(source.privacyStatus || "").trim().toLowerCase(),
      capturedAt: capturedAt.toISOString()
    };
  }
  function row_(record) {
    return [record.id, record.youtubeVideoId, record.publishingJobId, record.scriptId, record.title,
      record.publishedAt ? new Date(record.publishedAt) : "", record.views, record.likes, record.comments,
      record.durationSeconds, record.privacyStatus, new Date(record.capturedAt)];
  }
  function fromRow_(row) {
    return normalise_({ id: row[0], youtubeVideoId: row[1], publishingJobId: row[2], scriptId: row[3],
      title: row[4], publishedAt: row[5], views: row[6], likes: row[7], comments: row[8],
      durationSeconds: row[9], privacyStatus: row[10], capturedAt: row[11] });
  }
  function count_(value) { const number = Number(value || 0); return isFinite(number) && number >= 0 ? Math.floor(number) : 0; }
  function required_(value, label) { const text = String(value || "").trim(); if (!text) throw error_(label + " is required."); return text; }
  function error_(message) { const error = new Error(message); error.name = "AnalyticsRepositoryError"; return error; }
  return { save: save, getAll: getAll, getLatestByVideoId: getLatestByVideoId };
})();

const ChannelAnalyticsRepository = (() => {
  const HEADERS = ["Snapshot ID", "Channel ID", "Channel Title", "Subscribers", "Total Views", "Video Count", "Captured At"];
  function save(source) {
    const record = {
      id: "CHN-" + Utilities.getUuid().slice(0, 8).toUpperCase(),
      channelId: required_(source.channelId), channelTitle: String(source.channelTitle || "").trim(),
      subscribers: count_(source.subscribers), totalViews: count_(source.totalViews),
      videoCount: count_(source.videoCount), capturedAt: new Date().toISOString()
    };
    const sheet = sheet_();
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, HEADERS.length).setValues([[
      record.id, record.channelId, record.channelTitle, record.subscribers,
      record.totalViews, record.videoCount, new Date(record.capturedAt)
    ]]);
    return record;
  }
  function getAll() {
    const sheet = sheet_();
    if (sheet.getLastRow() < 2) return [];
    return sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues()
      .filter(function (row) { return String(row[0] || "").trim(); }).map(function (row) {
        return { id: row[0], channelId: row[1], channelTitle: row[2], subscribers: count_(row[3]),
          totalViews: count_(row[4]), videoCount: count_(row[5]), capturedAt: new Date(row[6]).toISOString() };
      });
  }
  function latest() {
    return getAll().sort(function (a, b) { return new Date(b.capturedAt) - new Date(a.capturedAt); })[0] || null;
  }
  function sheet_() {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) throw error_("No active spreadsheet is available.");
    const name = SHEETS.CHANNEL_ANALYTICS || "Channel Analytics";
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) sheet = spreadsheet.insertSheet(name);
    const current = sheet.getLastColumn() >= HEADERS.length ?
      sheet.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0] : [];
    if (current.join("|") !== HEADERS.join("|")) {
      if (sheet.getLastRow() > 1 && String(sheet.getRange(2, 1).getDisplayValue()).trim()) {
        throw error_("The Channel Analytics sheet uses an unsupported structure and contains data.");
      }
      sheet.clear(); sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold");
      sheet.setFrozenRows(1);
    }
    return sheet;
  }
  function count_(value) { const number = Number(value || 0); return isFinite(number) && number >= 0 ? Math.floor(number) : 0; }
  function required_(value) { const text = String(value || "").trim(); if (!text) throw error_("Channel ID is required."); return text; }
  function error_(message) { const error = new Error(message); error.name = "ChannelAnalyticsRepositoryError"; return error; }
  return { save: save, getAll: getAll, latest: latest };
})();
