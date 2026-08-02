/****************************************************
 * Project Savannah v1.3
 * Ideas_Repository.js
 *
 * Purpose:
 * Persist, retrieve and update generated video ideas.
 *
 * Responsibilities:
 * - Validate idea collections.
 * - Save generated ideas to the Ideas sheet.
 * - Retrieve idea records.
 * - Update idea workflow statuses.
 * - Return Ideas workspace metrics.
 * - Support the Idea-to-Script workflow.
 *
 * Must not:
 * - Call AI services.
 * - Render frontend HTML.
 * - Calculate provider costs.
 ****************************************************/

const IdeasRepository = {
  /**
   * Ideas sheet column positions.
   *
   * Sheet layout:
   * 1  ID
   * 2  Created At
   * 3  Niche
   * 4  Video Idea
   * 5  Hook
   * 6  Target Audience
   * 7  Status
   * 8  AI Model
   * 9  Prompt Version
   * 10 Run ID
   */
  COLUMNS: {
    ID: 1,
    CREATED_AT: 2,
    NICHE: 3,
    VIDEO_IDEA: 4,
    HOOK: 5,
    TARGET_AUDIENCE: 6,
    STATUS: 7,
    AI_MODEL: 8,
    PROMPT_VERSION: 9,
    RUN_ID: 10
  },

  HEADER_ROW: 1,
  COLUMN_COUNT: 10,

  /**
   * Canonical Ideas workflow statuses.
   */
  STATUS: Object.freeze({
    NEW: "New",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    SCRIPT_READY: "Script Ready"
  }),

  /**
   * Saves generated ideas.
   *
   * @param {Object[]} ideas Generated ideas.
   * @param {Object=} options Persistence options.
   * @return {Object} Save result.
   */
  saveIdeas: function (ideas, options) {
    const saveOptions = options || {};
    const sheet =
      IdeasRepository.getSheet_();

    if (
      !Array.isArray(ideas) ||
      ideas.length === 0
    ) {
      throw new Error(
        "No valid ideas were provided to save."
      );
    }

    const niche = Settings.getNiche();

    const runId =
      IdeasRepository.normaliseText_(
        saveOptions.runId
      ) || createRunId();

    const createdAt =
      saveOptions.createdAt instanceof Date
        ? saveOptions.createdAt
        : new Date();

    const model =
      IdeasRepository.normaliseText_(
        saveOptions.model
      ) || Settings.getModel();

    const promptVersion =
      IdeasRepository.normaliseText_(
        saveOptions.promptVersion
      ) || APP.PROMPT_VERSION;

    const rows = ideas.map(
      function (idea, index) {
        IdeasRepository.validateGeneratedIdea_(
          idea,
          index
        );

        return [
          createIdeaId(),
          createdAt,
          niche,
          IdeasRepository.normaliseText_(
            idea.videoIdea
          ),
          IdeasRepository.normaliseText_(
            idea.hook
          ),
          IdeasRepository.normaliseText_(
            idea.targetAudience
          ),
          IdeasRepository.STATUS.NEW,
          model,
          promptVersion,
          runId
        ];
      }
    );

    sheet
      .getRange(
        sheet.getLastRow() + 1,
        1,
        rows.length,
        IdeasRepository.COLUMN_COUNT
      )
      .setValues(rows);

    return {
      runId: runId,
      savedCount: rows.length,
      createdAt: createdAt,
      ideaIds: rows.map(function (row) {
        return row[
          IdeasRepository.COLUMNS.ID - 1
        ];
      })
    };
  },

  /**
   * Returns stored ideas.
   *
   * Supported options:
   * - limit
   * - status
   * - search
   * - newestFirst
   *
   * @param {Object=} options Query options.
   * @return {Object[]} Idea records.
   */
  listIdeas: function (options) {
    const queryOptions = options || {};
    const sheet =
      IdeasRepository.getSheet_();

    const lastRow = sheet.getLastRow();

    if (
      lastRow <=
      IdeasRepository.HEADER_ROW
    ) {
      return [];
    }

    const rowCount =
      lastRow -
      IdeasRepository.HEADER_ROW;

    const values = sheet
      .getRange(
        IdeasRepository.HEADER_ROW + 1,
        1,
        rowCount,
        IdeasRepository.COLUMN_COUNT
      )
      .getValues();

    const requestedStatus =
      IdeasRepository.normaliseText_(
        queryOptions.status
      ).toLowerCase();

    const searchTerm =
      IdeasRepository.normaliseText_(
        queryOptions.search
      ).toLowerCase();

    const limit =
      IdeasRepository.normaliseLimit_(
        queryOptions.limit,
        100
      );

    let ideas = values.map(
      function (row, index) {
        return IdeasRepository.mapRowToIdea_(
          row,
          IdeasRepository.HEADER_ROW +
            index +
            1
        );
      }
    );

    if (requestedStatus) {
      ideas = ideas.filter(function (idea) {
        return (
          IdeasRepository.normaliseText_(
            idea.status
          ).toLowerCase() ===
          requestedStatus
        );
      });
    }

    if (searchTerm) {
      ideas = ideas.filter(function (idea) {
        const searchableText = [
          idea.id,
          idea.niche,
          idea.videoIdea,
          idea.hook,
          idea.targetAudience,
          idea.status,
          idea.aiModel,
          idea.runId
        ]
          .join(" ")
          .toLowerCase();

        return (
          searchableText.indexOf(
            searchTerm
          ) !== -1
        );
      });
    }

    if (queryOptions.newestFirst !== false) {
      ideas.sort(function (left, right) {
        return (
          IdeasRepository.getTimeValue_(
            right.createdAt
          ) -
          IdeasRepository.getTimeValue_(
            left.createdAt
          )
        );
      });
    }

    return ideas.slice(0, limit);
  },

  /**
   * Retrieves one idea by ID.
   *
   * @param {string} ideaId Idea identifier.
   * @return {Object|null} Idea record.
   */
  getIdeaById: function (ideaId) {
    const normalisedIdeaId =
      IdeasRepository.normaliseText_(ideaId);

    if (!normalisedIdeaId) {
      throw new Error(
        "An idea ID is required."
      );
    }

    const ideas =
      IdeasRepository.listIdeas({
        limit: 10000,
        newestFirst: false
      });

    for (
      let index = 0;
      index < ideas.length;
      index += 1
    ) {
      if (
        ideas[index].id ===
        normalisedIdeaId
      ) {
        return ideas[index];
      }
    }

    return null;
  },

  /**
   * Updates one idea's workflow status.
   *
   * Supported statuses:
   * - New
   * - Approved
   * - Rejected
   * - Script Ready
   *
   * @param {string} ideaId Idea identifier.
   * @param {string} status New status.
   * @return {Object} Updated idea.
   */
  updateIdeaStatus: function (
    ideaId,
    status
  ) {
    const normalisedIdeaId =
      IdeasRepository.normaliseText_(ideaId);

    const normalisedStatus =
      IdeasRepository.normaliseStatus_(
        status
      );

    if (!normalisedIdeaId) {
      throw new Error(
        "An idea ID is required."
      );
    }

    const sheet =
      IdeasRepository.getSheet_();

    const lastRow = sheet.getLastRow();

    if (
      lastRow <=
      IdeasRepository.HEADER_ROW
    ) {
      throw new Error(
        "The requested idea could not be found."
      );
    }

    const idValues = sheet
      .getRange(
        IdeasRepository.HEADER_ROW + 1,
        IdeasRepository.COLUMNS.ID,
        lastRow -
          IdeasRepository.HEADER_ROW,
        1
      )
      .getDisplayValues();

    let matchingRow = 0;

    for (
      let index = 0;
      index < idValues.length;
      index += 1
    ) {
      if (
        IdeasRepository.normaliseText_(
          idValues[index][0]
        ) === normalisedIdeaId
      ) {
        matchingRow =
          IdeasRepository.HEADER_ROW +
          index +
          1;

        break;
      }
    }

    if (!matchingRow) {
      throw new Error(
        "The requested idea could not be found."
      );
    }

    sheet
      .getRange(
        matchingRow,
        IdeasRepository.COLUMNS.STATUS
      )
      .setValue(normalisedStatus);

    SpreadsheetApp.flush();

    const updatedRow = sheet
      .getRange(
        matchingRow,
        1,
        1,
        IdeasRepository.COLUMN_COUNT
      )
      .getValues()[0];

    return IdeasRepository.mapRowToIdea_(
      updatedRow,
      matchingRow
    );
  },

  /**
   * Marks an idea as Script Ready.
   *
   * This should be called only after a script has been
   * generated and persisted successfully.
   *
   * @param {string} ideaId Idea identifier.
   * @return {Object} Updated idea.
   */
  markIdeaScriptReady: function (ideaId) {
    return IdeasRepository.updateIdeaStatus(
      ideaId,
      IdeasRepository.STATUS.SCRIPT_READY
    );
  },

  /**
   * Returns workspace metrics for stored ideas.
   *
   * @return {Object} Idea metrics.
   */
  getMetrics: function () {
    const ideas =
      IdeasRepository.listIdeas({
        limit: 10000,
        newestFirst: false
      });

    const metrics = {
      totalIdeas: ideas.length,
      newIdeas: 0,
      approvedIdeas: 0,
      rejectedIdeas: 0,
      scriptReadyIdeas: 0,
      statusCounts: {}
    };

    ideas.forEach(function (idea) {
      const status =
        IdeasRepository.normaliseStatus_(
          idea.status ||
          IdeasRepository.STATUS.NEW
        );

      if (!metrics.statusCounts[status]) {
        metrics.statusCounts[status] = 0;
      }

      metrics.statusCounts[status] += 1;

      if (
        status ===
        IdeasRepository.STATUS.NEW
      ) {
        metrics.newIdeas += 1;
      }

      if (
        status ===
        IdeasRepository.STATUS.APPROVED
      ) {
        metrics.approvedIdeas += 1;
      }

      if (
        status ===
        IdeasRepository.STATUS.REJECTED
      ) {
        metrics.rejectedIdeas += 1;
      }

      if (
        status ===
        IdeasRepository.STATUS.SCRIPT_READY
      ) {
        metrics.scriptReadyIdeas += 1;
      }
    });

    return metrics;
  },

  /**
   * Returns the current number of saved ideas.
   *
   * @return {number} Idea count.
   */
  getIdeaCount: function () {
    const sheet =
      IdeasRepository.getSheet_();

    return Math.max(
      sheet.getLastRow() -
        IdeasRepository.HEADER_ROW,
      0
    );
  },

  /**
   * Returns all supported Ideas statuses.
   *
   * @return {Object} Status map.
   */
  getStatuses: function () {
    return {
      NEW:
        IdeasRepository.STATUS.NEW,

      APPROVED:
        IdeasRepository.STATUS.APPROVED,

      REJECTED:
        IdeasRepository.STATUS.REJECTED,

      SCRIPT_READY:
        IdeasRepository.STATUS.SCRIPT_READY
    };
  },

  /**
   * Returns the Ideas sheet.
   *
   * @return {GoogleAppsScript.Spreadsheet.Sheet}
   * @private
   */
  getSheet_: function () {
    const spreadsheet =
      SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
      spreadsheet.getSheetByName(
        SHEETS.IDEAS
      );

    if (!sheet) {
      throw new Error(
        "Ideas sheet was not found."
      );
    }

    return sheet;
  },

  /**
   * Maps one sheet row to an idea object.
   *
   * @param {Array<*>} row Sheet row.
   * @param {number} sheetRow Sheet row number.
   * @return {Object} Idea record.
   * @private
   */
  mapRowToIdea_: function (
    row,
    sheetRow
  ) {
    return {
      id:
        IdeasRepository.normaliseText_(
          row[
            IdeasRepository.COLUMNS.ID -
              1
          ]
        ),

      createdAt:
        IdeasRepository.normaliseDateValue_(
          row[
            IdeasRepository.COLUMNS
              .CREATED_AT - 1
          ]
        ),

      niche:
        IdeasRepository.normaliseText_(
          row[
            IdeasRepository.COLUMNS.NICHE -
              1
          ]
        ),

      videoIdea:
        IdeasRepository.normaliseText_(
          row[
            IdeasRepository.COLUMNS
              .VIDEO_IDEA - 1
          ]
        ),

      hook:
        IdeasRepository.normaliseText_(
          row[
            IdeasRepository.COLUMNS.HOOK -
              1
          ]
        ),

      targetAudience:
        IdeasRepository.normaliseText_(
          row[
            IdeasRepository.COLUMNS
              .TARGET_AUDIENCE - 1
          ]
        ),

      status:
        IdeasRepository.normaliseText_(
          row[
            IdeasRepository.COLUMNS.STATUS -
              1
          ]
        ) ||
        IdeasRepository.STATUS.NEW,

      aiModel:
        IdeasRepository.normaliseText_(
          row[
            IdeasRepository.COLUMNS
              .AI_MODEL - 1
          ]
        ),

      promptVersion:
        IdeasRepository.normaliseText_(
          row[
            IdeasRepository.COLUMNS
              .PROMPT_VERSION - 1
          ]
        ),

      runId:
        IdeasRepository.normaliseText_(
          row[
            IdeasRepository.COLUMNS.RUN_ID -
              1
          ]
        ),

      sheetRow: sheetRow
    };
  },

  /**
   * Validates one generated idea.
   *
   * @param {Object} idea Generated idea.
   * @param {number} index Collection index.
   * @private
   */
  validateGeneratedIdea_: function (
    idea,
    index
  ) {
    if (
      !idea ||
      typeof idea !== "object"
    ) {
      throw new Error(
        "Idea " +
          (index + 1) +
          " is invalid."
      );
    }

    if (
      !IdeasRepository.normaliseText_(
        idea.videoIdea
      )
    ) {
      throw new Error(
        "Idea " +
          (index + 1) +
          " is missing videoIdea."
      );
    }

    if (
      !IdeasRepository.normaliseText_(
        idea.hook
      )
    ) {
      throw new Error(
        "Idea " +
          (index + 1) +
          " is missing hook."
      );
    }

    if (
      !IdeasRepository.normaliseText_(
        idea.targetAudience
      )
    ) {
      throw new Error(
        "Idea " +
          (index + 1) +
          " is missing targetAudience."
      );
    }
  },

  /**
   * Validates and normalises a workflow status.
   *
   * @param {string} status Status value.
   * @return {string} Canonical status.
   * @private
   */
  normaliseStatus_: function (status) {
    const requestedStatus =
      IdeasRepository.normaliseText_(
        status
      )
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .toLowerCase();

    const allowedStatuses = [
      IdeasRepository.STATUS.NEW,
      IdeasRepository.STATUS.APPROVED,
      IdeasRepository.STATUS.REJECTED,
      IdeasRepository.STATUS.SCRIPT_READY
    ];

    for (
      let index = 0;
      index < allowedStatuses.length;
      index += 1
    ) {
      if (
        allowedStatuses[index]
          .toLowerCase() ===
        requestedStatus
      ) {
        return allowedStatuses[index];
      }
    }

    throw new Error(
      "Unsupported idea status: " +
        status
    );
  },

  /**
   * Normalises a text value.
   *
   * @param {*} value Input value.
   * @return {string} Trimmed text.
   * @private
   */
  normaliseText_: function (value) {
    if (
      value === undefined ||
      value === null
    ) {
      return "";
    }

    return String(value).trim();
  },

  /**
   * Normalises a list limit.
   *
   * @param {*} value Requested limit.
   * @param {number} fallback Default limit.
   * @return {number} Safe limit.
   * @private
   */
  normaliseLimit_: function (
    value,
    fallback
  ) {
    const numericValue = Number(value);

    if (
      !isFinite(numericValue) ||
      numericValue <= 0
    ) {
      return fallback;
    }

    return Math.min(
      Math.floor(numericValue),
      10000
    );
  },

  /**
   * Converts a date to a frontend-safe value.
   *
   * @param {*} value Date value.
   * @return {string} ISO date or text.
   * @private
   */
  normaliseDateValue_: function (value) {
    if (value instanceof Date) {
      return value.toISOString();
    }

    return (
      IdeasRepository.normaliseText_(
        value
      )
    );
  },

  /**
   * Returns a sortable timestamp.
   *
   * @param {*} value Date value.
   * @return {number} Timestamp.
   * @private
   */
  getTimeValue_: function (value) {
    if (!value) {
      return 0;
    }

    const date = new Date(value);
    const time = date.getTime();

    return isNaN(time) ? 0 : time;
  }
};

/**
 * Generates an idea identifier.
 *
 * @return {string} Idea ID.
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
 * @return {string} Run ID.
 */
function createRunId() {
  return (
    "RUN-" +
    Utilities.getUuid()
      .slice(0, 8)
      .toUpperCase()
  );
}

/**
 * Safe test for Script Ready status support.
 *
 * This temporarily changes one selected idea, so only
 * run it after replacing TEST_ID with a real approved
 * idea ID that you are happy to update.
 *
 * @param {string} ideaId Idea identifier.
 * @return {Object} Updated idea.
 */
function testMarkIdeaScriptReady(ideaId) {
  if (!ideaId) {
    throw new Error(
      "Provide an idea ID when calling testMarkIdeaScriptReady."
    );
  }

  const updatedIdea =
    IdeasRepository.markIdeaScriptReady(
      ideaId
    );

  Logger.log(
    JSON.stringify(
      updatedIdea,
      null,
      2
    )
  );

  return updatedIdea;
}