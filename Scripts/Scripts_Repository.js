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

/**
 * Tests creation and verification of the Scripts sheet.
 *
 * @return {boolean} True when successful.
 */
function testScriptsRepositoryEnsuresSheet() {
  const sheet =
    ScriptsRepository.ensureSheet();

  const expectedHeaders =
    ScriptsRepository.getHeaders();

  const actualHeaders = sheet
    .getRange(
      1,
      1,
      1,
      expectedHeaders.length
    )
    .getDisplayValues()[0];

  if (
    JSON.stringify(actualHeaders) !==
    JSON.stringify(expectedHeaders)
  ) {
    throw new Error(
      "Scripts Repository created incorrect headers."
    );
  }

  Logger.log(
    "Scripts Repository sheet test completed successfully."
  );

  return true;
}

/**
 * Tests saving and retrieving a ScriptModel.
 *
 * @return {Object} Retrieved script.
 */
function testScriptsRepositorySaveAndRetrieve() {
  const fixture =
    createScriptsRepositoryFixture_();

  cleanupScriptsRepositoryTestRecord_(
    fixture.id
  );

  const saveResult =
    ScriptsRepository.saveScript(fixture);

  if (
    !saveResult.saved ||
    !saveResult.created
  ) {
    throw new Error(
      "Scripts Repository did not save the test script."
    );
  }

  const storedScript =
    ScriptsRepository.getScriptById(
      fixture.id
    );

  if (!storedScript) {
    throw new Error(
      "Scripts Repository could not retrieve the saved script."
    );
  }

  if (
    storedScript.title !== fixture.title ||
    storedScript.scenes.length !==
      fixture.scenes.length
  ) {
    throw new Error(
      "Scripts Repository returned incorrect script data."
    );
  }

  Logger.log(
    JSON.stringify(storedScript, null, 2)
  );

  cleanupScriptsRepositoryTestRecord_(
    fixture.id
  );

  Logger.log(
    "Scripts Repository save-and-retrieve test completed successfully."
  );

  return storedScript;
}

/**
 * Tests updating a stored ScriptModel.
 *
 * @return {Object} Updated stored script.
 */
function testScriptsRepositoryUpdate() {
  const fixture =
    createScriptsRepositoryFixture_();

  cleanupScriptsRepositoryTestRecord_(
    fixture.id
  );

  ScriptsRepository.saveScript(fixture);

  const updatedModel = ScriptModel.update(
    fixture,
    {
      title:
        "Updated Repository Test Script"
    }
  );

  const updateResult =
    ScriptsRepository.updateScript(
      updatedModel
    );

  if (
    !updateResult.updated ||
    updateResult.version !== 2
  ) {
    throw new Error(
      "Scripts Repository did not report a successful update."
    );
  }

  const storedScript =
    ScriptsRepository.getScriptById(
      fixture.id
    );

  if (
    storedScript.title !==
      "Updated Repository Test Script"
  ) {
    throw new Error(
      "Scripts Repository did not persist the updated title."
    );
  }

  if (storedScript.version !== 2) {
    throw new Error(
      "Scripts Repository did not persist the updated version."
    );
  }

  cleanupScriptsRepositoryTestRecord_(
    fixture.id
  );

  Logger.log(
    "Scripts Repository update test completed successfully."
  );

  return storedScript;
}

/**
 * Tests searching for scripts by idea ID.
 *
 * @return {boolean} True when successful.
 */
function testScriptsRepositoryFindsByIdeaId() {
  const fixture =
    createScriptsRepositoryFixture_();

  cleanupScriptsRepositoryTestRecord_(
    fixture.id
  );

  ScriptsRepository.saveScript(fixture);

  const matchingScripts =
    ScriptsRepository.getScriptsByIdeaId(
      fixture.ideaId
    );

  const found = matchingScripts.some(
    function (script) {
      return script.id === fixture.id;
    }
  );

  cleanupScriptsRepositoryTestRecord_(
    fixture.id
  );

  if (!found) {
    throw new Error(
      "Scripts Repository could not find a script by idea ID."
    );
  }

  Logger.log(
    "Scripts Repository idea search test completed successfully."
  );

  return true;
}

/**
 * Tests duplicate Script ID protection.
 *
 * @return {boolean} True when duplicate is rejected.
 */
