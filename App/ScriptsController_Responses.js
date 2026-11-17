/****************************************************
 * Project Savannah
 * ScriptsController_Responses.js
 *
 * Purpose:
 * Shape what the Scripts controller sends back to the browser: success,
 * not-found and error responses, safe error details, and script summaries.
 * Writes one diagnostic log line per error response; touches no sheet or provider.
 *
 * Split out of App/ScriptsController.js (modular refactor, November 2026). The function
 * bodies are unchanged. ScriptsController remains the only public entry point; nothing
 * outside the controller should call this module directly.
 ****************************************************/

const ScriptsControllerResponses = (() => {
  // Shared helpers are looked up when called, so file load order never matters.
  function normaliseOptionalString_(value) { return ScriptsControllerValues.normaliseOptionalString(value); }
  function clone_(value) { return ScriptsControllerValues.clone(value); }

  /**
   * Builds the response helpers for one controller version.
   *
   * @param {string} CONTROLLER_VERSION Version stamped on every response.
   * @return {Object} Response helpers.
   */
  function forController(CONTROLLER_VERSION) {
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

        ApprovalRepositoryError:
          "APPROVAL_REPOSITORY_ERROR",

        ApprovalModelError:
          "APPROVAL_MODEL_ERROR",

        ApprovalModelValidationError:
          "APPROVAL_VALIDATION_FAILED",

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

    return {
      success: createSuccessResponse_,
      notFound: createNotFoundResponse_,
      error: createErrorResponse_,
      removeSensitiveErrorDetails: removeSensitiveErrorDetails_,
      toScriptSummary: toScriptSummary_,
      sortByNewestUpdated: sortByNewestUpdated_,
      resolveLatestUpdatedAt: resolveLatestUpdatedAt_
    };
  }

  return {
    forController: forController
  };
})();
