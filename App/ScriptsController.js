/****************************************************
 * Project Savannah v1.3
 * App/ScriptsController.js
 *
 * Purpose:
 * Provide the web application with a safe controller
 * layer for script-generation and script-query actions.
 *
 * Responsibilities:
 * - Receive requests from the frontend.
 * - Validate and sanitise controller input.
 * - Call ScriptEngine and ScriptsRepository.
 * - Mark source ideas as Script Ready after persistence.
 * - Return frontend-safe response objects.
 * - Prevent internal implementation details from
 *   leaking into the browser.
 *
 * Must not:
 * - Call AI providers directly.
 * - Build prompts.
 * - Access spreadsheet ranges directly.
 * - Duplicate ScriptEngine workflow logic.
 * - Format HTML.
 ****************************************************/

const ScriptsController = (() => {
  const CONTROLLER_VERSION =
    "scripts-controller-v1.2";

  /**
   * Generates, validates, formats and saves a script.
   *
   * After the script has been persisted successfully,
   * the source idea is moved to Script Ready.
   *
   * Expected request:
   * {
   *   idea: {
   *     id: string,
   *     videoIdea: string,
   *     hook: string,
   *     targetAudience: string,
   *     niche: string
   *   },
   *   options: Object
   * }
   *
   * For backwards compatibility, the idea object may
   * also be supplied directly instead of request.idea.
   *
   * @param {Object} request Frontend generation request.
   * @return {Object} Frontend-safe controller response.
   */
  function generateScript(request) {
    const requestId =
      createControllerRequestId_();

    try {
      const parsedRequest =
        normaliseGenerateRequest_(request);

      /*
       * ScriptEngine must complete generation and
       * persistence before the Idea status is changed.
       */
      const result =
        ScriptEngine.generateScript(
          parsedRequest.idea,
          parsedRequest.options
        );

      if (
        !result ||
        !result.scriptId ||
        !result.script
      ) {
        throw createControllerError_(
          "The script engine did not return a persisted script."
        );
      }

      const sourceIdeaId =
        normaliseOptionalString_(
          result.ideaId ||
          parsedRequest.idea.id
        );

      const ideaTransition =
        transitionIdeaToScriptReady_(
          sourceIdeaId,
          result.scriptId
        );

      return createSuccessResponse_(
        requestId,
        ideaTransition.success
          ? "Script generated successfully and the source idea was moved to Script Ready."
          : "Script generated successfully, but the source idea status could not be updated.",
        {
          scriptId:
            result.scriptId,

          ideaId:
            sourceIdeaId,

          title:
            result.title ||
            (
              result.script &&
              result.script.title
            ) ||
            parsedRequest.idea.videoIdea,

          status:
            result.status ||
            (
              result.script &&
              result.script.status
            ) ||
            "FORMATTED",

          script:
            result.script,

          persistence:
            clone_(
              result.persistence || {}
            ),

          ai:
            clone_(
              result.ai || {}
            ),

          validation:
            clone_(
              result.validation || {}
            ),

          formatting:
            clone_(
              result.formatting || {}
            ),

          promptVersion:
            result.promptVersion || "",

          estimatedCost:
            Number(
              result.estimatedCost || 0
            ),

          validationAttempts:
            Number(
              result.validationAttempts || 1
            ),

          execution:
            clone_(
              result.execution || {}
            ),

          engineVersion:
            result.engineVersion || "",

          ideaTransition:
            ideaTransition
        }
      );
    } catch (error) {
      return createErrorResponse_(
        requestId,
        "Script generation failed.",
        error
      );
    }
  }

  /**
   * Moves a source idea to Script Ready.
   *
   * This runs only after the associated script has been
   * successfully persisted.
   *
   * A transition failure does not report the saved script
   * as failed, which prevents duplicate scripts when a
   * user retries generation.
   *
   * @param {string} ideaId Source idea ID.
   * @param {string} scriptId Persisted script ID.
   * @return {Object} Transition result.
   * @private
   */
  function transitionIdeaToScriptReady_(
    ideaId,
    scriptId
  ) {
    const safeIdeaId =
      normaliseOptionalString_(
        ideaId
      );

    const safeScriptId =
      normaliseOptionalString_(
        scriptId
      );

    if (!safeIdeaId) {
      return {
        attempted: false,
        success: false,
        ideaId: "",
        scriptId:
          safeScriptId,
        previousStatus: "",
        status: "",
        idea: null,
        warning:
          "The script was saved, but no source idea ID was available."
      };
    }

    try {
      if (
        typeof IdeasRepository ===
          "undefined" ||
        !IdeasRepository
      ) {
        throw new Error(
          "IdeasRepository is unavailable."
        );
      }

      const currentIdea =
        typeof IdeasRepository
          .getIdeaById === "function"
          ? IdeasRepository
              .getIdeaById(
                safeIdeaId
              )
          : null;

      if (!currentIdea) {
        throw new Error(
          "The source idea could not be found: " +
          safeIdeaId
        );
      }

      const previousStatus =
        normaliseOptionalString_(
          currentIdea.status
        );

      let updatedIdea;

      if (
        typeof IdeasRepository
          .markIdeaScriptReady ===
          "function"
      ) {
        updatedIdea =
          IdeasRepository
            .markIdeaScriptReady(
              safeIdeaId
            );
      } else if (
        typeof IdeasRepository
          .updateIdeaStatus ===
          "function"
      ) {
        updatedIdea =
          IdeasRepository
            .updateIdeaStatus(
              safeIdeaId,
              "Script Ready"
            );
      } else {
        throw new Error(
          "The Ideas repository has no supported status-update method."
        );
      }

      if (
        !updatedIdea ||
        normaliseOptionalString_(
          updatedIdea.status
        ).toLowerCase() !==
          "script ready"
      ) {
        throw new Error(
          "The source idea did not persist the Script Ready status."
        );
      }

      SpreadsheetApp.flush();

      Logger.log(
        JSON.stringify({
          controller:
            "ScriptsController",

          action:
            "IDEA_MOVED_TO_SCRIPT_READY",

          ideaId:
            safeIdeaId,

          scriptId:
            safeScriptId,

          previousStatus:
            previousStatus,

          status:
            updatedIdea.status
        })
      );

      return {
        attempted: true,
        success: true,

        ideaId:
          safeIdeaId,

        scriptId:
          safeScriptId,

        previousStatus:
          previousStatus,

        status:
          updatedIdea.status,

        idea:
          clone_(
            updatedIdea
          ),

        warning: ""
      };
    } catch (error) {
      const warning =
        removeSensitiveErrorDetails_(
          error && error.message
            ? error.message
            : error
        );

      Logger.log(
        JSON.stringify({
          controller:
            "ScriptsController",

          action:
            "IDEA_SCRIPT_READY_TRANSITION_FAILED",

          ideaId:
            safeIdeaId,

          scriptId:
            safeScriptId,

          warning:
            warning
        })
      );

      return {
        attempted: true,
        success: false,

        ideaId:
          safeIdeaId,

        scriptId:
          safeScriptId,

        previousStatus: "",
        status: "",
        idea: null,

        warning:
          warning ||
          "The source idea status could not be updated."
      };
    }
  }

  /**
   * Generates a script preview without saving it.
   *
   * This still performs a live AI request.
   *
   * @param {Object} request Frontend request.
   * @return {Object} Frontend-safe response.
   */
  function generatePreview(request) {
    const requestId =
      createControllerRequestId_();

    try {
      const parsedRequest =
        normaliseGenerateRequest_(request);

      const script =
        ScriptEngine.generatePreview(
          parsedRequest.idea,
          parsedRequest.options
        );

      return createSuccessResponse_(
        requestId,
        "Script preview generated successfully.",
        {
          script:
            ScriptModel.toObject(
              script
            )
        }
      );
    } catch (error) {
      return createErrorResponse_(
        requestId,
        "Script preview generation failed.",
        error
      );
    }
  }

  /**
   * Returns scripts for the Scripts page.
   *
   * Supported request:
   * {
   *   status: string,
   *   ideaId: string,
   *   limit: number
   * }
   *
   * @param {Object=} request Query options.
   * @return {Object} Frontend-safe response.
   */
  function listScripts(request) {
    const requestId =
      createControllerRequestId_();

    try {
      const query =
        normaliseListRequest_(request);

      let scripts;

      if (query.ideaId) {
        scripts =
          ScriptsRepository
            .getScriptsByIdeaId(
              query.ideaId
            );
      } else if (query.status) {
        scripts =
          ScriptsRepository
            .getScriptsByStatus(
              query.status
            );
      } else {
        scripts =
          ScriptsRepository
            .getAllScripts();
      }

      const sortedScripts =
        scripts
          .slice()
          .sort(
            sortByNewestUpdated_
          )
          .slice(
            0,
            query.limit
          );

      return createSuccessResponse_(
        requestId,
        "Scripts loaded successfully.",
        {
          scripts:
            sortedScripts.map(
              toScriptSummary_
            ),

          count:
            sortedScripts.length,

          totalStored:
            ScriptsRepository
              .getScriptCount(),

          filters: {
            status:
              query.status,

            ideaId:
              query.ideaId,

            limit:
              query.limit
          }
        }
      );
    } catch (error) {
      return createErrorResponse_(
        requestId,
        "Scripts could not be loaded.",
        error
      );
    }
  }

  /**
   * Returns one complete script by ID.
   *
   * Accepted input:
   * - script ID string
   * - { scriptId: string }
   *
   * @param {*} request Script ID or request object.
   * @return {Object} Frontend-safe response.
   */
  function getScript(request) {
    const requestId =
      createControllerRequestId_();

    try {
      const scriptId =
        extractScriptId_(request);

      const script =
        ScriptsRepository
          .getScriptById(
            scriptId
          );

      if (!script) {
        return createNotFoundResponse_(
          requestId,
          "Script was not found.",
          {
            scriptId:
              scriptId
          }
        );
      }

      return createSuccessResponse_(
        requestId,
        "Script loaded successfully.",
        {
          script:
            ScriptModel.toObject(
              script
            )
        }
      );
    } catch (error) {
      return createErrorResponse_(
        requestId,
        "Script could not be loaded.",
        error
      );
    }
  }

  /**
   * Returns the latest script for an idea.
   *
   * Accepted input:
   * - idea ID string
   * - { ideaId: string }
   *
   * @param {*} request Idea ID request.
   * @return {Object} Frontend-safe response.
   */
  function getLatestScriptForIdea(
    request
  ) {
    const requestId =
      createControllerRequestId_();

    try {
      const ideaId =
        extractIdeaId_(request);

      const script =
        ScriptsRepository
          .getLatestScriptByIdeaId(
            ideaId
          );

      if (!script) {
        return createNotFoundResponse_(
          requestId,
          "No script exists for this idea.",
          {
            ideaId:
              ideaId
          }
        );
      }

      return createSuccessResponse_(
        requestId,
        "Latest script loaded successfully.",
        {
          script:
            ScriptModel.toObject(
              script
            )
        }
      );
    } catch (error) {
      return createErrorResponse_(
        requestId,
        "The latest script could not be loaded.",
        error
      );
    }
  }

  /**
   * Returns script counts for dashboard or page metrics.
   *
   * @return {Object} Frontend-safe response.
   */
  function getMetrics() {
    const requestId =
      createControllerRequestId_();

    try {
      const scripts =
        ScriptsRepository
          .getAllScripts();

      const statusCounts = {};

      const statuses =
        ScriptModel.getStatuses();

      Object.keys(statuses)
        .forEach(function (key) {
          const status =
            statuses[key];

          statusCounts[status] = 0;
        });

      scripts.forEach(
        function (script) {
          if (
            statusCounts[
              script.status
            ] === undefined
          ) {
            statusCounts[
              script.status
            ] = 0;
          }

          statusCounts[
            script.status
          ] += 1;
        }
      );

      const todayStart =
        createTodayStart_();

      const createdToday =
        scripts.filter(
          function (script) {
            const createdAt =
              new Date(
                script.createdAt
              );

            return (
              !isNaN(
                createdAt.getTime()
              ) &&
              createdAt.getTime() >=
                todayStart.getTime()
            );
          }
        ).length;

      return createSuccessResponse_(
        requestId,
        "Script metrics loaded successfully.",
        {
          totalScripts:
            scripts.length,

          createdToday:
            createdToday,

          statusCounts:
            statusCounts,

          latestUpdatedAt:
            resolveLatestUpdatedAt_(
              scripts
            )
        }
      );
    } catch (error) {
      return createErrorResponse_(
        requestId,
        "Script metrics could not be loaded.",
        error
      );
    }
  }

  /**
   * Submits one existing saved script for human review.
   *
   * The script is never regenerated or duplicated. A
   * single pending Approval record is created and the
   * existing Script record moves to PENDING_APPROVAL.
   *
   * @param {*} request Script review request.
   * @return {Object} Frontend-safe controller response.
   */
  function sendForReview(request) {
    const requestId =
      createControllerRequestId_();
    const lock =
      LockService.getScriptLock();

    try {
      lock.waitLock(30000);

      const scriptId =
        extractScriptId_(request);
      const source =
        request &&
        typeof request === "object" &&
        !Array.isArray(request)
          ? request
          : {};

      const script =
        ScriptsRepository
          .getScriptById(scriptId);

      if (!script) {
        return createNotFoundResponse_(
          requestId,
          "Script was not found.",
          {
            scriptId: scriptId
          }
        );
      }

      if (
        script.status ===
          "PENDING_APPROVAL"
      ) {
        const existingPending =
          ApprovalRepository
            .getActiveApprovalByScriptId(
              scriptId
            );

        if (existingPending) {
          return createSuccessResponse_(
            requestId,
            "This script is already pending approval.",
            {
              script:
                ScriptModel.toObject(
                  script
                ),
              approval:
                ApprovalModel.toObject(
                  existingPending
                ),
              alreadyPending: true
            }
          );
        }

        throw createControllerError_(
          "The script is pending approval but its queue record is missing."
        );
      }

      if (
        script.status !== "FORMATTED"
      ) {
        throw createControllerError_(
          "Only a formatted script can be sent for review."
        );
      }

      const existingApproval =
        ApprovalRepository
          .getActiveApprovalByScriptId(
            scriptId
          );

      if (existingApproval) {
        throw createControllerError_(
          "This script already has an active approval."
        );
      }

      const approval =
        ApprovalModel.fromScript(
          script,
          {
            submittedBy:
              normaliseOptionalString_(
                source.submittedBy
              ),
            reviewNotes:
              normaliseOptionalString_(
                source.reviewNotes
              ),
            metadata: {
              requestId: requestId,
              submittedFrom:
                "SCRIPTS_WORKSPACE"
            }
          }
        );

      ApprovalRepository
        .saveApproval(approval);

      let updatedScript;

      try {
        updatedScript =
          ScriptModel.withStatus(
            script,
            "PENDING_APPROVAL"
          );

        ScriptsRepository
          .updateScript(
            updatedScript
          );
      } catch (statusError) {
        ApprovalRepository
          .deleteApprovalById(
            approval.id
          );

        throw statusError;
      }

      SpreadsheetApp.flush();

      Logger.log(
        JSON.stringify({
          controller:
            "ScriptsController",
          action:
            "SCRIPT_SENT_FOR_REVIEW",
          requestId:
            requestId,
          scriptId:
            scriptId,
          ideaId:
            script.ideaId,
          approvalId:
            approval.id,
          status:
            updatedScript.status
        })
      );

      return createSuccessResponse_(
        requestId,
        "Script sent for review successfully.",
        {
          script:
            ScriptModel.toObject(
              updatedScript
            ),
          approval:
            ApprovalModel.toObject(
              approval
            ),
          alreadyPending: false
        }
      );
    } catch (error) {
      return createErrorResponse_(
        requestId,
        "Script could not be sent for review.",
        error
      );
    } finally {
      if (lock.hasLock()) {
        lock.releaseLock();
      }
    }
  }

  /**
   * Returns today's local start time.
   *
   * @return {Date} Local start of today.
   * @private
   */
  function createTodayStart_() {
    const today =
      new Date();

    today.setHours(
      0,
      0,
      0,
      0
    );

    return today;
  }

  /**
   * Creates a controller request ID.
   *
   * @return {string} Request ID.
   * @private
   */
  function createControllerRequestId_() {
    return (
      "REQ-SCRIPT-" +
      Utilities.getUuid()
        .slice(0, 8)
        .toUpperCase()
    );
  }

  /*
   * Request parsing, response shaping and value helpers live in the sibling
   * ScriptsController_Requests.js, ScriptsController_Responses.js and
   * ScriptsController_Values.js modules. The private names below are kept as
   * one-line delegates so every call site in this controller is unchanged. Each
   * module is looked up when called, never while this file loads.
   */
  let responses_ = null;

  function getResponses_() {
    if (!responses_) {
      responses_ = ScriptsControllerResponses.forController(CONTROLLER_VERSION);
    }

    return responses_;
  }

  function normaliseGenerateRequest_(request) { return ScriptsControllerRequests.normaliseGenerateRequest(request); }
  function normaliseListRequest_(request) { return ScriptsControllerRequests.normaliseListRequest(request); }
  function extractScriptId_(request) { return ScriptsControllerRequests.extractScriptId(request); }
  function extractIdeaId_(request) { return ScriptsControllerRequests.extractIdeaId(request); }

  function createSuccessResponse_(requestId, message, data) { return getResponses_().success(requestId, message, data); }
  function createNotFoundResponse_(requestId, message, data) { return getResponses_().notFound(requestId, message, data); }
  function createErrorResponse_(requestId, message, error) { return getResponses_().error(requestId, message, error); }
  function removeSensitiveErrorDetails_(message) { return getResponses_().removeSensitiveErrorDetails(message); }
  function toScriptSummary_(script) { return getResponses_().toScriptSummary(script); }
  function sortByNewestUpdated_(first, second) { return getResponses_().sortByNewestUpdated(first, second); }
  function resolveLatestUpdatedAt_(scripts) { return getResponses_().resolveLatestUpdatedAt(scripts); }

  function normaliseOptionalString_(value) { return ScriptsControllerValues.normaliseOptionalString(value); }
  function createControllerError_(message) { return ScriptsControllerValues.createControllerError(message); }
  function clone_(value) { return ScriptsControllerValues.clone(value); }

  return {
    generateScript:
      generateScript,

    generatePreview:
      generatePreview,

    listScripts:
      listScripts,

    getScript:
      getScript,

    getLatestScriptForIdea:
      getLatestScriptForIdea,

    getMetrics:
      getMetrics,

    sendForReview:
      sendForReview,

    getControllerVersion:
      function () {
        return CONTROLLER_VERSION;
      }
  };
})();

