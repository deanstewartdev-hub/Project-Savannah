/****************************************************
 * Project Savannah v1.3 - analytics controller.
 ****************************************************/
const AnalyticsController = (() => {
  function getDashboard() { return run_("Analytics loaded.", function () { return YouTubeAnalyticsService.summary(); }); }
  function refresh() {
    return run_("YouTube metrics refreshed.", function () {
      return { capture: YouTubeAnalyticsService.capture(), summary: YouTubeAnalyticsService.summary() };
    });
  }
  function run_(message, callback) {
    const requestId = "REQ-" + Utilities.getUuid().slice(0, 8).toUpperCase();
    try {
      return { success: true, statusCode: 200, requestId: requestId, message: message,
        data: JSON.parse(JSON.stringify(callback() || {})) };
    } catch (error) {
      const safe = String(error && error.message || "Analytics request failed.").slice(0, 500);
      try { LoggingService.failure(requestId, "ANALYTICS", message, error); } catch (ignored) {}
      return { success: false, statusCode: 400, requestId: requestId, message: "Analytics request failed.",
        data: null, error: { code: error && error.name || "ANALYTICS_ERROR", message: safe } };
    }
  }
  return { getDashboard: getDashboard, refresh: refresh };
})();

function analyticsGetDashboard() { return AnalyticsController.getDashboard(); }
function analyticsRefresh() { return AnalyticsController.refresh(); }
