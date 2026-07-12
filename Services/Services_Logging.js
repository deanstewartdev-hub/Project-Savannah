/****************************************************
 * Project Savannah v1.2
 * Services_Logging.js
 *
 * Purpose:
 * Persist application activity and errors.
 *
 * Responsibilities:
 * - Write structured records to the Logs sheet.
 * - Provide consistent status and action values.
 * - Prevent logging failures from hiding the original error.
 *
 * Must not:
 * - Display UI messages.
 * - Contain workflow business logic.
 * - Calculate AI costs.
 ****************************************************/

const LoggingService = (() => {
  const LOG_STATUS = Object.freeze({
    STARTED: "Started",
    SUCCESS: "Success",
    WARNING: "Warning",
    FAILED: "Failed"
  });

  /**
   * Writes one structured record to the Logs sheet.
   *
   * Expected columns:
   * A Log ID
   * B Timestamp
   * C Run ID
   * D Action
   * E Status
   * F Message
   * G Error Details
   *
   * @param {Object} logEntry Log data.
   * @return {Object} Saved log record.
   */
  function log(logEntry) {
    const entry = logEntry || {};
    const sheet = getLogsSheet_();

    const record = {
      logId: createLogId_(),
      timestamp: new Date(),
      runId: String(entry.runId || ""),
      action: String(entry.action || "UNKNOWN_ACTION"),
      status: String(entry.status || LOG_STATUS.SUCCESS),
      message: String(entry.message || ""),
      errorDetails: normaliseErrorDetails_(
        entry.errorDetails
      )
    };

    sheet.appendRow([
      record.logId,
      record.timestamp,
      record.runId,
      record.action,
      record.status,
      record.message,
      record.errorDetails
    ]);

    return record;
  }

  /**
   * Logs a started workflow.
   *
   * @param {string} runId Workflow run identifier.
   * @param {string} action Workflow action.
   * @param {string} message Description.
   * @return {Object} Saved log record.
   */
  function started(runId, action, message) {
    return log({
      runId: runId,
      action: action,
      status: LOG_STATUS.STARTED,
      message: message
    });
  }

  /**
   * Logs a successful workflow.
   *
   * @param {string} runId Workflow run identifier.
   * @param {string} action Workflow action.
   * @param {string} message Description.
   * @return {Object} Saved log record.
   */
  function success(runId, action, message) {
    return log({
      runId: runId,
      action: action,
      status: LOG_STATUS.SUCCESS,
      message: message
    });
  }

  /**
   * Logs a failed workflow.
   *
   * @param {string} runId Workflow run identifier.
   * @param {string} action Workflow action.
   * @param {string} message Safe description.
   * @param {*} error Original error.
   * @return {Object} Saved log record.
   */
  function failure(
    runId,
    action,
    message,
    error
  ) {
    return log({
      runId: runId,
      action: action,
      status: LOG_STATUS.FAILED,
      message: message,
      errorDetails: error
    });
  }

  /**
   * Returns the Logs sheet.
   *
   * @return {GoogleAppsScript.Spreadsheet.Sheet}
   */
  function getLogsSheet_() {
    const spreadsheet =
      SpreadsheetApp.getActiveSpreadsheet();

    if (!spreadsheet) {
      throw new Error(
        "Project Savannah could not access its spreadsheet."
      );
    }

    const sheet =
      spreadsheet.getSheetByName(SHEETS.LOGS);

    if (!sheet) {
      throw new Error(
        "Logs sheet was not found."
      );
    }

    return sheet;
  }

  /**
   * Generates a log identifier.
   *
   * @return {string}
   */
  function createLogId_() {
    return (
      "LOG-" +
      Utilities.getUuid()
        .slice(0, 8)
        .toUpperCase()
    );
  }

  /**
   * Converts error details into safe sheet text.
   *
   * @param {*} errorDetails Error value.
   * @return {string}
   */
  function normaliseErrorDetails_(
    errorDetails
  ) {
    if (!errorDetails) {
      return "";
    }

    if (errorDetails.stack) {
      return String(errorDetails.stack);
    }

    if (errorDetails.message) {
      return String(errorDetails.message);
    }

    if (typeof errorDetails === "object") {
      try {
        return JSON.stringify(errorDetails);
      } catch (error) {
        return String(errorDetails);
      }
    }

    return String(errorDetails);
  }

  return {
    STATUS: LOG_STATUS,
    log: log,
    started: started,
    success: success,
    failure: failure
  };
})();

/**
 * Tests the logging service.
 *
 * This creates one real test row in the Logs sheet.
 *
 * @return {Object} Saved log record.
 */
function testLoggingService() {
  const testRunId =
    "TEST-RUN-" +
    Utilities.getUuid()
      .slice(0, 6)
      .toUpperCase();

  const record = LoggingService.success(
    testRunId,
    "TEST_LOGGING",
    "Logging service test completed successfully."
  );

  if (!record || !record.logId) {
    throw new Error(
      "Logging service did not return a saved record."
    );
  }

  Logger.log(
    JSON.stringify(record, null, 2)
  );

  Logger.log(
    "Logging service test completed successfully."
  );

  return record;
}