/****************************************************
 * Global Apps Script entry points
 ****************************************************/

/**
 * Generates and persists one script.
 *
 * @param {Object} request Frontend request.
 * @return {Object} Controller response.
 */
function scriptsGenerateScript(
  request
) {
  return ScriptsController
    .generateScript(request);
}

/**
 * Generates a preview without persistence.
 *
 * @param {Object} request Frontend request.
 * @return {Object} Controller response.
 */
function scriptsGeneratePreview(
  request
) {
  return ScriptsController
    .generatePreview(request);
}

/**
 * Lists stored scripts.
 *
 * @param {Object=} request Query options.
 * @return {Object} Controller response.
 */
function scriptsList(request) {
  return ScriptsController
    .listScripts(
      request || {}
    );
}

/**
 * Loads one complete script.
 *
 * @param {*} request Script ID request.
 * @return {Object} Controller response.
 */
function scriptsGet(request) {
  return ScriptsController
    .getScript(request);
}

/**
 * Loads the latest script for an idea.
 *
 * @param {*} request Idea ID request.
 * @return {Object} Controller response.
 */
function scriptsGetLatestForIdea(
  request
) {
  return ScriptsController
    .getLatestScriptForIdea(
      request
    );
}

/**
 * Loads script metrics.
 *
 * @return {Object} Controller response.
 */
