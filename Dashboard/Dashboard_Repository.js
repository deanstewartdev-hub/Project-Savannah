/****************************************************
 * Project Savannah v1.2
 * Dashboard_Repository.js
 *
 * Purpose:
 * Read raw dashboard data from Google Sheets.
 *
 * Responsibilities:
 * - Count records in pipeline sheets.
 * - Count records created today.
 * - Read cost totals.
 * - Read recent activity.
 *
 * Must not:
 * - Format values for the frontend.
 * - Build UI models.
 * - Contain presentation logic.
 ****************************************************/

const DashboardRepository = (() => {
  const HEADER_ROW_COUNT = 1;
  const DEFAULT_ACTIVITY_LIMIT = 5;

  /**
   * Returns all raw data needed by the dashboard service.
   *
   * @return {Object} Raw dashboard data.
   */
  function getDashboardData() {
    const spreadsheet = getDashboardSpreadsheet_();

    const ideasSheet = spreadsheet.getSheetByName("Ideas");
    const scriptsSheet = spreadsheet.getSheetByName("Scripts");
    const seoSheet = spreadsheet.getSheetByName("SEO Pack");
    const approvalSheet =
      spreadsheet.getSheetByName("Approval Queue");
    const costsSheet = spreadsheet.getSheetByName("Costs");
    const logsSheet = spreadsheet.getSheetByName("Logs");
    const renderJobsSheet =
      spreadsheet.getSheetByName("Render Jobs");
    const publishingJobsSheet =
      spreadsheet.getSheetByName("Publishing Jobs");

    return {
      totals: {
        ideas: countDataRows_(ideasSheet),
        scripts: countDataRows_(scriptsSheet),
        seoPacks: countDataRows_(seoSheet),
        approvalQueue: countDataRows_(approvalSheet),
        costRecords: countDataRows_(costsSheet),
        logRecords: countDataRows_(logsSheet),
        renders: countDataRows_(renderJobsSheet),
        published: countDataRows_(publishingJobsSheet)
      },

      today: {
        ideas: countRowsCreatedToday_(
          ideasSheet,
          2
        ),

        scripts: countRowsCreatedToday_(
          scriptsSheet,
          3
        ),

        seoPacks: countRowsCreatedToday_(
          seoSheet,
          3
        )
      },

      totalCost: readTotalCost_(costsSheet),

      recentActivity: readRecentActivity_(
        logsSheet,
        DEFAULT_ACTIVITY_LIMIT
      )
    };
  }

  /**
   * Returns the spreadsheet used as Savannah's database.
   *
   * @return {GoogleAppsScript.Spreadsheet.Spreadsheet}
   */
  function getDashboardSpreadsheet_() {
    const spreadsheet =
      SpreadsheetApp.getActiveSpreadsheet();

    if (!spreadsheet) {
      throw new Error(
        "Project Savannah could not access its Google Sheets database."
      );
    }

    return spreadsheet;
  }

  /**
   * Counts non-header rows in a sheet.
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet|null} sheet
   * @return {number} Number of data rows.
   */
  function countDataRows_(sheet) {
    if (!sheet) {
      return 0;
    }

    return Math.max(
      sheet.getLastRow() - HEADER_ROW_COUNT,
      0
    );
  }

  /**
   * Counts records whose date column is today.
   *
   * Ideas uses column B.
   * Scripts and SEO Pack use column C.
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet|null} sheet
   * @param {number} dateColumn One-based date column number.
   * @return {number} Number of records created today.
   */
  function countRowsCreatedToday_(sheet, dateColumn) {
    if (!sheet || sheet.getLastRow() <= HEADER_ROW_COUNT) {
      return 0;
    }

    const rowCount =
      sheet.getLastRow() - HEADER_ROW_COUNT;

    const values = sheet
      .getRange(
        HEADER_ROW_COUNT + 1,
        dateColumn,
        rowCount,
        1
      )
      .getValues();

    const today = normaliseDate_(new Date());

    return values.reduce(function (count, row) {
      const value = row[0];

      if (!(value instanceof Date)) {
        return count;
      }

      return normaliseDate_(value).getTime() ===
        today.getTime()
        ? count + 1
        : count;
    }, 0);
  }

  /**
   * Reads total estimated cost from column G of Costs.
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet|null} sheet
   * @return {number} Total estimated cost.
   */
  function readTotalCost_(sheet) {
    if (!sheet || sheet.getLastRow() <= HEADER_ROW_COUNT) {
      return 0;
    }

    const rowCount =
      sheet.getLastRow() - HEADER_ROW_COUNT;

    const values = sheet
      .getRange(
        HEADER_ROW_COUNT + 1,
        7,
        rowCount,
        1
      )
      .getValues();

    return values.reduce(function (total, row) {
      return total + (Number(row[0]) || 0);
    }, 0);
  }

  /**
   * Reads the newest log records.
   *
   * Expected Logs columns:
   * A Log ID
   * B Timestamp
   * C Run ID
   * D Action
   * E Status
   * F Message
   * G Error Details
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet|null} sheet
   * @param {number} limit Maximum records returned.
   * @return {Object[]} Recent activity records.
   */
  function readRecentActivity_(sheet, limit) {
    if (!sheet || sheet.getLastRow() <= HEADER_ROW_COUNT) {
      return [];
    }

    const availableRows =
      sheet.getLastRow() - HEADER_ROW_COUNT;

    const requestedLimit =
      Number(limit) > 0
        ? Math.floor(Number(limit))
        : DEFAULT_ACTIVITY_LIMIT;

    const rowCount = Math.min(
      availableRows,
      requestedLimit
    );

    const startRow =
      sheet.getLastRow() - rowCount + 1;

    const values = sheet
      .getRange(startRow, 1, rowCount, 7)
      .getValues()
      .reverse();

    return values.map(function (row) {
      return {
        logId: String(row[0] || ""),
        timestamp: serialiseDate_(row[1]),
        runId: String(row[2] || ""),
        action: String(row[3] || ""),
        status: String(row[4] || ""),
        message: String(row[5] || ""),
        errorDetails: String(row[6] || "")
      };
    });
  }

  /**
   * Removes the time portion of a date.
   *
   * @param {Date} date
   * @return {Date}
   */
  function normaliseDate_(date) {
    const normalised = new Date(date);
    normalised.setHours(0, 0, 0, 0);

    return normalised;
  }

  /**
   * Converts a sheet date into a frontend-safe ISO string.
   *
   * @param {*} value
   * @return {string}
   */
  function serialiseDate_(value) {
    if (!(value instanceof Date)) {
      return value ? String(value) : "";
    }

    return value.toISOString();
  }

  return {
    getDashboardData: getDashboardData
  };
})();

/**
 * Tests the complete dashboard repository.
 *
 * @return {Object} Raw repository data.
 */
function testDashboardRepository() {
  const result =
    DashboardRepository.getDashboardData();

  if (!result || !result.totals || !result.today) {
    throw new Error(
      "Dashboard repository returned an invalid result."
    );
  }

  Logger.log(
    JSON.stringify(result, null, 2)
  );

  Logger.log(
    "Dashboard repository test completed successfully."
  );

  return result;
}