function testScriptsRepositoryRejectsDuplicateId() {
  const fixture =
    createScriptsRepositoryFixture_();

  cleanupScriptsRepositoryTestRecord_(
    fixture.id
  );

  ScriptsRepository.saveScript(fixture);

  try {
    ScriptsRepository.saveScript(fixture);
  } catch (error) {
    cleanupScriptsRepositoryTestRecord_(
      fixture.id
    );

    if (
      error.name !==
      "ScriptsRepositoryError"
    ) {
      throw error;
    }

    Logger.log(error.message);
    Logger.log(
      "Scripts Repository duplicate test completed successfully."
    );

    return true;
  }

  cleanupScriptsRepositoryTestRecord_(
    fixture.id
  );

  throw new Error(
    "Scripts Repository accepted a duplicate script ID."
  );
}

/**
 * Runs every Scripts Repository test.
 *
 * Test records are removed after each test.
 *
 * @return {Object} Test summary.
 */
function testScriptsRepositoryAll() {
  testScriptsRepositoryEnsuresSheet();
  testScriptsRepositorySaveAndRetrieve();
  testScriptsRepositoryUpdate();
  testScriptsRepositoryFindsByIdeaId();
  testScriptsRepositoryRejectsDuplicateId();

  const result = {
    passed: true,
    testsRun: 5,
    repositoryVersion:
      ScriptsRepository.getRepositoryVersion()
  };

  Logger.log(JSON.stringify(result, null, 2));
  Logger.log(
    "All Scripts Repository tests completed successfully."
  );

  return result;
}

/**
 * Creates a complete repository test fixture.
 *
 * @return {Object} ScriptModel fixture.
 */
function createScriptsRepositoryFixture_() {
  const testId =
    "SCR-REPOSITORY-TEST";

  return ScriptModel.create({
    id: testId,
    ideaId: "IDEA-REPOSITORY-TEST",

    title:
      "Five Rome Mistakes Tourists Always Make",

    hook:
      "Visiting Rome? Avoid these common tourist mistakes.",

    voiceoverScript:
      "Visiting Rome? Avoid these common tourist mistakes. " +
      "Avoid restaurants beside the busiest attractions. " +
      "Walk several streets away and look for local customers. " +
      "Explore central Rome on foot instead of relying on taxis. " +
      "Dress appropriately before entering churches. " +
      "Slow down rather than rushing every landmark in one day. " +
      "Protect valuables in crowded stations and tourist areas. " +
      "Plan carefully and your Roman holiday will be much more enjoyable. " +
      "Follow for more practical travel advice.",

    scenes: [
      {
        sceneNumber: 1,
        narration:
          "Visiting Rome? Avoid these common tourist mistakes.",
        onScreenText:
          "Going to Rome?",
        visualDirection:
          "Aerial view of central Rome.",
        estimatedSeconds: 8
      },
      {
        sceneNumber: 2,
        narration:
          "Avoid tourist restaurants and explore the city on foot.",
        onScreenText:
          "Skip tourist traps",
        visualDirection:
          "Restaurant menu followed by a walking scene.",
        estimatedSeconds: 18
      },
      {
        sceneNumber: 3,
        narration:
          "Dress respectfully, slow down and protect your valuables.",
        onScreenText:
          "Slow down · Stay aware",
        visualDirection:
          "Church entrance followed by a crowded station.",
        estimatedSeconds: 19
      }
    ],

    callToAction:
      "Follow for more practical travel advice.",

    estimatedDurationSeconds: 45,
    generationNotes: "",

    status: "FORMATTED",

    validation: {
      valid: true
    },

    formatting: {
      valid: true,
      formatVersion:
        "scripts-format-v1.0"
    },

    metadata: {
      testRecord: true
    },

    displayText:
      "TITLE\nFive Rome Mistakes Tourists Always Make",

    promptVersion:
      "script-prompt-v1.0",

    aiModel:
      "repository-test-model"
  });
}

/**
 * Removes the repository test record when present.
 *
 * @param {string} scriptId Test Script ID.
 */
function cleanupScriptsRepositoryTestRecord_(
  scriptId
) {
  try {
    ScriptsRepository.deleteScriptById(
      scriptId
    );
  } catch (error) {
    Logger.log(
      "Repository test cleanup warning: " +
        error.message
    );
  }
}