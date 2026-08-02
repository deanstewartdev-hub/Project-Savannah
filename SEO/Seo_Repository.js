/****************************************************
 * Project Savannah v1.3 - SEO Pack persistence.
 ****************************************************/
const SeoRepository = (() => {
  const HEADERS = ["SEO ID", "Script ID", "Idea ID", "Title Options JSON", "Description", "Tags JSON",
    "Hashtags JSON", "Keywords JSON", "Thumbnail Text", "Pinned Comment", "Status", "Prompt Version",
    "AI Model", "Metadata JSON", "Created At", "Updated At", "Version", "Model Version"];
  function save(pack) {
    const canonical = SeoPackModel.create(pack), sheet = sheet_();
    if (findRow_(sheet, canonical.id)) throw error_("SEO pack already exists.");
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, HEADERS.length).setValues([row_(canonical)]);
    return SeoPackModel.toObject(canonical);
  }
  function getById(id) {
    const sheet = sheet_(), row = findRow_(sheet, required_(id));
    return row ? fromRow_(sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0]) : null;
  }
  function getByScriptId(scriptId) {
    const target = required_(scriptId);
    return all().filter(function (pack) { return pack.scriptId === target; })
      .sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); })[0] || null;
  }
  function all() {
    const sheet = sheet_();
    if (sheet.getLastRow() < 2) return [];
    return sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues()
      .filter(function (row) { return String(row[0] || "").trim(); }).map(fromRow_);
  }
  function sheet_() {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) throw error_("No active spreadsheet is available.");
    const name = typeof SHEETS !== "undefined" && SHEETS.SEO_PACK ? SHEETS.SEO_PACK : "SEO Pack";
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) sheet = spreadsheet.insertSheet(name);
    const current = sheet.getLastColumn() >= HEADERS.length ? sheet.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0] : [];
    if (current.join("|") !== HEADERS.join("|")) {
      if (sheet.getLastRow() > 1 && String(sheet.getRange(2, 1).getDisplayValue()).trim()) {
        throw error_("The SEO Pack sheet uses an older structure and contains data.");
      }
      sheet.clear();
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold");
      sheet.setFrozenRows(1);
    }
    return sheet;
  }
  function findRow_(sheet, id) {
    if (sheet.getLastRow() < 2) return 0;
    const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues();
    for (let i = 0; i < ids.length; i++) if (String(ids[i][0]).trim() === id) return i + 2;
    return 0;
  }
  function row_(p) {
    return [p.id, p.scriptId, p.ideaId, JSON.stringify(p.titleOptions), p.description, JSON.stringify(p.tags),
      JSON.stringify(p.hashtags), JSON.stringify(p.keywords), p.thumbnailText, p.pinnedComment, p.status,
      p.promptVersion, p.aiModel, JSON.stringify(p.metadata), new Date(p.createdAt), new Date(p.updatedAt),
      p.version, p.modelVersion];
  }
  function fromRow_(r) {
    return SeoPackModel.create({ id: r[0], scriptId: r[1], ideaId: r[2], titleOptions: json_(r[3], []),
      description: r[4], tags: json_(r[5], []), hashtags: json_(r[6], []), keywords: json_(r[7], []),
      thumbnailText: r[8], pinnedComment: r[9], status: r[10], promptVersion: r[11], aiModel: r[12],
      metadata: json_(r[13], {}), createdAt: r[14], updatedAt: r[15], version: r[16] });
  }
  function json_(v, fallback) { try { return v ? JSON.parse(String(v)) : fallback; } catch (e) { throw error_("Invalid JSON in SEO Pack sheet."); } }
  function required_(v) { const r = String(v || "").trim(); if (!r) throw error_("An identifier is required."); return r; }
  function error_(m) { const e = new Error(m); e.name = "SeoRepositoryError"; return e; }
  return { save: save, getById: getById, getByScriptId: getByScriptId, getAll: all };
})();
