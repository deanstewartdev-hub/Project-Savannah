/****************************************************
 * Project Savannah v1.4 - production health findings.
 *
 * Pure and read-only. Derives operator-visible findings from Render Jobs and
 * Publishing Jobs. NotificationService only sees problems that logged a failure; this
 * covers states that are stuck or uncertain without ever logging one.
 *
 * It never writes, never calls a provider, and never decides to re-render or
 * re-upload. Every finding says what to check and what NOT to do, because the costly
 * mistakes here are a paid re-render of a video that already exists and a second copy
 * of a video on YouTube.
 *
 * Age is measured from createdAt, never updatedAt: polling rewrites updatedAt, so it
 * would hide a job that is stuck while still being polled.
 ****************************************************/
const ProductionHealthService = (() => {
  const ACTIVE_RENDER = ["QUEUED", "PLANNED", "RENDERING"];
  const THRESHOLDS = Object.freeze({
    renderStuckWarningMs: 45 * 60 * 1000,
    renderStuckCriticalMs: 3 * 60 * 60 * 1000,
    // A web app execution is capped at 6 minutes, so a longer UPLOADING row has lost its worker.
    uploadStuckWarningMs: 10 * 60 * 1000
  });
  const MAX_FINDINGS = 50;
  const SEVERITY_RANK = { critical: 0, warning: 1 };

  function evaluate(input) {
    const source = input || {};
    const nowMs = timeMs_(source.now) || Date.now();
    const renders = array_(source.renderJobs), uploads = array_(source.publishingJobs);
    const findings = [];

    renders.forEach(function (job) { renderFindings_(job, nowMs).forEach(function (item) { findings.push(item); }); });
    uploads.forEach(function (job) { uploadFindings_(job, nowMs).forEach(function (item) { findings.push(item); }); });
    duplicateUploadFindings_(uploads).forEach(function (item) { findings.push(item); });

    findings.sort(function (a, b) {
      return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.sinceMs - b.sinceMs;
    });
    const total = findings.length;
    const shown = findings.slice(0, MAX_FINDINGS).map(function (item) {
      const copy = Object.assign({}, item);
      delete copy.sinceMs;
      return copy;
    });
    const critical = findings.filter(function (item) { return item.severity === "critical"; }).length;
    return {
      status: critical ? "critical" : (total ? "attention" : "ok"),
      generatedAt: new Date(nowMs).toISOString(),
      counts: { critical: critical, warning: total - critical, total: total },
      truncated: Math.max(0, total - shown.length),
      findings: shown
    };
  }

  function renderFindings_(job, nowMs) {
    if (!job || !job.id) return [];
    const status = String(job.status || "").toUpperCase();
    const createdMs = timeMs_(job.createdAt);
    const subject = { renderJobId: job.id, scriptId: job.scriptId || "" };
    const delivered = status === "SUCCEEDED" && !!String(job.videoUrl || "").trim();
    const out = [];

    // A finished or failed external execution with an artifact but no delivered callback.
    // Re-rendering here would pay for a video that already exists.
    if (!delivered && reconciliationReason_(job) === "DELIVERY_RECOVERY_REQUIRED") {
      out.push(finding_("RENDER_DELIVERY_RECOVERY_REQUIRED", "critical", subject, createdMs,
        "Render finished but was not delivered",
        "The worker produced a video, but Savannah never received it.",
        "Do not re-render. Ask the owner to run the delivery-recovery tool (media-worker recover-delivery) for this render ID, then Refresh status.",
        { doNotRerender: true, doNotUploadAgain: false }));
      return out;
    }
    if (status === "SUCCEEDED" && !delivered) {
      out.push(finding_("RENDER_SUCCEEDED_WITHOUT_VIDEO", "critical", subject, createdMs,
        "Render marked complete but has no video",
        "The render is SUCCEEDED but has no video URL, so it cannot be reviewed or uploaded.",
        "Press Refresh status. Do not re-render until the render artifact has been checked.",
        { doNotRerender: true, doNotUploadAgain: false }));
      return out;
    }
    if (ACTIVE_RENDER.indexOf(status) !== -1 && createdMs) {
      const age = nowMs - createdMs;
      if (age >= THRESHOLDS.renderStuckWarningMs) {
        const critical = age >= THRESHOLDS.renderStuckCriticalMs;
        out.push(finding_("RENDER_STUCK_ACTIVE", critical ? "critical" : "warning", subject, createdMs,
          critical ? "Render has been active for hours" : "Render is taking longer than expected",
          "This render has been active for " + minutes_(age) + " minutes without finishing.",
          "Press Refresh status. An active render may still finish and deliver, so do not re-render until its status says FAILED.",
          { doNotRerender: true, doNotUploadAgain: false }));
      }
    }
    return out;
  }

  function uploadFindings_(job, nowMs) {
    if (!job || !job.id) return [];
    const status = String(job.status || "").toUpperCase();
    const createdMs = timeMs_(job.createdAt);
    const subject = { publishingJobId: job.id, renderJobId: job.renderJobId || "", scriptId: job.scriptId || "" };
    const both = { doNotRerender: true, doNotUploadAgain: true };

    if (status === "RECONCILE") {
      return [finding_("UPLOAD_UNCERTAIN", "critical", subject, createdMs,
        "YouTube upload is uncertain",
        "Savannah cannot tell whether this video reached YouTube.",
        "Check YouTube Studio for this title. Use Find existing YouTube upload; only confirm no upload if Studio shows nothing. Do not re-render or upload again until this is resolved.",
        both)];
    }
    if (status === "UPLOADING" && createdMs && nowMs - createdMs >= THRESHOLDS.uploadStuckWarningMs) {
      return [finding_("UPLOAD_STUCK_UPLOADING", "warning", subject, createdMs,
        "YouTube upload appears to have stopped",
        "This upload has been in progress for " + minutes_(nowMs - createdMs) + " minutes, longer than one execution can run.",
        "Check YouTube Studio first. Savannah will mark it uncertain automatically. Do not upload again.",
        both)];
    }
    if (status === "FAILED" && hasVideoEvidence_(job)) {
      return [finding_("UPLOAD_FAILED_WITH_VIDEO_EVIDENCE", "critical", subject, createdMs,
        "Failed upload still points at a YouTube video",
        "This attempt failed, but it recorded a YouTube video ID, so the video may exist.",
        "Verify in YouTube Studio, then reconcile this attempt. Do not re-render or upload again until then.",
        both)];
    }
    return [];
  }

  // Two different YouTube videos recorded for one script means a duplicate already happened.
  function duplicateUploadFindings_(uploads) {
    const byScript = {};
    uploads.forEach(function (job) {
      const videoId = job && String(job.youtubeVideoId || "").trim();
      const scriptId = job && String(job.scriptId || "").trim();
      if (!videoId || !scriptId) return;
      (byScript[scriptId] = byScript[scriptId] || {})[videoId] = timeMs_(job.createdAt);
    });
    return Object.keys(byScript).filter(function (scriptId) {
      return Object.keys(byScript[scriptId]).length > 1;
    }).map(function (scriptId) {
      const ids = Object.keys(byScript[scriptId]);
      const first = Math.min.apply(null, ids.map(function (id) { return byScript[scriptId][id] || Infinity; }));
      return finding_("DUPLICATE_YOUTUBE_UPLOADS", "critical", { scriptId: scriptId }, isFinite(first) ? first : 0,
        "The same script is on YouTube more than once",
        "Script " + scriptId + " has " + ids.length + " different YouTube videos recorded: " + ids.join(", ") + ".",
        "Review them in YouTube Studio and remove the unwanted copy there. Savannah has not deleted anything. Do not upload again.",
        { doNotRerender: true, doNotUploadAgain: true });
    });
  }

  function finding_(code, severity, subject, sinceMs, title, message, recovery, flags) {
    return {
      code: code, severity: severity, subject: subject, title: title, message: message,
      recovery: recovery, doNotRerender: !!flags.doNotRerender, doNotUploadAgain: !!flags.doNotUploadAgain,
      since: sinceMs ? new Date(sinceMs).toISOString() : "", sinceMs: sinceMs || 0
    };
  }

  function reconciliationReason_(job) {
    return (job && job.providerResponse && job.providerResponse.reconciliation &&
      job.providerResponse.reconciliation.reason) || "";
  }
  function hasVideoEvidence_(job) {
    return !!(String(job.youtubeVideoId || "").trim() || String(job.youtubeUrl || "").trim());
  }
  function minutes_(ms) { return Math.round(ms / 60000); }
  function array_(value) { return Array.isArray(value) ? value : []; }
  function timeMs_(value) {
    if (typeof value === "number") return isFinite(value) ? value : 0;
    const time = value ? new Date(value).getTime() : 0;
    return isFinite(time) ? time : 0;
  }

  return { evaluate: evaluate, thresholds: THRESHOLDS };
})();
