/****************************************************
 * Project Savannah v1.2
 * Ideas_Repository.js
 *
 * Purpose:
 * Persist and retrieve generated video ideas.
 *
 * Responsibilities:
 * - Validate idea collections.
 * - Save ideas to the Ideas sheet.
 * - Preserve workflow metadata.
 *
 * Must not:
 * - Call AI services.
 * - Log workflow events.
 * - Calculate provider costs.
 ****************************************************/

const IdeasRepository = {
  /**
   * Saves generated ideas.
   *
   * @param {Object[]} ideas Generated ideas.
   * @param {Object=} options Persistence options.
   * @return {Object} Save result.
   */
  saveIdeas: function (ideas, options) {
    const saveOptions = options || {};

    const spreadsheet =
      SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
      spreadsheet.getSheetByName(SHEETS.IDEAS);

    if (!sheet) {
      throw new Error(
        "Ideas sheet was not found."
      );
    }

    if (
      !ideas ||
      !Array.isArray(ideas) ||
      ideas.length === 0
    ) {
      throw new Error(
        "No valid ideas were provided to save."
      );
    }

    const niche = Settings.getNiche();

    const runId =
      saveOptions.runId || createRunId();

    const createdAt =
      saveOptions.createdAt instanceof Date
        ? saveOptions.createdAt
        : new Date();

    const model =
      saveOptions.model ||
      Settings.getModel();

    const promptVersion =
      saveOptions.promptVersion ||
      APP.PROMPT_VERSION;

    const rows = ideas.map(function (idea) {
      return [
        createIdeaId(),
        createdAt,
        niche,
        String(idea.videoIdea || ""),
        String(idea.hook || ""),
        String(idea.targetAudience || ""),
        IDEA_STATUS.NEW,
        model,
        promptVersion,
        runId
      ];
    });

    sheet
      .getRange(
        sheet.getLastRow() + 1,
        1,
        rows.length,
        rows[0].length
      )
      .setValues(rows);

    return {
      runId: runId,
      savedCount: rows.length,
      createdAt: createdAt
    };
  },

  /**
   * Returns the current number of saved ideas.
   *
   * @return {number}
   */
  getIdeaCount: function () {
    const spreadsheet =
      SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
      spreadsheet.getSheetByName(SHEETS.IDEAS);

    if (!sheet) {
      return 0;
    }

    return Math.max(
      sheet.getLastRow() - 1,
      0
    );
  }
};

/**
 * Generates an idea identifier.
 *
 * @return {string}
 */
function createIdeaId() {
  return (
    "IDEA-" +
    Utilities.getUuid()
      .slice(0, 8)
      .toUpperCase()
  );
}

/**
 * Generates a workflow run identifier.
 *
 * @return {string}
 */
function createRunId() {
  return (
    "RUN-" +
    Utilities.getUuid()
      .slice(0, 8)
      .toUpperCase()
  );
}