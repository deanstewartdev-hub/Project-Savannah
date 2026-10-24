/****************************************************
 * Project Savannah - production fingerprint (READ-ONLY).
 *
 * Run diagnoseProductionFingerprint() in the PRODUCTION project's editor before
 * starting staging work and again afterwards. If staging never touched
 * production, both runs print the same fingerprint code.
 *
 * It reads each tab's name, row count and last-row ID, plus the NAMES of the
 * script properties (never their values). It writes nothing.
 * Normal use of the app (opening pages writes Logs, renders add rows) also
 * changes the code, so take both readings without using the live app in between.
 ****************************************************/
const ProductionFingerprintService = (() => {
  function summarise(spreadsheet, propertyNames) {
    const tabs = spreadsheet.getSheets().map(function (sheet) {
      const rows = sheet.getLastRow();
      const lastId = rows >= 2 ? String(sheet.getRange(rows, 1).getValue()) : "";
      return { name: sheet.getName(), rows: rows, lastId: lastId };
    }).sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    const names = propertyNames.slice().sort();
    return {
      spreadsheetId: spreadsheet.getId(),
      tabs: tabs,
      scriptPropertyNames: names,
      stagingMarkerPresent: names.indexOf("SAVANNAH_ENVIRONMENT") !== -1
    };
  }

  // Short, stable code: compare two readings at a glance.
  function code(summary, digest) {
    const text = JSON.stringify([summary.spreadsheetId, summary.tabs, summary.scriptPropertyNames]);
    return digest(text).slice(0, 12).toUpperCase();
  }

  return { summarise: summarise, code: code };
})();

/** READ-ONLY. Run in the PRODUCTION editor before and after staging; the codes must match. */
function diagnoseProductionFingerprint() {
  const summary = ProductionFingerprintService.summarise(
    SpreadsheetApp.getActiveSpreadsheet(),
    Object.keys(PropertiesService.getScriptProperties().getProperties())
  );
  const fingerprint = ProductionFingerprintService.code(summary, function (text) {
    return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text).map(function (b) {
      return ((b + 256) % 256).toString(16).padStart(2, "0");
    }).join("");
  });
  Logger.log("Production fingerprint: " + fingerprint +
    (summary.stagingMarkerPresent ? "\nWARNING: this project has SAVANNAH_ENVIRONMENT set. Production must never have it; delete it." : "") +
    "\n" + summary.tabs.map(function (t) { return t.name + ": " + t.rows + " rows, last " + (t.lastId || "-"); }).join("\n"));
  return { fingerprint: fingerprint, summary: summary };
}