function scriptsGetMetrics() {
  return ScriptsController
    .getMetrics();
}

/**
 * Sends an existing saved script for review.
 *
 * @param {*} request Script review request.
 * @return {Object} Controller response.
 */
function scriptsSendForReview(
  request
) {
  return ScriptsController
    .sendForReview(request);
}

/**
 * Moves an existing idea to Script Ready without
 * generating another script.
 *
 * Use this only when a script has already been saved for
 * the supplied idea.
 *
 * @param {string} ideaId Existing source idea ID.
 * @return {Object} Updated idea and associated script.
 */
function reconcileExistingScriptReadyIdea(
  ideaId
) {
  const safeIdeaId =
    String(
      ideaId || ""
    ).trim();

  if (!safeIdeaId) {
    throw new Error(
      "An idea ID is required."
    );
  }

  const existingScript =
    ScriptsRepository
      .getLatestScriptByIdeaId(
        safeIdeaId
      );

  if (!existingScript) {
    throw new Error(
      "No saved script exists for idea " +
      safeIdeaId +
      ". The status was not changed."
    );
  }

  const updatedIdea =
    typeof IdeasRepository
      .markIdeaScriptReady === "function"
      ? IdeasRepository
          .markIdeaScriptReady(
            safeIdeaId
          )
      : IdeasRepository
          .updateIdeaStatus(
            safeIdeaId,
            "Script Ready"
          );

  SpreadsheetApp.flush();

  const result = {
    success: true,

    ideaId:
      safeIdeaId,

    scriptId:
      existingScript.id,

    scriptTitle:
      existingScript.title,

    status:
      updatedIdea.status,

    idea:
      updatedIdea
  };

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "Existing idea reconciled to Script Ready successfully."
  );

  return result;
}
