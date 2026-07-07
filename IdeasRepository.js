/****************************************************
 * Project Savannah v1.0
 * IdeasRepository.gs
 * Purpose: Save and read generated ideas
 ****************************************************/

const IdeasRepository = {

  saveIdeas: function(ideas) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEETS.IDEAS);

    if (!sheet) {
      throw new Error("Ideas sheet not found.");
    }

    if (!ideas || !Array.isArray(ideas)) {
      throw new Error("No valid ideas were provided to save.");
    }

    const niche = Settings.getNiche();
    const runId = createRunId();
    const createdAt = new Date();

    const rows = ideas.map(function(idea) {
      return [
        createIdeaId(),
        createdAt,
        niche,
        idea.videoIdea || "",
        idea.hook || "",
        idea.targetAudience || "",
        IDEA_STATUS.NEW,
        Settings.getModel(),
        APP.PROMPT_VERSION,
        runId
      ];
    });

    if (rows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    }

    return {
      runId: runId,
      savedCount: rows.length
    };
  },

  getIdeaCount: function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEETS.IDEAS);

    if (!sheet) {
      return 0;
    }

    return Math.max(sheet.getLastRow() - 1, 0);
  }
};

function createIdeaId() {
  return "IDEA-" + Utilities.getUuid().slice(0, 8).toUpperCase();
}

function createRunId() {
  return "RUN-" + Utilities.getUuid().slice(0, 8).toUpperCase();
}