/****************************************************
 * Project Savannah v1.3 - YouTube upload persistence.
 ****************************************************/
const PublishingJobRepository = (() => {
  const HEADERS = ["Publishing Job ID", "Render Job ID", "Script ID", "SEO Pack ID", "YouTube Video ID",
    "YouTube URL", "Title", "Description", "Tags JSON", "Privacy", "Status", "Error Message",
    "Response JSON", "Created At", "Updated At", "Version", "Model Version"];

  function save(job) {
    const canonical = PublishingJobModel.create(job);
    const sheet = sheet_();
    if (findRow_(sheet, canonical.id)) throw error_("Publishing job already exists.");
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, HEADERS.length).setValues([row_(canonical)]);
    return PublishingJobModel.create(canonical);
  }

  function update(job) {
    const canonical = PublishingJobModel.create(job);
    const sheet = sheet_(), row = findRow_(sheet, canonical.id);
    if (!row) throw error_("Publishing job was not found.");
    sheet.getRange(row, 1, 1, HEADERS.length).setValues([row_(canonical)]);
    return PublishingJobModel.create(canonical);
  }

  function getAll() {
    const sheet = sheet_();
    if (sheet.getLastRow() < 2) return [];
    return sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues()
      .filter(function (row) { return String(row[0] || "").trim(); }).map(fromRow_);
  }

  function getByRenderJobId(renderJobId) {
    const target = required_(renderJobId);
    return getAll().filter(function (job) { return job.renderJobId === target; })
      .sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); })[0] || null;
  }

  function sheet_() {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) throw error_("No active spreadsheet is available.");
    const name = SHEETS.PUBLISHING_JOBS || "Publishing Jobs";
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) sheet = spreadsheet.insertSheet(name);
    const current = sheet.getLastColumn() >= HEADERS.length ?
      sheet.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0] : [];
    if (current.join("|") !== HEADERS.join("|")) {
      if (sheet.getLastRow() > 1 && String(sheet.getRange(2, 1).getDisplayValue()).trim()) {
        throw error_("The Publishing Jobs sheet uses an older structure and contains data.");
      }
      sheet.clear();
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold");
      sheet.setFrozenRows(1);
    }
    return sheet;
  }

  function findRow_(sheet, id) {
    if (sheet.getLastRow() < 2) return 0;
    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues();
    for (let index = 0; index < values.length; index++) {
      if (String(values[index][0]).trim() === id) return index + 2;
    }
    return 0;
  }

  function row_(job) {
    return [job.id, job.renderJobId, job.scriptId, job.seoPackId, job.youtubeVideoId, job.youtubeUrl,
      job.title, job.description, JSON.stringify(job.tags), job.privacyStatus, job.status, job.errorMessage,
      JSON.stringify(job.providerResponse), new Date(job.createdAt), new Date(job.updatedAt),
      job.version, job.modelVersion];
  }

  function fromRow_(row) {
    return PublishingJobModel.create({
      id: row[0], renderJobId: row[1], scriptId: row[2], seoPackId: row[3],
      youtubeVideoId: row[4], youtubeUrl: row[5], title: row[6], description: row[7],
      tags: json_(row[8], []), privacyStatus: row[9], status: row[10], errorMessage: row[11],
      providerResponse: json_(row[12], {}), createdAt: row[13], updatedAt: row[14], version: row[15]
    });
  }

  function json_(value, fallback) { try { return value ? JSON.parse(String(value)) : fallback; } catch (error) { return fallback; } }
  function required_(value) { const result = String(value || "").trim(); if (!result) throw error_("An identifier is required."); return result; }
  function error_(message) { const error = new Error(message); error.name = "PublishingJobRepositoryError"; return error; }

  return { save: save, update: update, getAll: getAll, getByRenderJobId: getByRenderJobId };
})();
