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
    uploadStuckWarningMs: 10 * 60 * 1000,
    // A delivery normally matches its render within seconds; allow for a slow submit.
    unmatchedDeliveryMs: 15 * 60 * 1000,
    // Warn two days ahead so there is time to renew the link before review/upload.
    videoLinkWarningMs: 48 * 60 * 60 * 1000,
    // A Cloud Run render still QUEUED this long after submission never got the worker's confirmation.
    submissionUnconfirmedMs: 5 * 60 * 1000,
    // The queue settles a task stuck in SUBMITTING after this (an execution lasts at most 6 minutes).
    taskSubmittingWarningMs: 10 * 60 * 1000,
    taskSubmittingCriticalMs: 60 * 60 * 1000,
    // Failed tasks older than this are history, not something to act on.
    taskFailedWindowMs: 7 * 24 * 60 * 60 * 1000,
    // Mirrors ProductionController: interrupted attempts at one scene before a task stops.
    taskMaxInterruptedAttempts: 3
  });
  const MAX_FINDINGS = 50;
  const SEVERITY_RANK = { critical: 0, warning: 1 };

  function evaluate(input) {
    const source = input || {};
    const nowMs = timeMs_(source.now) || Date.now();
    const renders = array_(source.renderJobs), uploads = array_(source.publishingJobs);
    const findings = [];

    const onYouTube = {};
    uploads.forEach(function (job) {
      if (job && ["PUBLISHED", "UPLOADING", "RECONCILE"].indexOf(String(job.status || "").toUpperCase()) !== -1) onYouTube[job.renderJobId] = true;
    });
    renders.forEach(function (job) { renderFindings_(job, nowMs, onYouTube).forEach(function (item) { findings.push(item); }); });
    uploads.forEach(function (job) { uploadFindings_(job, nowMs).forEach(function (item) { findings.push(item); }); });
    duplicateUploadFindings_(uploads).forEach(function (item) { findings.push(item); });
    unmatchedDeliveryFindings_(array_(source.callbackReceipts), renders, nowMs).forEach(function (item) { findings.push(item); });
    taskFindings_(array_(source.productionTasks), renders, nowMs).forEach(function (item) { findings.push(item); });

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

  function renderFindings_(job, nowMs, onYouTube) {
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
    // Signed video links expire (7 days at most). An expired link blocks review and
    // upload, and the tempting wrong fix is a paid re-render of a video that exists.
    if (delivered && !(onYouTube && onYouTube[job.id]) && typeof VideoLinkService !== "undefined") {
      const expiry = VideoLinkService.expiresAt(job.videoUrl);
      if (expiry !== null && expiry - nowMs < THRESHOLDS.videoLinkWarningMs) {
        const expired = expiry <= nowMs;
        out.push(finding_(expired ? "RENDER_VIDEO_LINK_EXPIRED" : "RENDER_VIDEO_LINK_EXPIRING", "warning", subject, createdMs,
          expired ? "Video link has expired" : "Video link expires soon",
          "This render's download link " + (expired ? "expired on " : "expires on ") + new Date(expiry).toISOString() +
            ". It cannot be viewed or uploaded " + (expired ? "until it is renewed." : "after that."),
          "Do not re-render: the video still exists. Ask the owner to run delivery recovery (media-worker recover-delivery) for this render ID to renew the link.",
          { doNotRerender: true, doNotUploadAgain: false }));
      }
    }
    // A Cloud Run render is saved QUEUED under its reserved ID before the worker is asked to start,
    // and becomes RENDERING with the worker's execution details once the worker confirms. Still
    // QUEUED after a few minutes means the confirmation never arrived: the worker may be rendering
    // (and billing) this video. Re-rendering would pay for it twice.
    if (status === "QUEUED" && /^cr-/i.test(String(job.renderId || "")) && createdMs && !hasExecution_(job) &&
        nowMs - createdMs >= THRESHOLDS.submissionUnconfirmedMs) {
      const age = nowMs - createdMs;
      out.push(finding_("RENDER_SUBMISSION_UNCONFIRMED", age >= THRESHOLDS.renderStuckCriticalMs ? "critical" : "warning",
        subject, createdMs,
        "The media worker never confirmed this render",
        "This render was submitted " + minutes_(age) + " minutes ago but the worker has not confirmed it. It may still be running and may still deliver.",
        "Do not re-render. Savannah is keeping this render and will reconcile it, or apply its callback if the video arrives. Press Refresh status; if it is still unconfirmed after several hours, ask the owner to check the Cloud Run execution for this render ID.",
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

  // A completed delivery whose render ID matches no render job: usually a submission
  // interrupted after the worker accepted it. That render is then marked FAILED with a
  // re-render option, which would pay for a video that already exists.
  function unmatchedDeliveryFindings_(receipts, renders, nowMs) {
    const known = {};
    renders.forEach(function (job) { if (job && job.renderId) known[String(job.renderId)] = true; });
    const seen = {};
    const out = [];
    receipts.forEach(function (receipt) {
      const renderId = String(receipt && receipt.renderId || "");
      if (!renderId || receipt.status !== "completed" || known[renderId] || seen[renderId]) return;
      if (/^REJECTED/.test(String(receipt.result || ""))) return;
      const receivedMs = timeMs_(receipt.receivedAt);
      if (!receivedMs || nowMs - receivedMs < THRESHOLDS.unmatchedDeliveryMs) return;
      seen[renderId] = true;
      out.push(finding_("RENDER_DELIVERY_UNMATCHED", "critical", { renderId: renderId }, receivedMs,
        "A finished video arrived for an unknown render",
        "The worker delivered a video for render ID " + renderId + ", but no render job has that ID. This usually " +
          "means a render submission was interrupted after the worker had already accepted it.",
        "Do not re-render the interrupted (FAILED) render from around " + new Date(receivedMs).toISOString() +
          " yet: this video already exists. Open the 'Render Callback Inbox' tab, find this render ID and follow 'Unmatched delivery' in LIVE_ACCEPTANCE.md.",
        { doNotRerender: true, doNotUploadAgain: false }));
    });
    return out;
  }

  // Background queue tasks (read-only; the queue itself settles state, this only reports it).
  function taskFindings_(tasks, renders, nowMs) {
    const renderIds = {};
    renders.forEach(function (job) { if (job && job.id) renderIds[job.id] = true; });
    const out = [];
    tasks.forEach(function (task) {
      if (!task || !task.id) return;
      const status = String(task.status || "").toUpperCase();
      const updatedMs = timeMs_(task.updatedAt);
      const subject = { taskId: task.id, scriptId: task.scriptId || "" };
      if (status === "SUBMITTING" && updatedMs && nowMs - updatedMs >= THRESHOLDS.taskSubmittingWarningMs) {
        const age = nowMs - updatedMs;
        out.push(finding_("TASK_STUCK_SUBMITTING", age >= THRESHOLDS.taskSubmittingCriticalMs ? "critical" : "warning",
          subject, updatedMs,
          "A queued submission never finished",
          "Task " + task.id + " began submitting " + minutes_(age) + " minutes ago and has not finished, so a render may or may not have started.",
          "Do not submit it again. The queue links it to the render that started, or returns it to ready, on its next run. If the background queue is switched off, check Render jobs for this script before doing anything.",
          { doNotRerender: true, doNotUploadAgain: false }));
      } else if (status === "FAILED" && updatedMs && nowMs - updatedMs <= THRESHOLDS.taskFailedWindowMs) {
        const interrupted = Math.max(0, Number(task.attempts || 0) - array_(task.preparedScenes).length);
        if (interrupted >= THRESHOLDS.taskMaxInterruptedAttempts) {
          out.push(finding_("TASK_RETRIES_EXHAUSTED", "warning", subject, updatedMs,
            "A queued task stopped after repeated interruptions",
            "Task " + task.id + " was interrupted " + interrupted + " times and the queue stopped retrying. " + safeText_(task.errorMessage),
            "Read the Logs sheet (PRODUCTION_RECOVERY), then use Resume once. Do not resume repeatedly: every attempt can cost money.",
            { doNotRerender: true, doNotUploadAgain: false }));
        } else {
          out.push(finding_("TASK_FAILED", "warning", subject, updatedMs,
            "A queued task failed",
            "Task " + task.id + " failed. " + safeText_(task.errorMessage),
            "Fix the cause in the message, then use Resume on the Production page. If no render was started, nothing is lost.",
            { doNotRerender: false, doNotUploadAgain: false }));
        }
      } else if (status === "SUBMITTED" && task.renderJobId && !renderIds[task.renderJobId]) {
        out.push(finding_("TASK_LINKED_RENDER_MISSING", "warning", subject, updatedMs,
          "A queued task points at a render that cannot be found",
          "Task " + task.id + " says it started render " + task.renderJobId + ", but no render job has that ID.",
          "Do not submit it again. Open Render jobs and look for a render of this script; if there is none, ask the owner to review the Production Tasks and Render Jobs tabs.",
          { doNotRerender: true, doNotUploadAgain: false }));
      }
    });
    return out;
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
  // The worker's confirmation (execution details) is saved on the render once it answers.
  function hasExecution_(job) {
    const cloudRun = job && job.providerResponse && job.providerResponse.cloudRun;
    return !!(cloudRun && (cloudRun.executionName || cloudRun.operationName));
  }
  // Task messages are already user-facing, but keep findings free of anything key-shaped and short.
  function safeText_(value) {
    return String(value || "").replace(/sk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]")
      .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
      .replace(/[A-Fa-f0-9]{32,}/g, "[REDACTED]").trim().slice(0, 200);
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
