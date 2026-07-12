/****************************************************
 * Project Savannah v1.2
 * DashboardController.js
 *
 * Purpose:
 * Expose dashboard application operations to the
 * Project Savannah frontend.
 *
 * Responsibilities:
 * - Call DashboardService.
 * - Return predictable application responses.
 * - Log controller failures.
 *
 * Must not:
 * - Read Google Sheets directly.
 * - Build dashboard business rules.
 * - Render HTML.
 ****************************************************/

/**
 * Returns the live dashboard model to the web application.
 *
 * This function is called from the browser using:
 * google.script.run.getDashboardDataForApp()
 *
 * @return {Object} Application response.
 */
function getDashboardDataForApp() {
  try {
    const dashboardModel =
      DashboardService.getDashboardModel();

    return createDashboardControllerResponse_(
      true,
      dashboardModel,
      ""
    );
  } catch (error) {
    const safeMessage =
      "Project Savannah could not load the dashboard data.";

    Logger.log(
      "Dashboard controller error: " +
      getDashboardControllerErrorMessage_(error)
    );

    return createDashboardControllerResponse_(
      false,
      null,
      safeMessage
    );
  }
}

/**
 * Creates a predictable response for the frontend.
 *
 * @param {boolean} success Whether the operation succeeded.
 * @param {Object|null} data Dashboard data.
 * @param {string} errorMessage Safe frontend error message.
 * @return {Object} Controller response.
 */
function createDashboardControllerResponse_(
  success,
  data,
  errorMessage
) {
  return {
    success: Boolean(success),
    data: data || null,
    error: errorMessage || "",
    timestamp: new Date().toISOString()
  };
}

/**
 * Extracts a useful error message for server-side logging.
 *
 * @param {*} error Caught error value.
 * @return {string} Error message.
 */
function getDashboardControllerErrorMessage_(error) {
  if (!error) {
    return "Unknown dashboard controller error.";
  }

  if (error.message) {
    return String(error.message);
  }

  return String(error);
}

/**
 * Tests the complete dashboard application stack.
 *
 * Repository → Service → Controller
 *
 * @return {Object} Controller response.
 */
function testDashboardController() {
  const response = getDashboardDataForApp();

  if (!response || response.success !== true) {
    throw new Error(
      response && response.error
        ? response.error
        : "Dashboard controller test failed."
    );
  }

  if (
    !response.data ||
    !response.data.kpis ||
    !Array.isArray(response.data.pipeline) ||
    !Array.isArray(response.data.recentActivity)
  ) {
    throw new Error(
      "Dashboard controller returned an invalid data model."
    );
  }

  Logger.log(
    JSON.stringify(response, null, 2)
  );

  Logger.log(
    "Dashboard controller test completed successfully."
  );

  return response;
}