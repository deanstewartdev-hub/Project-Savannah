/****************************************************
 * Project Savannah v1.3
 * App/QueueController.js
 *
 * Frontend-safe boundary for the human review queue.
 ****************************************************/

const QueueController = (() => {
  const CONTROLLER_VERSION = "queue-controller-v1.0";
  const DECISIONS = Object.freeze({
    APPROVE: {
      approvalStatus: "APPROVED",
      scriptStatus: "APPROVED",
      action: "SCRIPT_APPROVED"
    },
    REJECT: {
      approvalStatus: "REJECTED",
      scriptStatus: "REJECTED",
      action: "SCRIPT_REJECTED"
    },
    RETURN: {
      approvalStatus: "CHANGES_REQUESTED",
      scriptStatus: "CHANGES_REQUESTED",
      action: "SCRIPT_CHANGES_REQUESTED"
    }
  });

  function list(request) {
    const requestId = createRequestId_();
    try {
      const source = request || {};
      const status = string_(source.status).toUpperCase();
      let approvals = status
        ? ApprovalRepository.getApprovalsByStatus(status)
        : ApprovalRepository.getAllApprovals();

      approvals.sort(function (first, second) {
        return new Date(second.updatedAt).getTime() -
          new Date(first.updatedAt).getTime();
      });

      const limit = normaliseLimit_(source.limit);
      approvals = approvals.slice(0, limit);

      return success_(requestId, "Approval queue loaded.", {
        approvals: approvals.map(toQueueItem_),
        count: approvals.length
      });
    } catch (error) {
      return failure_(requestId, "The approval queue could not be loaded.", error);
    }
  }

  function getMetrics() {
    const requestId = createRequestId_();
    try {
      const approvals = ApprovalRepository.getAllApprovals();
      const counts = {
        total: approvals.length,
        pending: 0,
        approved: 0,
        rejected: 0,
        changesRequested: 0
      };
      approvals.forEach(function (approval) {
        if (approval.status === "PENDING_APPROVAL") counts.pending += 1;
        if (approval.status === "APPROVED") counts.approved += 1;
        if (approval.status === "REJECTED") counts.rejected += 1;
        if (approval.status === "CHANGES_REQUESTED") counts.changesRequested += 1;
      });
      return success_(requestId, "Approval metrics loaded.", counts);
    } catch (error) {
      return failure_(requestId, "Approval metrics could not be loaded.", error);
    }
  }

  function decide(request) {
    const requestId = createRequestId_();
    const lock = LockService.getScriptLock();
    let locked = false;
    try {
      const source = requireObject_(request);
      const approvalId = requiredString_(source.approvalId, "Approval ID");
      const decisionKey = requiredString_(source.decision, "Decision").toUpperCase();
      const decision = DECISIONS[decisionKey];
      if (!decision) {
        throw controllerError_("Decision must be APPROVE, REJECT or RETURN.");
      }
      const notes = string_(source.reviewNotes);
      const reason = string_(source.decisionReason);
      if ((decisionKey === "REJECT" || decisionKey === "RETURN") && !reason) {
        throw controllerError_("A reason is required for this review decision.");
      }

      lock.waitLock(30000);
      locked = true;

      const approval = ApprovalRepository.getApprovalById(approvalId);
      if (!approval) throw notFoundError_("Approval record was not found.");
      if (approval.status !== "PENDING_APPROVAL") {
        throw controllerError_("This review has already been completed.");
      }

      const script = ScriptsRepository.getScriptById(approval.scriptId);
      if (!script) throw notFoundError_("The saved script for this review was not found.");
      if (script.status !== "PENDING_APPROVAL") {
        throw controllerError_("The script is not pending approval.");
      }

      const transitionedApproval = ApprovalModel.transition(
        approval,
        decision.approvalStatus,
        {
          reviewedBy: string_(source.reviewedBy),
          reviewNotes: notes,
          decisionReason: reason,
          metadata: { requestId: requestId }
        }
      );
      const transitionedScript = ScriptModel.withStatus(
        script,
        decision.scriptStatus
      );

      ApprovalRepository.updateApproval(transitionedApproval);
      try {
        ScriptsRepository.updateScript(transitionedScript);
      } catch (scriptError) {
        ApprovalRepository.updateApproval(approval);
        throw scriptError;
      }

      try {
        LoggingService.success(
          requestId,
          decision.action,
          "Approval " + approvalId + " completed for script " + script.id + "."
        );
      } catch (loggingError) {
        Logger.log("Review logging failed: " + loggingError.message);
      }

      return success_(requestId, "Review decision saved.", {
        approval: toQueueItem_(transitionedApproval, transitionedScript),
        script: {
          id: transitionedScript.id,
          status: transitionedScript.status,
          version: transitionedScript.version
        }
      });
    } catch (error) {
      return failure_(requestId, "The review decision could not be saved.", error);
    } finally {
      if (locked) lock.releaseLock();
    }
  }

  function toQueueItem_(approval, suppliedScript) {
    const script = suppliedScript ||
      ScriptsRepository.getScriptById(approval.scriptId);
    return {
      id: approval.id,
      scriptId: approval.scriptId,
      ideaId: approval.ideaId,
      title: approval.title,
      status: approval.status,
      submittedAt: approval.submittedAt,
      submittedBy: approval.submittedBy,
      reviewedAt: approval.reviewedAt,
      reviewedBy: approval.reviewedBy,
      reviewNotes: approval.reviewNotes,
      decisionReason: approval.decisionReason,
      version: approval.version,
      script: script ? {
        id: script.id,
        title: script.title,
        hook: script.hook,
        voiceoverScript: script.voiceoverScript,
        callToAction: script.callToAction,
        scenes: script.scenes,
        estimatedDurationSeconds: script.estimatedDurationSeconds,
        status: script.status,
        version: script.version
      } : null
    };
  }

  function success_(requestId, message, data) {
    return {
      success: true,
      statusCode: 200,
      requestId: requestId,
      message: message,
      data: JSON.parse(JSON.stringify(data || {})),
      controllerVersion: CONTROLLER_VERSION
    };
  }

  function failure_(requestId, message, error) {
    const name = string_(error && error.name) || "Error";
    const codes = {
      QueueControllerError: "INVALID_REQUEST",
      QueueNotFoundError: "NOT_FOUND",
      ApprovalRepositoryError: "APPROVAL_REPOSITORY_ERROR",
      ApprovalTransitionError: "INVALID_TRANSITION",
      ScriptModelError: "SCRIPT_MODEL_ERROR",
      ScriptsRepositoryError: "SCRIPT_REPOSITORY_ERROR"
    };
    Logger.log(JSON.stringify({
      requestId: requestId,
      controller: "QueueController",
      errorName: name,
      errorMessage: string_(error && error.message)
    }));
    return {
      success: false,
      statusCode: name === "QueueNotFoundError" ? 404 : 400,
      requestId: requestId,
      message: message,
      data: null,
      error: {
        name: name,
        code: codes[name] || "QUEUE_REQUEST_FAILED",
        message: safeMessage_(error)
      },
      controllerVersion: CONTROLLER_VERSION
    };
  }

  function requireObject_(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw controllerError_("Review request must be an object.");
    }
    return value;
  }

  function requiredString_(value, label) {
    const result = string_(value);
    if (!result) throw controllerError_(label + " is required.");
    return result;
  }

  function normaliseLimit_(value) {
    if (value === undefined || value === null || value === "") return 100;
    const result = Number(value);
    if (!Number.isInteger(result) || result < 1) {
      throw controllerError_("Limit must be a positive integer.");
    }
    return Math.min(result, 250);
  }

  function string_(value) {
    return value === undefined || value === null ? "" : String(value).trim();
  }

  function safeMessage_(error) {
    const message = string_(error && error.message) || "An unknown error occurred.";
    return message
      .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
      .slice(0, 500);
  }

  function createRequestId_() {
    return "REQ-" + Utilities.getUuid().slice(0, 8).toUpperCase();
  }

  function controllerError_(message) {
    const error = new Error(message);
    error.name = "QueueControllerError";
    return error;
  }

  function notFoundError_(message) {
    const error = new Error(message);
    error.name = "QueueNotFoundError";
    return error;
  }

  return {
    list: list,
    getMetrics: getMetrics,
    decide: decide,
    getControllerVersion: function () { return CONTROLLER_VERSION; }
  };
})();

function queueList(request) {
  return QueueController.list(request || {});
}

function queueGetMetrics() {
  return QueueController.getMetrics();
}

function queueDecide(request) {
  return QueueController.decide(request);
}

function testQueueControllerInvalidDecision() {
  const result = QueueController.decide({});
  if (result.success || result.error.code !== "INVALID_REQUEST") {
    throw new Error("Queue controller accepted an invalid request.");
  }
  return { passed: true, controllerVersion: QueueController.getControllerVersion() };
}
