/****************************************************
 * Project Savannah v1.2
 * Scripts_Repository.js
 *
 * Purpose:
 * Persist and retrieve canonical ScriptModel records
 * using the Google Sheets Scripts worksheet.
 *
 * Responsibilities:
 * - Create and verify the Scripts sheet structure.
 * - Save new ScriptModel records.
 * - Update existing ScriptModel records.
 * - Retrieve scripts by script ID or idea ID.
 * - Convert sheet rows into ScriptModel objects.
 * - Serialise complex fields safely as JSON.
 * - Prevent duplicate script identifiers.
 *
 * Must not:
 * - Call AI providers.
 * - Build prompts.
 * - Validate creative quality.
 * - Format script presentation text.
 * - Log workflow events.
 * - Calculate provider costs.
 ****************************************************/

const ScriptsRepository = (() => {
  const REPOSITORY_VERSION = "scripts-repository-v1.0";

  const HEADERS = Object.freeze([
    "Script ID",
    "Idea ID",
    "Title",
    "Hook",
    "Voiceover Script",
    "Scenes JSON",
    "Call To Action",
    "Estimated Duration Seconds",
    "Generation Notes",
    "Status",
    "Validation JSON",
    "Formatting JSON",
    "Metadata JSON",
    "Display Text",
    "Prompt Version",
    "AI Model",
    "Created At",
    "Updated At",
    "Version",
    "Model Version"
  ]);

  const COLUMN = Object.freeze({
    SCRIPT_ID: 1,
    IDEA_ID: 2,
    TITLE: 3,
    HOOK: 4,
    VOICEOVER_SCRIPT: 5,
    SCENES_JSON: 6,
    CALL_TO_ACTION: 7,
    ESTIMATED_DURATION_SECONDS: 8,
    GENERATION_NOTES: 9,
    STATUS: 10,
    VALIDATION_JSON: 11,
    FORMATTING_JSON: 12,
    METADATA_JSON: 13,
    DISPLAY_TEXT: 14,
    PROMPT_VERSION: 15,
    AI_MODEL: 16,
    CREATED_AT: 17,
    UPDATED_AT: 18,
    VERSION: 19,
    MODEL_VERSION: 20
  });

  /**
   * Saves a new ScriptModel record.
   *
   * Duplicate script IDs are rejected. Use updateScript()
   * when modifying an existing record.
   *
   * @param {Object} script ScriptModel record.
   * @return {Object} Save result.
   */
  function saveScript(script) {
    const sheet = getOrCreateSheet_();
    const canonicalScript = ScriptModel.create(script);

    const existingRow = findRowByScriptId_(
      sheet,
      canonicalScript.id
    );

    if (existingRow > 0) {
      throw createRepositoryError_(
        "A script with ID " +
          canonicalScript.id +
          " already exists."
      );
    }

    const rowNumber = sheet.getLastRow() + 1;
    const rowValues = toRow_(canonicalScript);

    sheet
      .getRange(
        rowNumber,
        1,
        1,
        HEADERS.length
      )
      .setValues([rowValues]);

    return {
      saved: true,
      created: true,
      updated: false,
      rowNumber: rowNumber,
      scriptId: canonicalScript.id,
      ideaId: canonicalScript.ideaId,
      version: canonicalScript.version,
      repositoryVersion: REPOSITORY_VERSION
    };
  }

  /**
   * Saves a ScriptModel record or updates it when its
   * script ID already exists.
   *
   * @param {Object} script ScriptModel record.
   * @return {Object} Save or update result.
   */
  function saveOrUpdateScript(script) {
    const canonicalScript = ScriptModel.create(script);
    const existing = getScriptById(canonicalScript.id);

    if (existing) {
      return updateScript(canonicalScript);
    }

    return saveScript(canonicalScript);
  }

  /**
   * Updates an existing ScriptModel record.
   *
   * The supplied script must already contain the version,
   * timestamps and ID that should be persisted.
   *
   * @param {Object} script Updated ScriptModel record.
   * @return {Object} Update result.
   */
  function updateScript(script) {
    const sheet = getOrCreateSheet_();
    const canonicalScript = ScriptModel.create(script);

    const rowNumber = findRowByScriptId_(
      sheet,
      canonicalScript.id
    );

    if (rowNumber === 0) {
      throw createRepositoryError_(
        "Script " +
          canonicalScript.id +
          " could not be updated because it does not exist."
      );
    }

    const storedScript = rowToScript_(
      sheet
        .getRange(
          rowNumber,
          1,
          1,
          HEADERS.length
        )
        .getValues()[0]
    );

    if (
      canonicalScript.version <
      storedScript.version
    ) {
      throw createRepositoryError_(
        "Script " +
          canonicalScript.id +
          " cannot be updated with an older version."
      );
    }

    sheet
      .getRange(
        rowNumber,
        1,
        1,
        HEADERS.length
      )
      .setValues([toRow_(canonicalScript)]);

    return {
      saved: true,
      created: false,
      updated: true,
      rowNumber: rowNumber,
      scriptId: canonicalScript.id,
      ideaId: canonicalScript.ideaId,
      version: canonicalScript.version,
      repositoryVersion: REPOSITORY_VERSION
    };
  }

  /**
   * Finds one script by its script ID.
   *
   * @param {string} scriptId Script identifier.
   * @return {?Object} ScriptModel record or null.
   */
  function getScriptById(scriptId) {
    const normalisedId = requireIdentifier_(
      scriptId,
      "Script ID"
    );

    const sheet = getOrCreateSheet_();
    const rowNumber = findRowByScriptId_(
      sheet,
      normalisedId
    );

    if (rowNumber === 0) {
      return null;
    }

    const row = sheet
      .getRange(
        rowNumber,
        1,
        1,
        HEADERS.length
      )
      .getValues()[0];

    return rowToScript_(row);
  }

  /**
   * Returns every script associated with an idea ID.
   *
   * The newest updated script is returned first.
   *
   * @param {string} ideaId Idea identifier.
   * @return {Object[]} Matching ScriptModel records.
   */
  function getScriptsByIdeaId(ideaId) {
    const normalisedIdeaId = requireIdentifier_(
      ideaId,
      "Idea ID"
    );

    return getAllScripts().filter(function (script) {
      return script.ideaId === normalisedIdeaId;
    }).sort(function (first, second) {
      return (
        new Date(second.updatedAt).getTime() -
        new Date(first.updatedAt).getTime()
      );
    });
  }

  /**
   * Returns the newest script for an idea.
   *
   * @param {string} ideaId Idea identifier.
   * @return {?Object} Newest ScriptModel or null.
   */
  function getLatestScriptByIdeaId(ideaId) {
    const scripts = getScriptsByIdeaId(ideaId);

    return scripts.length > 0
      ? scripts[0]
      : null;
  }

  /**
   * Returns all stored scripts.
   *
   * @return {Object[]} ScriptModel records.
   */
  function getAllScripts() {
    const sheet = getOrCreateSheet_();
    const lastRow = sheet.getLastRow();

    if (lastRow <= 1) {
      return [];
    }

    const rows = sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        HEADERS.length
      )
      .getValues();

    return rows
      .filter(function (row) {
        return String(
          row[COLUMN.SCRIPT_ID - 1] || ""
        ).trim() !== "";
      })
      .map(function (row) {
        return rowToScript_(row);
      });
  }

  /**
   * Returns scripts matching a workflow status.
   *
   * @param {string} status Script workflow status.
   * @return {Object[]} Matching scripts.
   */
  function getScriptsByStatus(status) {
    const normalisedStatus = String(status || "")
      .trim()
      .toUpperCase();

    const allowedStatuses =
      ScriptModel.getStatuses();

    const validStatuses = Object.keys(
      allowedStatuses
    ).map(function (key) {
      return allowedStatuses[key];
    });

    if (
      validStatuses.indexOf(normalisedStatus) === -1
    ) {
      throw createRepositoryError_(
        "Unsupported script status: " +
          normalisedStatus +
          "."
      );
    }

    return getAllScripts().filter(function (script) {
      return script.status === normalisedStatus;
    });
  }

  /**
   * Returns the number of stored scripts.
   *
   * @return {number} Stored script count.
   */
  function getScriptCount() {
    const sheet = getOrCreateSheet_();

    return Math.max(
      sheet.getLastRow() - 1,
      0
    );
  }

  /**
   * Determines whether a script ID exists.
   *
   * @param {string} scriptId Script identifier.
   * @return {boolean} True when found.
   */
  function exists(scriptId) {
    const normalisedId = requireIdentifier_(
      scriptId,
      "Script ID"
    );

    const sheet = getOrCreateSheet_();

    return (
      findRowByScriptId_(
        sheet,
        normalisedId
      ) > 0
    );
  }

  /**
   * Deletes a script by ID.
   *
   * Primarily intended for administrative maintenance
   * and automated repository tests.
   *
   * @param {string} scriptId Script identifier.
   * @return {Object} Delete result.
   */
  function deleteScriptById(scriptId) {
    const normalisedId = requireIdentifier_(
      scriptId,
      "Script ID"
    );

    const sheet = getOrCreateSheet_();
    const rowNumber = findRowByScriptId_(
      sheet,
      normalisedId
    );

    if (rowNumber === 0) {
      return {
        deleted: false,
        scriptId: normalisedId
      };
    }

    sheet.deleteRow(rowNumber);

    return {
      deleted: true,
      scriptId: normalisedId
    };
  }

  /**
   * Ensures the Scripts sheet and canonical headers exist.
   *
   * @return {GoogleAppsScript.Spreadsheet.Sheet}
   */
  function ensureSheet() {
    return getOrCreateSheet_();
  }

  /**
   * Returns or creates the Scripts sheet.
   *
   * @return {GoogleAppsScript.Spreadsheet.Sheet}
   */
  function getOrCreateSheet_() {
    const spreadsheet =
      SpreadsheetApp.getActiveSpreadsheet();

    if (!spreadsheet) {
      throw createRepositoryError_(
        "No active spreadsheet is available."
      );
    }

    const sheetName = resolveSheetName_();

    let sheet =
      spreadsheet.getSheetByName(sheetName);

    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
    }

    ensureHeaders_(sheet);

    return sheet;
  }

  /**
   * Resolves the configured Scripts sheet name.
   *
   * @return {string} Sheet name.
   */
  function resolveSheetName_() {
    if (
      typeof SHEETS !== "undefined" &&
      SHEETS &&
      SHEETS.SCRIPTS
    ) {
      return SHEETS.SCRIPTS;
    }

    return "Scripts";
  }

  /**
   * Creates or verifies the repository headers.
   *
   * Empty sheets receive the canonical header row.
   * Existing non-empty headers must match exactly to
   * prevent writing records into an incompatible schema.
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
   */
  function ensureHeaders_(sheet) {
    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();

    if (lastRow === 0 || lastColumn === 0) {
      writeHeaders_(sheet);
      return;
    }

    const existingHeaders = sheet
      .getRange(
        1,
        1,
        1,
        Math.max(lastColumn, HEADERS.length)
      )
      .getValues()[0];

    const hasAnyHeader = existingHeaders.some(
      function (value) {
        return String(value || "").trim() !== "";
      }
    );

    if (!hasAnyHeader) {
      writeHeaders_(sheet);
      return;
    }

    const mismatches = [];

    HEADERS.forEach(function (
      expectedHeader,
      index
    ) {
      const actualHeader = String(
        existingHeaders[index] || ""
      ).trim();

      if (actualHeader !== expectedHeader) {
        mismatches.push(
          "Column " +
            (index + 1) +
            ' expected "' +
            expectedHeader +
            '" but found "' +
            actualHeader +
            '".'
        );
      }
    });

    if (mismatches.length > 0) {
      throw createRepositoryError_(
        "The Scripts sheet headers do not match the repository schema:\n- " +
          mismatches.join("\n- ")
      );
    }
  }

  /**
   * Writes canonical repository headers.
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
   */
  function writeHeaders_(sheet) {
    sheet
      .getRange(
        1,
        1,
        1,
        HEADERS.length
      )
      .setValues([HEADERS.slice()]);

    sheet
      .getRange(
        1,
        1,
        1,
        HEADERS.length
      )
      .setFontWeight("bold");

    sheet.setFrozenRows(1);

    sheet.autoResizeColumns(
      1,
      HEADERS.length
    );
  }

  /**
   * Finds a sheet row using the Script ID column.
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
   * @param {string} scriptId Script identifier.
   * @return {number} Sheet row number or zero.
   */
  function findRowByScriptId_(
    sheet,
    scriptId
  ) {
    const lastRow = sheet.getLastRow();

    if (lastRow <= 1) {
      return 0;
    }

    const ids = sheet
      .getRange(
        2,
        COLUMN.SCRIPT_ID,
        lastRow - 1,
        1
      )
      .getDisplayValues();

    for (let index = 0; index < ids.length; index++) {
      const storedId = String(
        ids[index][0] || ""
      ).trim();

      if (storedId === scriptId) {
        return index + 2;
      }
    }

    return 0;
  }

  /**
   * Converts a ScriptModel into a spreadsheet row.
   *
   * @param {Object} script Canonical script.
   * @return {Array} Spreadsheet row.
   */
  function toRow_(script) {
    return [
      script.id,
      script.ideaId,
      script.title,
      script.hook,
      script.voiceoverScript,
      serialiseJson_(
        script.scenes,
        "scenes"
      ),
      script.callToAction,
      script.estimatedDurationSeconds === null
        ? ""
        : script.estimatedDurationSeconds,
      script.generationNotes,
      script.status,
      serialiseJson_(
        script.validation,
        "validation"
      ),
      serialiseJson_(
        script.formatting,
        "formatting"
      ),
      serialiseJson_(
        script.metadata,
        "metadata"
      ),
      script.displayText,
      script.promptVersion,
      script.aiModel,
      new Date(script.createdAt),
      new Date(script.updatedAt),
      script.version,
      script.modelVersion
    ];
  }

  /**
   * Converts a spreadsheet row into a ScriptModel.
   *
   * @param {Array} row Spreadsheet row.
   * @return {Object} Canonical ScriptModel.
   */
  function rowToScript_(row) {
    if (!Array.isArray(row)) {
      throw createRepositoryError_(
        "A valid spreadsheet row is required."
      );
    }

    try {
      return ScriptModel.create({
        id: String(
          row[COLUMN.SCRIPT_ID - 1] || ""
        ).trim(),

        ideaId: String(
          row[COLUMN.IDEA_ID - 1] || ""
        ).trim(),

        title: String(
          row[COLUMN.TITLE - 1] || ""
        ).trim(),

        hook: String(
          row[COLUMN.HOOK - 1] || ""
        ).trim(),

        voiceoverScript: String(
          row[
            COLUMN.VOICEOVER_SCRIPT - 1
          ] || ""
        ).trim(),

        scenes: parseJson_(
          row[COLUMN.SCENES_JSON - 1],
          [],
          "scenes"
        ),

        callToAction: String(
          row[
            COLUMN.CALL_TO_ACTION - 1
          ] || ""
        ).trim(),

        estimatedDurationSeconds:
          normaliseStoredNumber_(
            row[
              COLUMN
                .ESTIMATED_DURATION_SECONDS -
                1
            ]
          ),

        generationNotes: String(
          row[
            COLUMN.GENERATION_NOTES - 1
          ] || ""
        ).trim(),

        status: String(
          row[COLUMN.STATUS - 1] || ""
        ).trim(),

        validation: parseJson_(
          row[COLUMN.VALIDATION_JSON - 1],
          {},
          "validation"
        ),

        formatting: parseJson_(
          row[COLUMN.FORMATTING_JSON - 1],
          {},
          "formatting"
        ),

        metadata: parseJson_(
          row[COLUMN.METADATA_JSON - 1],
          {},
          "metadata"
        ),

        displayText: String(
          row[COLUMN.DISPLAY_TEXT - 1] || ""
        ),

        promptVersion: String(
          row[COLUMN.PROMPT_VERSION - 1] || ""
        ).trim(),

        aiModel: String(
          row[COLUMN.AI_MODEL - 1] || ""
        ).trim(),

        createdAt: normaliseStoredDate_(
          row[COLUMN.CREATED_AT - 1],
          "Created At"
        ),

        updatedAt: normaliseStoredDate_(
          row[COLUMN.UPDATED_AT - 1],
          "Updated At"
        ),

        version: Number(
          row[COLUMN.VERSION - 1]
        ),

        modelVersion: String(
          row[COLUMN.MODEL_VERSION - 1] || ""
        ).trim()
      });
    } catch (error) {
      throw createRepositoryError_(
        "A stored script row could not be converted: " +
          error.message
      );
    }
  }

  /**
   * Serialises JSON-compatible data.
   *
   * @param {*} value Source value.
   * @param {string} fieldName Field description.
   * @return {string} JSON value.
   */
  function serialiseJson_(value, fieldName) {
    try {
      return JSON.stringify(value);
    } catch (error) {
      throw createRepositoryError_(
        "The " +
          fieldName +
          " field could not be serialised."
      );
    }
  }

  /**
   * Parses a stored JSON value.
   *
   * @param {*} value Stored value.
   * @param {*} fallback Empty-value fallback.
   * @param {string} fieldName Field description.
   * @return {*} Parsed value.
   */
  function parseJson_(
    value,
    fallback,
    fieldName
  ) {
    if (
      value === undefined ||
      value === null ||
      String(value).trim() === ""
    ) {
      return clone_(fallback);
    }

    try {
      return JSON.parse(String(value));
    } catch (error) {
      throw createRepositoryError_(
        "The stored " +
          fieldName +
          " JSON is invalid."
      );
    }
  }

  /**
   * Normalises a number read from Sheets.
   *
   * @param {*} value Stored value.
   * @return {?number} Number or null.
   */
  function normaliseStoredNumber_(value) {
    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      return null;
    }

    const numericValue = Number(value);

    if (!isFinite(numericValue)) {
      throw createRepositoryError_(
        "A stored numeric value is invalid."
      );
    }

    return numericValue;
  }

  /**
   * Normalises a date read from Sheets.
   *
   * @param {*} value Stored value.
   * @param {string} fieldName Field description.
   * @return {string} ISO timestamp.
   */
  function normaliseStoredDate_(
    value,
    fieldName
  ) {
    const date = value instanceof Date
      ? value
      : new Date(value);

    if (isNaN(date.getTime())) {
      throw createRepositoryError_(
        fieldName +
          " contains an invalid timestamp."
      );
    }

    return date.toISOString();
  }

  /**
   * Validates a repository identifier.
   *
   * @param {*} value Identifier value.
   * @param {string} fieldName Field description.
   * @return {string} Normalised identifier.
   */
  function requireIdentifier_(
    value,
    fieldName
  ) {
    const normalised = String(value || "")
      .trim();

    if (!normalised) {
      throw createRepositoryError_(
        fieldName + " is required."
      );
    }

    return normalised;
  }

  /**
   * Creates a JSON-compatible clone.
   *
   * @param {*} value Source value.
   * @return {*} Cloned value.
   */
  function clone_(value) {
    if (value === undefined) {
      return undefined;
    }

    return JSON.parse(JSON.stringify(value));
  }

  /**
   * Creates a repository-specific error.
   *
   * @param {string} message Error detail.
   * @return {Error} Repository error.
   */
  function createRepositoryError_(message) {
    const error = new Error(
      "Scripts repository error: " +
        message
    );

    error.name = "ScriptsRepositoryError";

    return error;
  }

  return {
    saveScript: saveScript,
    saveOrUpdateScript: saveOrUpdateScript,
    updateScript: updateScript,
    getScriptById: getScriptById,
    getScriptsByIdeaId: getScriptsByIdeaId,
    getLatestScriptByIdeaId:
      getLatestScriptByIdeaId,
    getAllScripts: getAllScripts,
    getScriptsByStatus: getScriptsByStatus,
    getScriptCount: getScriptCount,
    exists: exists,
    deleteScriptById: deleteScriptById,
    ensureSheet: ensureSheet,

    getHeaders: function () {
      return HEADERS.slice();
    },

    getRepositoryVersion: function () {
      return REPOSITORY_VERSION;
    }
  };
})();
