/****************************************************
 * Project Savannah
 * Scripts_Repository_Rows.js
 *
 * Purpose:
 * Convert between a ScriptModel and one row of the Scripts sheet: JSON
 * cells, stored numbers and dates. Also holds the repository error type
 * and the identifier check both files use. The sheet schema (headers and
 * column numbers) stays in Scripts_Repository.js and is passed in.
 * Pure: reads and writes no sheet.
 *
 * Split out of Scripts/Scripts_Repository.js (modular refactor, November 2026). The function
 * bodies are unchanged. ScriptsRepository remains the public entry point; nothing outside
 * it should call this module directly.
 ****************************************************/

const ScriptsRepositoryRows = (() => {
  /**
   * Builds this module's helpers for one owner.
   *
   * @param {string} COLUMN Value supplied by ScriptsRepository.
   * @return {Object} Helpers.
   */
  function forColumns(COLUMN) {
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
      toRow: toRow_,
      rowToScript: rowToScript_,
      requireIdentifier: requireIdentifier_,
      createRepositoryError: createRepositoryError_
    };
  }

  return {
    forColumns: forColumns
  };
})();
