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

  const DEFAULT_LIST_LIMIT = 50;
  const MAX_LIST_LIMIT = 200;

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
   * Normalises a script-generation request.
   *
   * @param {*} request Frontend request.
   * @return {Object} Normalised request.
   * @private
   */
  function normaliseGenerateRequest_(
    request
  ) {
    if (
      !request ||
      typeof request !== "object" ||
      Array.isArray(request)
    ) {
      throw createControllerError_(
        "A script-generation request is required."
      );
    }

    const sourceIdea =
      request.idea &&
      typeof request.idea ===
        "object" &&
      !Array.isArray(
        request.idea
      )
        ? request.idea
        : request;

    const idea = {
      id:
        firstNonEmptyString_([
          sourceIdea.id,
          sourceIdea.ideaId,
          sourceIdea["Idea ID"],
          sourceIdea.ID
        ]),

      videoIdea:
        firstNonEmptyString_([
          sourceIdea.videoIdea,
          sourceIdea.title,
          sourceIdea.idea,
          sourceIdea.topic,
          sourceIdea["Video Idea"],
          sourceIdea.Title
        ]),

      hook:
        firstNonEmptyString_([
          sourceIdea.hook,
          sourceIdea.Hook
        ]),

      targetAudience:
        firstNonEmptyString_([
          sourceIdea.targetAudience,
          sourceIdea[
            "Target Audience"
          ],
          sourceIdea.audience
        ]),

      niche:
        firstNonEmptyString_([
          sourceIdea.niche,
          sourceIdea.Niche
        ])
    };

    if (!idea.id) {
      throw createControllerError_(
        "Idea ID is required."
      );
    }

    if (!idea.videoIdea) {
      throw createControllerError_(
        "Idea title is required."
      );
    }

    const options =
      request.options ===
        undefined ||
      request.options === null
        ? {}
        : request.options;

    if (
      typeof options !==
        "object" ||
      Array.isArray(options)
    ) {
      throw createControllerError_(
        "Script-generation options must be an object."
      );
    }

    return {
      idea:
        idea,

      options:
        sanitiseOptions_(
          options
        )
    };
  }

  /**
   * Returns only supported workflow options.
   *
   * @param {Object} options Supplied options.
   * @return {Object} Safe options.
   * @private
   */
  function sanitiseOptions_(options) {
    const supportedKeys = [
      "temperature",
      "maxTokens",
      "targetDurationSeconds",
      "minimumWordCount",
      "maximumWordCount",
      "minimumDurationSeconds",
      "maximumDurationSeconds",
      "durationToleranceSeconds",
      "maxValidationAttempts",
      "tone",
      "language",
      "callToActionStyle",
      "status"
    ];

    const sanitised = {};

    supportedKeys.forEach(
      function (key) {
        if (
          options[key] !== undefined &&
          options[key] !== null &&
          options[key] !== ""
        ) {
          sanitised[key] =
            clone_(
              options[key]
            );
        }
      }
    );

    return sanitised;
  }

  /**
   * Normalises script-list filters.
   *
   * @param {*} request Query request.
   * @return {Object} Safe query.
   * @private
   */
  function normaliseListRequest_(
    request
  ) {
    const source =
      request === undefined ||
      request === null
        ? {}
        : request;

    if (
      typeof source !==
        "object" ||
      Array.isArray(source)
    ) {
      throw createControllerError_(
        "Script-list request must be an object."
      );
    }

    return {
      status:
        normaliseOptionalString_(
          source.status
        ).toUpperCase(),

      ideaId:
        normaliseOptionalString_(
          source.ideaId
        ),

      limit:
        normaliseLimit_(
          source.limit
        )
    };
  }

  /**
   * Converts a complete ScriptModel into a list summary.
   *
   * @param {Object} script Script model.
   * @return {Object} Script summary.
   * @private
   */
  function toScriptSummary_(script) {
    return {
      id:
        script.id,

      ideaId:
        script.ideaId,

      title:
        script.title,

      hook:
        script.hook,

      status:
        script.status,

      estimatedDurationSeconds:
        script.estimatedDurationSeconds,

      sceneCount:
        Array.isArray(
          script.scenes
        )
          ? script.scenes.length
          : 0,

      wordCount:
        resolveScriptWordCount_(
          script
        ),

      provider:
        normaliseOptionalString_(
          script.metadata &&
          script.metadata.provider
        ),

      aiModel:
        script.aiModel || "",

      promptVersion:
        script.promptVersion || "",

      validationAttempts:
        resolveValidationAttempts_(
          script
        ),

      createdAt:
        script.createdAt,

      updatedAt:
        script.updatedAt,

      version:
        script.version
    };
  }

  /**
   * Resolves stored script word count.
   *
   * @param {Object} script Script model.
   * @return {number} Word count.
   * @private
   */
  function resolveScriptWordCount_(
    script
  ) {
    const metadataWordCount =
      Number(
        script.metadata &&
        script.metadata.wordCount
      );

    if (
      isFinite(
        metadataWordCount
      ) &&
      metadataWordCount >= 0
    ) {
      return metadataWordCount;
    }

    const text =
      normaliseOptionalString_(
        script.voiceoverScript
      );

    if (!text) {
      return 0;
    }

    return text
      .split(/\s+/)
      .filter(Boolean)
      .length;
  }

  /**
   * Resolves the number of AI validation attempts.
   *
   * @param {Object} script Script model.
   * @return {number} Attempt count.
   * @private
   */
  function resolveValidationAttempts_(
    script
  ) {
    const candidate =
      Number(
        script.metadata &&
        script.metadata.usage &&
        (
          script.metadata.usage
            .attemptCount ||
          script.metadata.usage
            .workflowAttemptCount
        )
      );

    if (
      isFinite(candidate) &&
      candidate > 0
    ) {
      return Math.round(
        candidate
      );
    }

    return 1;
  }

  /**
   * Extracts a Script ID.
   *
   * @param {*} request Request value.
   * @return {string} Script ID.
   * @private
   */
  function extractScriptId_(request) {
    const value =
      typeof request === "string"
        ? request
        : request &&
          typeof request ===
            "object"
          ? (
              request.scriptId ||
              request.id
            )
          : "";

    const scriptId =
      normaliseOptionalString_(
        value
      );

    if (!scriptId) {
      throw createControllerError_(
        "Script ID is required."
      );
    }

    return scriptId;
  }

  /**
   * Extracts an Idea ID.
   *
   * @param {*} request Request value.
   * @return {string} Idea ID.
   * @private
   */
  function extractIdeaId_(request) {
    const value =
      typeof request === "string"
        ? request
        : request &&
          typeof request ===
            "object"
          ? (
              request.ideaId ||
              request.id
            )
          : "";

    const ideaId =
      normaliseOptionalString_(
        value
      );

    if (!ideaId) {
      throw createControllerError_(
        "Idea ID is required."
      );
    }

    return ideaId;
  }

  /**
   * Normalises list limits.
   *
   * @param {*} value Supplied limit.
   * @return {number} Safe list limit.
   * @private
   */
  function normaliseLimit_(value) {
    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      return DEFAULT_LIST_LIMIT;
    }

    const numericValue =
      Number(value);

    if (
      !Number.isInteger(
        numericValue
      ) ||
      numericValue < 1
    ) {
      throw createControllerError_(
        "Script-list limit must be a positive integer."
      );
    }

    return Math.min(
      numericValue,
      MAX_LIST_LIMIT
    );
  }

  /**
   * Sorts scripts by updated date, newest first.
   *
   * @param {Object} first First script.
   * @param {Object} second Second script.
   * @return {number} Sort value.
   * @private
   */
  function sortByNewestUpdated_(
    first,
    second
  ) {
    return (
      new Date(
        second.updatedAt
      ).getTime() -
      new Date(
        first.updatedAt
      ).getTime()
    );
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
   * Resolves latest script update timestamp.
   *
   * @param {Object[]} scripts Script records.
   * @return {string} ISO timestamp or empty string.
   * @private
   */
  function resolveLatestUpdatedAt_(
    scripts
  ) {
    if (
      !Array.isArray(scripts) ||
      scripts.length === 0
    ) {
      return "";
    }

    const timestamps =
      scripts
        .map(function (script) {
          return new Date(
            script.updatedAt
          ).getTime();
        })
        .filter(
          function (timestamp) {
            return !isNaN(
              timestamp
            );
          }
        );

    if (
      timestamps.length === 0
    ) {
      return "";
    }

    return new Date(
      Math.max.apply(
        null,
        timestamps
      )
    ).toISOString();
  }

  /**
   * Creates a successful frontend response.
   *
   * @param {string} requestId Controller request ID.
   * @param {string} message User-facing message.
   * @param {Object} data Response payload.
   * @return {Object} Success response.
   * @private
   */
  function createSuccessResponse_(
    requestId,
    message,
    data
  ) {
    return {
      success: true,
      statusCode: 200,
      requestId:
        requestId,
      message:
        message,
      data:
        clone_(
          data || {}
        ),
      controllerVersion:
        CONTROLLER_VERSION
    };
  }

  /**
   * Creates a not-found frontend response.
   *
   * @param {string} requestId Controller request ID.
   * @param {string} message User-facing message.
   * @param {Object} data Response payload.
   * @return {Object} Not-found response.
   * @private
   */
  function createNotFoundResponse_(
    requestId,
    message,
    data
  ) {
    return {
      success: false,
      statusCode: 404,
      requestId:
        requestId,
      message:
        message,
      data:
        clone_(
          data || {}
        ),
      error: {
        name:
          "NotFoundError",
        code:
          "NOT_FOUND"
      },
      controllerVersion:
        CONTROLLER_VERSION
    };
  }

  /**
   * Creates an error frontend response.
   *
   * @param {string} requestId Controller request ID.
   * @param {string} message User-facing message.
   * @param {*} error Internal error.
   * @return {Object} Error response.
   * @private
   */
  function createErrorResponse_(
    requestId,
    message,
    error
  ) {
    const safeError =
      normaliseError_(error);

    Logger.log(
      JSON.stringify({
        requestId:
          requestId,

        controller:
          "ScriptsController",

        errorName:
          safeError.name,

        errorMessage:
          safeError.message,

        runId:
          safeError.runId,

        ideaId:
          safeError.ideaId
      })
    );

    return {
      success: false,
      statusCode: 400,
      requestId:
        requestId,
      message:
        message,
      data: null,
      error: {
        name:
          safeError.name,

        code:
          safeError.code,

        message:
          safeError.message,

        runId:
          safeError.runId,

        ideaId:
          safeError.ideaId
      },
      controllerVersion:
        CONTROLLER_VERSION
    };
  }

  /**
   * Converts an internal error into a safe object.
   *
   * @param {*} error Internal error.
   * @return {Object} Safe error.
   * @private
   */
  function normaliseError_(error) {
    const name =
      normaliseOptionalString_(
        error && error.name
      ) || "Error";

    const rawMessage =
      normaliseOptionalString_(
        error && error.message
          ? error.message
          : error
      ) ||
      "An unknown error occurred.";

    return {
      name:
        name,

      code:
        resolveErrorCode_(
          name
        ),

      message:
        removeSensitiveErrorDetails_(
          rawMessage
        ),

      runId:
        normaliseOptionalString_(
          error && error.runId
        ),

      ideaId:
        normaliseOptionalString_(
          error && error.ideaId
        )
    };
  }

  /**
   * Maps error types to stable frontend codes.
   *
   * @param {string} errorName Error name.
   * @return {string} Error code.
   * @private
   */
  function resolveErrorCode_(
    errorName
  ) {
    const codes = {
      ScriptEngineError:
        "SCRIPT_GENERATION_FAILED",

      ScriptValidationError:
        "SCRIPT_VALIDATION_FAILED",

      ScriptFormatterError:
        "SCRIPT_FORMATTING_FAILED",

      ScriptModelError:
        "SCRIPT_MODEL_ERROR",

      ScriptModelValidationError:
        "SCRIPT_MODEL_VALIDATION_FAILED",

      ScriptsRepositoryError:
        "SCRIPT_REPOSITORY_ERROR",

      AIServiceError:
        "AI_SERVICE_ERROR",

      ScriptsControllerError:
        "INVALID_REQUEST"
    };

    return (
      codes[errorName] ||
      "SCRIPT_REQUEST_FAILED"
    );
  }

  /**
   * Removes stack/source details from a message.
   *
   * @param {string} message Error message.
   * @return {string} Safe message.
   * @private
   */
  function removeSensitiveErrorDetails_(
    message
  ) {
    return String(
      message || ""
    )
      .split(/\n\s*at\s+/)[0]
      .replace(
        /https?:\/\/\S+/gi,
        "[link removed]"
      )
      .trim();
  }

  /**
   * Returns the first non-empty string.
   *
   * @param {Array} values Candidate values.
   * @return {string} First string.
   * @private
   */
  function firstNonEmptyString_(
    values
  ) {
    for (
      let index = 0;
      index < values.length;
      index += 1
    ) {
      const value =
        normaliseOptionalString_(
          values[index]
        );

      if (value) {
        return value;
      }
    }

    return "";
  }

  /**
   * Normalises an optional string.
   *
   * @param {*} value Source value.
   * @return {string} String value.
   * @private
   */
  function normaliseOptionalString_(
    value
  ) {
    if (
      value === undefined ||
      value === null
    ) {
      return "";
    }

    return String(value).trim();
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

  /**
   * Creates a controller-specific error.
   *
   * @param {string} message Error message.
   * @return {Error} Controller error.
   * @private
   */
  function createControllerError_(
    message
  ) {
    const error =
      new Error(
        "Scripts controller error: " +
        message
      );

    error.name =
      "ScriptsControllerError";

    return error;
  }

  /**
   * Creates a JSON-compatible clone.
   *
   * @param {*} value Source value.
   * @return {*} Clone.
   * @private
   */
  function clone_(value) {
    if (
      value === undefined
    ) {
      return undefined;
    }

    return JSON.parse(
      JSON.stringify(value)
    );
  }

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

/****************************************************
 * Controller tests
 ****************************************************/

/**
 * Tests invalid generation input.
 *
 * No AI request is made.
 *
 * @return {Object} Controller response.
 */
function testScriptsControllerRejectsInvalidRequest() {
  const response =
    ScriptsController.generateScript({
      idea: {
        title:
          "Idea missing its ID"
      }
    });

  if (
    response.success !== false
  ) {
    throw new Error(
      "Scripts Controller accepted an invalid request."
    );
  }

  if (
    response.error.code !==
    "INVALID_REQUEST"
  ) {
    throw new Error(
      "Scripts Controller returned the wrong error code."
    );
  }

  Logger.log(
    JSON.stringify(
      response,
      null,
      2
    )
  );

  Logger.log(
    "Scripts Controller invalid-request test completed successfully."
  );

  return response;
}

/**
 * Tests script listing.
 *
 * No AI request is made.
 *
 * @return {Object} Controller response.
 */
function testScriptsControllerListsScripts() {
  const response =
    ScriptsController.listScripts({
      limit: 10
    });

  if (
    response.success !== true
  ) {
    throw new Error(
      "Scripts Controller could not list scripts."
    );
  }

  if (
    !response.data ||
    !Array.isArray(
      response.data.scripts
    )
  ) {
    throw new Error(
      "Scripts Controller returned an invalid scripts collection."
    );
  }

  Logger.log(
    JSON.stringify(
      response,
      null,
      2
    )
  );

  Logger.log(
    "Scripts Controller list test completed successfully."
  );

  return response;
}

/**
 * Tests script metrics.
 *
 * No AI request is made.
 *
 * @return {Object} Controller response.
 */
function testScriptsControllerMetrics() {
  const response =
    ScriptsController.getMetrics();

  if (
    response.success !== true
  ) {
    throw new Error(
      "Scripts Controller could not load metrics."
    );
  }

  if (
    typeof response.data
      .totalScripts !== "number" ||
    typeof response.data
      .createdToday !== "number"
  ) {
    throw new Error(
      "Scripts Controller returned invalid metrics."
    );
  }

  Logger.log(
    JSON.stringify(
      response,
      null,
      2
    )
  );

  Logger.log(
    "Scripts Controller metrics test completed successfully."
  );

  return response;
}

/**
 * Runs safe Scripts Controller tests.
 *
 * No AI request is made.
 *
 * @return {Object} Test summary.
 */
function testScriptsControllerAll() {
  testScriptsControllerRejectsInvalidRequest();
  testScriptsControllerListsScripts();
  testScriptsControllerMetrics();

  const result = {
    passed: true,
    testsRun: 3,
    liveProviderCalled: false,
    controllerVersion:
      ScriptsController
        .getControllerVersion()
  };

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "All Scripts Controller tests completed successfully."
  );

  return result;
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
