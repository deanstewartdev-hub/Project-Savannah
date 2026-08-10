/****************************************************
 * Project Savannah v1.3 - notification controller.
 ****************************************************/
const NotificationController = (() => {
  function getFeed() { return run_("Notifications loaded.", function () { return NotificationService.listRecent({ limit: 20 }); }); }
  function markAllRead() { return run_("Notifications marked as read.", function () { return NotificationService.markAllRead(); }); }
  function run_(message, callback) {
    const requestId = "REQ-" + Utilities.getUuid().slice(0, 8).toUpperCase();
    try {
      return { success: true, statusCode: 200, requestId: requestId, message: message,
        data: JSON.parse(JSON.stringify(callback() || {})) };
    } catch (error) {
      try { LoggingService.failure(requestId, "NOTIFICATIONS", message, error); } catch (ignored) {}
      const safe = String(error && error.message || "Notification monitoring is temporarily unavailable.")
        .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]")
        .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]").slice(0, 240);
      return { success: false, statusCode: 500, requestId: requestId, message: "Notifications could not be loaded.",
        data: null, error: { code: error && error.name || "NOTIFICATION_ERROR",
          message: safe } };
    }
  }
  return { getFeed: getFeed, markAllRead: markAllRead };
})();

function notificationsGetFeed() { return NotificationController.getFeed(); }
function notificationsMarkAllRead() { return NotificationController.markAllRead(); }
