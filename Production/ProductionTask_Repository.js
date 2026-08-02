/****************************************************
 * Project Savannah v1.3 - persistent scene preparation.
 ****************************************************/
const ProductionTaskRepository = (() => {
  const HEADERS = ["Task ID", "Script ID", "Source Render Job ID", "Render Job ID", "Status", "Priority",
    "Prepared Scenes JSON", "Next Scene", "Attempts", "Error Message", "Created At", "Updated At"];
  const ACTIVE = ["PREPARING", "PAUSED", "READY", "SUBMITTING", "FAILED"];

  function create(data) {
    const source = data || {}, now = new Date().toISOString();
    return normalise_({
      id: source.id || "PRD-" + Utilities.getUuid().slice(0, 8).toUpperCase(),
      scriptId: source.scriptId,
      sourceRenderJobId: source.sourceRenderJobId,
      renderJobId: source.renderJobId,
      status: source.status || "PREPARING",
      priority: source.priority || 3,
      preparedScenes: source.preparedScenes || [],
      nextScene: source.nextScene || 1,
      attempts: source.attempts || 0,
      errorMessage: source.errorMessage,
      createdAt: source.createdAt || now,
      updatedAt: source.updatedAt || now
    });
  }

  function update(task, changes) {
    return normalise_(Object.assign({}, task, changes || {}, {
      id: task.id,
      scriptId: task.scriptId,
      createdAt: task.createdAt,
      updatedAt: new Date().toISOString()
    }));
  }

  function save(task) {
    const canonical = create(task), sheet = sheet_();
    if (findRow_(sheet, canonical.id)) throw error_("Production task already exists.");
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, HEADERS.length).setValues([row_(canonical)]);
    return canonical;
  }

  function persist(task) {
    const canonical = create(task), sheet = sheet_(), row = findRow_(sheet, canonical.id);
    if (!row) throw error_("Production task was not found.");
    sheet.getRange(row, 1, 1, HEADERS.length).setValues([row_(canonical)]);
    return canonical;
  }

  function getById(id) {
    const sheet = sheet_(), row = findRow_(sheet, required_(id));
    return row ? fromRow_(sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0]) : null;
  }

  function getAll() {
    const sheet = sheet_();
    if (sheet.getLastRow() < 2) return [];
    return sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues()
      .filter(function (row) { return String(row[0] || "").trim(); }).map(fromRow_);
  }

  function getActiveByScriptId(scriptId) {
    const target = required_(scriptId);
    return getAll().filter(function (task) {
      return task.scriptId === target && ACTIVE.indexOf(task.status) !== -1;
    }).sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); })[0] || null;
  }

  function sheet_() {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) throw error_("No active spreadsheet is available.");
    const name = SHEETS.PRODUCTION_TASKS || "Production Tasks";
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) sheet = spreadsheet.insertSheet(name);
    const current = sheet.getLastColumn() >= HEADERS.length ?
      sheet.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0] : [];
    if (current.join("|") !== HEADERS.join("|")) {
      if (sheet.getLastRow() > 1 && String(sheet.getRange(2, 1).getDisplayValue()).trim()) {
        throw error_("The Production Tasks sheet uses an unsupported structure and contains data.");
      }
      sheet.clear();
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold");
      sheet.setFrozenRows(1);
    }
    return sheet;
  }

  function normalise_(source) {
    const status = String(source.status || "PREPARING").trim().toUpperCase();
    if (["PREPARING", "PAUSED", "READY", "SUBMITTING", "SUBMITTED", "CANCELLED", "FAILED"].indexOf(status) === -1) {
      throw error_("Invalid production task status.");
    }
    const prepared = Array.isArray(source.preparedScenes) ? source.preparedScenes.map(Number)
      .filter(function (value, index, values) { return value >= 1 && value <= 4 && values.indexOf(value) === index; }) : [];
    const nextScene = Math.max(1, Math.min(5, Number(source.nextScene || 1)));
    const priority = source.priority === undefined || source.priority === null || source.priority === "" ?
      3 : Number(source.priority);
    if (!Number.isInteger(priority) || priority < 1 || priority > 5) {
      throw error_("Production task priority must be an integer from 1 to 5.");
    }
    return {
      id: required_(source.id), scriptId: required_(source.scriptId),
      sourceRenderJobId: String(source.sourceRenderJobId || "").trim(),
      renderJobId: String(source.renderJobId || "").trim(), status: status,
      priority: priority,
      preparedScenes: prepared.sort(), nextScene: nextScene,
      attempts: Math.max(0, Number(source.attempts || 0)),
      errorMessage: String(source.errorMessage || "").trim().slice(0, 500),
      createdAt: new Date(source.createdAt).toISOString(), updatedAt: new Date(source.updatedAt).toISOString()
    };
  }

  function row_(task) {
    return [task.id, task.scriptId, task.sourceRenderJobId, task.renderJobId, task.status, task.priority,
      JSON.stringify(task.preparedScenes), task.nextScene, task.attempts, task.errorMessage,
      new Date(task.createdAt), new Date(task.updatedAt)];
  }
  function fromRow_(row) {
    let scenes = [];
    try { scenes = JSON.parse(String(row[6] || "[]")); } catch (ignored) { scenes = []; }
    return create({ id: row[0], scriptId: row[1], sourceRenderJobId: row[2], renderJobId: row[3],
      status: row[4], priority: row[5], preparedScenes: scenes, nextScene: row[7], attempts: row[8],
      errorMessage: row[9], createdAt: row[10], updatedAt: row[11] });
  }
  function findRow_(sheet, id) {
    if (sheet.getLastRow() < 2) return 0;
    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues();
    for (let index = 0; index < values.length; index++) {
      if (String(values[index][0]).trim() === id) return index + 2;
    }
    return 0;
  }
  function required_(value) { const text = String(value || "").trim(); if (!text) throw error_("An identifier is required."); return text; }
  function error_(message) { const error = new Error(message); error.name = "ProductionTaskRepositoryError"; return error; }

  return { create: create, update: update, save: save, persist: persist, getById: getById,
    getAll: getAll, getActiveByScriptId: getActiveByScriptId };
})();

function testProductionTaskRepositoryModel() {
  const task = ProductionTaskRepository.create({ scriptId: "SCR-TEST" });
  if (task.status !== "PREPARING" || task.nextScene !== 1) throw new Error("Production task defaults are invalid.");
  return { passed: true };
}
