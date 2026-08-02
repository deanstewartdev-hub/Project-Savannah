/****************************************************
 * Project Savannah v1.3 - render job persistence.
 ****************************************************/
const RenderJobRepository = (() => {
  const HEADERS = ["Job ID", "Render ID", "Script ID", "SEO Pack ID", "Template ID", "Status",
    "Progress", "Video URL", "Snapshot URL", "Error Message", "Request JSON", "Response JSON",
    "Created At", "Updated At", "Version", "Model Version"];

  function save(job) {
    const canonical = RenderJobModel.create(job);
    const sheet = sheet_();
    if (findRow_(sheet, canonical.id)) throw error_("Render job already exists.");
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, HEADERS.length).setValues([row_(canonical)]);
    return RenderJobModel.toObject(canonical);
  }

  function update(job) {
    const canonical = RenderJobModel.create(job);
    const sheet = sheet_(), row = findRow_(sheet, canonical.id);
    if (!row) throw error_("Render job was not found.");
    sheet.getRange(row, 1, 1, HEADERS.length).setValues([row_(canonical)]);
    return RenderJobModel.toObject(canonical);
  }

  function getById(id) {
    const sheet = sheet_(), row = findRow_(sheet, required_(id));
    return row ? fromRow_(sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0]) : null;
  }

  function getByRenderId(renderId) {
    const target = required_(renderId);
    return getAll().filter(function (job) { return job.renderId === target; })[0] || null;
  }

  function getAll() {
    const sheet = sheet_();
    if (sheet.getLastRow() < 2) return [];
    return sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues()
      .filter(function (row) { return String(row[0] || "").trim(); })
      .map(fromRow_);
  }

  function sheet_() {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) throw error_("No active spreadsheet is available.");
    const name = SHEETS.RENDER_JOBS || "Render Jobs";
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) sheet = spreadsheet.insertSheet(name);
    const current = sheet.getLastColumn() >= HEADERS.length ?
      sheet.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0] : [];
    if (current.join("|") !== HEADERS.join("|")) {
      if (sheet.getLastRow() > 1 && String(sheet.getRange(2, 1).getDisplayValue()).trim()) {
        throw error_("The Render Jobs sheet uses an older structure and contains data.");
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
    return [job.id, job.renderId, job.scriptId, job.seoPackId, job.templateId, job.status,
      job.progress, job.videoUrl, job.snapshotUrl, job.errorMessage, JSON.stringify(job.requestPayload),
      JSON.stringify(job.providerResponse), new Date(job.createdAt), new Date(job.updatedAt),
      job.version, job.modelVersion];
  }

  function fromRow_(row) {
    return RenderJobModel.create({
      id: row[0], renderId: row[1], scriptId: row[2], seoPackId: row[3], templateId: row[4],
      status: row[5], progress: row[6], videoUrl: row[7], snapshotUrl: row[8], errorMessage: row[9],
      requestPayload: json_(row[10]), providerResponse: json_(row[11]), createdAt: row[12],
      updatedAt: row[13], version: row[14]
    });
  }

  function json_(value) { try { return value ? JSON.parse(String(value)) : {}; } catch (error) { return {}; } }
  function required_(value) { const result = String(value || "").trim(); if (!result) throw error_("An identifier is required."); return result; }
  function error_(message) { const error = new Error(message); error.name = "RenderJobRepositoryError"; return error; }

  return { save: save, update: update, getById: getById, getByRenderId: getByRenderId, getAll: getAll };
})();
