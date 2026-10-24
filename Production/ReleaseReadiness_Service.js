/****************************************************
 * Project Savannah v1.4 - release readiness preflight (READ-ONLY).
 *
 * Run diagnoseReleaseReadiness() from the Apps Script editor before and after
 * any deployment or callback-URL change. It never writes a property, sheet or
 * trigger, never calls a provider, and never returns or logs a secret value:
 * secrets are reported only as present/absent and well-formed or not.
 *
 * Levels: "block" = callbacks, renders or uploads will fail or be unsafe;
 * "warn" = works, but needs attention; "ok".
 ****************************************************/
const ReleaseReadinessService = (() => {
  // This code version ships appsscript.json with webapp.access = MYSELF
  // (asserted by node-tests/CallbackBridge_Tests.js SAV-15.1). The media worker
  // cannot sign in, so it can only deliver callbacks to the standalone bridge.
  const MAIN_APP_ACCESS = "MYSELF";
  const STALE_PENDING_MS = 60 * 60 * 1000;

  function run(env) {
    const e = env || defaultEnv_();
    const checks = [];
    function add(id, level, message) { checks.push({ id: id, level: level, message: message }); }

    const provider = String(e.property("VIDEO_PROVIDER") || "cloud-run").toLowerCase();
    add("video-provider", provider === "cloud-run" ? "ok" : "warn",
      "Video provider is '" + provider + "'." + (provider === "cloud-run" ? "" :
        " v1.4 releases on the Cloud Run media worker; Creatomate is the legacy fallback."));

    if (provider === "cloud-run") {
      const workerUrl = String(e.property("MEDIA_WORKER_URL") || "");
      add("media-worker-url", /^https:\/\/\S+$/.test(workerUrl) ? "ok" : "block",
        workerUrl ? "Media worker URL is set (" + host_(workerUrl) + ")." + (/^https:\/\//.test(workerUrl) ? "" : " It must use https.") :
          "MEDIA_WORKER_URL is not set; renders cannot be submitted.");
      secret_(add, e, "MEDIA_WORKER_JOB_SUBMIT_SECRET", "Job submission secret");
      secret_(add, e, "MEDIA_WORKER_SHARED_SECRET", "Callback shared secret");
      callback_(add, e);
    }

    inbox_(add, e);
    queue_(add, e);

    const blocked = checks.some(function (c) { return c.level === "block"; });
    const warned = checks.some(function (c) { return c.level === "warn"; });
    return { status: blocked ? "BLOCKED" : warned ? "WARNINGS" : "READY", checkedAt: new Date(e.now()).toISOString(), checks: checks };
  }

  function secret_(add, e, name, label) {
    const value = e.property(name);
    if (!value) { add(name, "block", label + " (" + name + ") is not set."); return; }
    // A trailing CR/LF in a secret broke a real render in August 2026 (RND-9EDA317F).
    const clean = value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
    add(name, clean ? "ok" : "block", label + " is set" +
      (clean ? "." : " but contains leading/trailing whitespace or control characters; re-enter it."));
  }

  function callback_(add, e) {
    const callbackUrl = String(e.property("MEDIA_WORKER_CALLBACK_URL") || "");
    if (!callbackUrl) {
      add("callback-url", "block", "MEDIA_WORKER_CALLBACK_URL is not set; Cloud Run jobs cannot report back.");
      return;
    }
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/?#]+\/exec$/.test(callbackUrl)) {
      add("callback-url", "block", "MEDIA_WORKER_CALLBACK_URL is not a bare https://script.google.com/macros/s/<id>/exec URL.");
      return;
    }
    const ownUrl = String(e.ownWebAppUrl() || "").replace(/\/$/, "");
    if (!ownUrl || /\/dev$/.test(ownUrl)) {
      // From the editor getUrl() returns the /dev URL, whose deployment ID never
      // equals the production /exec one, so a comparison here would falsely pass.
      add("callback-url", "warn", "Callback URL is set, but this check is not running inside the deployed app, so it " +
        "cannot confirm the callback targets the bridge rather than this app. Run it from Settings → Release readiness.");
    } else if (deploymentId_(ownUrl) && deploymentId_(ownUrl) === deploymentId_(callbackUrl)) {
      add("callback-url", "block", "Callbacks target this main app, which this code version deploys with access " +
        MAIN_APP_ACCESS + ". The worker cannot sign in, so every callback will be rejected. Point " +
        "MEDIA_WORKER_CALLBACK_URL at the standalone callback bridge first (see CALLBACK_INBOX_STAGING.md).");
    } else {
      add("callback-url", "ok", "Callbacks target a separate deployment (expected: the callback bridge, ..." +
        deploymentId_(callbackUrl).slice(-6) + ").");
    }
  }

  function inbox_(add, e) {
    let report;
    try { report = e.inboxReport(); } catch (caught) {
      add("callback-inbox", "block", "Callback inbox could not be read: " + String(caught && caught.message || caught));
      return;
    }
    add("spreadsheet", "ok", "Main app spreadsheet ends ..." + String(report.spreadsheetId || "").slice(-6) +
      ". The bridge's RENDER_JOBS_SPREADSHEET_ID must end the same.");
    if (!report.inboxSheetPresent) {
      add("callback-inbox", "warn", "No 'Render Callback Inbox' tab yet. It is created by the bridge's first receipt; " +
        "if callbacks have already been sent, the bridge is writing to a different spreadsheet.");
      return;
    }
    if (report.headersMatch !== true) {
      add("callback-inbox", "block", "'Render Callback Inbox' headers do not match; receipts will not be processed.");
      return;
    }
    const oldest = Date.parse(report.oldestPendingReceivedAt || "");
    const stale = report.pending && isFinite(oldest) && e.now() - oldest > STALE_PENDING_MS;
    const level = report.pendingWithErrors || stale ? "warn" : "ok";
    add("callback-inbox", level, report.pending + " pending receipt(s)" +
      (report.pendingWithErrors ? ", " + report.pendingWithErrors + " failing" : "") +
      (stale ? ", oldest pending since " + report.oldestPendingReceivedAt + " (open Production or run drainCallbackInboxNow)" : "") + ".");
  }

  function queue_(add, e) {
    const enabled = e.property("PRODUCTION_QUEUE_ENABLED") === "true";
    let triggers = null;
    try { triggers = e.queueTriggerCount(); } catch (ignored) { triggers = null; }
    if (triggers === null) {
      add("queue-trigger", enabled ? "warn" : "ok", enabled ?
        "Background automation is marked enabled, but its trigger cannot be checked (the script.scriptapp scope is not authorised)." :
        "Background automation is off. Callbacks are processed when Production is opened. Enabling it needs the script.scriptapp scope (APPROVALS_REQUIRED.md).");
    } else if (enabled && triggers === 0) {
      add("queue-trigger", "warn", "Background automation is marked enabled but no processProductionQueue trigger exists. Turn it off and on again in Production.");
    } else if (!enabled && triggers > 0) {
      add("queue-trigger", "warn", "A processProductionQueue trigger exists while automation is marked off.");
    } else {
      add("queue-trigger", "ok", enabled ? "Background automation trigger is installed." : "Background automation is off.");
    }
  }

  function deploymentId_(url) {
    const match = /\/macros\/s\/([^/?#]+)\//.exec(String(url || ""));
    return match ? match[1] : "";
  }

  function host_(url) {
    const match = /^https?:\/\/([^/?#]+)/.exec(String(url || ""));
    return match ? match[1] : "unparseable";
  }

  function defaultEnv_() {
    const properties = PropertiesService.getScriptProperties();
    return {
      property: function (name) { return properties.getProperty(name); },
      ownWebAppUrl: function () { try { return ScriptApp.getService().getUrl(); } catch (ignored) { return ""; } },
      inboxReport: function () { return diagnoseCallbackInbox(); },
      queueTriggerCount: function () {
        return ScriptApp.getProjectTriggers().filter(function (trigger) {
          return trigger.getHandlerFunction() === "processProductionQueue";
        }).length;
      },
      now: function () { return Date.now(); }
    };
  }

  return { run: run };
})();

/**
 * Owner preflight, run from the Apps Script editor. READ-ONLY.
 * See RELEASE_READINESS.md and CALLBACK_INBOX_STAGING.md.
 */
function diagnoseReleaseReadiness() {
  const report = ReleaseReadinessService.run();
  Logger.log(report.status + "\n" + report.checks.map(function (check) {
    return "[" + check.level.toUpperCase() + "] " + check.id + ": " + check.message;
  }).join("\n"));
  return report;
}
