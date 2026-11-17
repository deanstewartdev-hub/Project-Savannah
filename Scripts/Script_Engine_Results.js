/****************************************************
 * Project Savannah
 * Script_Engine_Results.js
 *
 * Purpose:
 * Assemble what the Script Engine produces: the combined AI response across
 * attempts, the ScriptModel, the frontend-safe workflow result, and the
 * engine error raised when generation fails.
 *
 * Split out of Scripts/Script_Engine.js (modular refactor, November 2026). The function
 * bodies are unchanged. ScriptEngine remains the public entry point; nothing outside
 * it should call this module directly.
 ****************************************************/

const ScriptEngineResults = (() => {
  /**
   * Builds this module's helpers for one owner.
   *
   * @param {string} ENGINE_VERSION Value supplied by ScriptEngine.
   * @param {string} ACTION Value supplied by ScriptEngine.
   * @return {Object} Helpers.
   */
  function forEngine(ENGINE_VERSION, ACTION) {
    /**
     * Combines usage from every AI attempt into one response.
     *
     * This ensures cost tracking includes correction calls,
     * rather than recording only the final attempt.
     *
     * @param {Object[]} responses AI responses.
     * @return {Object} Combined response.
     */
    function combineAIResponses_(responses) {
      if (
        !Array.isArray(responses) ||
        responses.length === 0
      ) {
        throw new Error(
          "No AI responses were available to combine."
        );
      }

      const finalResponse = clone_(
        responses[responses.length - 1]
      );

      const combinedUsage =
        responses.reduce(
          function (total, response) {
            const usage =
              response.usage || {};

            total.inputTokens += Number(
              usage.inputTokens || 0
            );

            total.outputTokens += Number(
              usage.outputTokens || 0
            );

            total.totalTokens += Number(
              usage.totalTokens || 0
            );

            return total;
          },
          {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0
          }
        );

      finalResponse.usage = {
        inputTokens:
          combinedUsage.inputTokens,

        outputTokens:
          combinedUsage.outputTokens,

        totalTokens:
          combinedUsage.totalTokens,

        attemptCount:
          responses.length,

        attempts: responses.map(
          function (response, index) {
            return {
              attemptNumber: index + 1,
              inputTokens: Number(
                response.usage &&
                response.usage.inputTokens ||
                0
              ),
              outputTokens: Number(
                response.usage &&
                response.usage.outputTokens ||
                0
              ),
              totalTokens: Number(
                response.usage &&
                response.usage.totalTokens ||
                0
              )
            };
          }
        )
      };

      finalResponse.execution =
        finalResponse.execution || {};

      finalResponse.execution
        .workflowAttemptCount =
        responses.length;

      return finalResponse;
    }

    /**
     * Creates the canonical ScriptModel.
     *
     * @param {Object} idea Normalised idea.
     * @param {Object} promptResult Prompt details.
     * @param {Object} aiResponse AI response.
     * @param {Object} validationResult Validation output.
     * @param {Object} formattingResult Formatter output.
     * @param {Object} options Workflow options.
     * @param {string} runId Workflow run ID.
     * @return {Object} Canonical ScriptModel.
     */
    function createScriptModel_(
      idea,
      promptResult,
      aiResponse,
      validationResult,
      formattingResult,
      options,
      runId
    ) {
      const metadata = mergeObjects_(
        formattingResult.metadata || {},
        {
          runId: runId,
          action: ACTION,
          provider: aiResponse.provider || "",
          aiModel:
            aiResponse.model ||
            Settings.getModel(),
          usage:
            clone_(
              aiResponse.usage || {}
            ),
          aiExecution:
            clone_(
              aiResponse.execution || {}
            ),
          sourceIdea: clone_(idea),
          engineVersion: ENGINE_VERSION
        }
      );

      return ScriptModel.fromFormattedResult(
        formattingResult,
        {
          ideaId: idea.ideaId,

          status: options.status,

          promptVersion:
            promptResult.promptVersion,

          aiModel:
            aiResponse.model ||
            Settings.getModel(),

          validation: {
            valid:
              validationResult.valid === true,

            metadata:
              clone_(
                validationResult.metadata ||
                {}
              )
          },

          metadata: metadata
        }
      );
    }

    /**
     * Builds the public workflow result.
     *
     * @param {Object} data Workflow data.
     * @return {Object} Frontend-safe result.
     */
    function buildWorkflowResult_(data) {
      const durationMilliseconds =
        data.completedAt.getTime() -
        data.startedAt.getTime();

      return {
        success: true,

        runId: data.runId,

        scriptId:
          data.scriptModel.id,

        ideaId:
          data.scriptModel.ideaId,

        title:
          data.scriptModel.title,

        status:
          data.scriptModel.status,

        script:
          ScriptModel.toObject(
            data.scriptModel
          ),

        persistence: {
          saved:
            data.saveResult.saved === true,

          created:
            data.saveResult.created === true,

          rowNumber:
            data.saveResult.rowNumber,

          version:
            data.saveResult.version
        },

        ai: {
          provider:
            data.aiResponse.provider || "",

          model:
            data.aiResponse.model || "",

          usage:
            clone_(
              data.aiResponse.usage || {}
            ),

          execution:
            clone_(
              data.aiResponse.execution || {}
            )
        },

        validation: {
          valid:
            data.validationResult.valid ===
            true,

          metadata:
            clone_(
              data.validationResult
                .metadata || {}
            )
        },

        formatting: {
          valid:
            data.formattingResult.valid ===
            true,

          formatVersion:
            data.formattingResult
              .formatVersion,

          metadata:
            clone_(
              data.formattingResult
                .metadata || {}
            )
        },

        promptVersion:
          data.promptResult.promptVersion,

        estimatedCost:
          data.costResult
            ? data.costResult.estimatedCost
            : 0,

        execution: {
          startedAt:
            data.startedAt.toISOString(),

          completedAt:
            data.completedAt.toISOString(),

          durationMilliseconds:
            durationMilliseconds
        },

          validationAttempts:
          Number(
            data.validationAttempts || 1
          ),

        engineVersion:
          ENGINE_VERSION
      };
    }

    /**
     * Creates an engine-specific error.
     *
     * @param {*} originalError Original error.
     * @param {string} runId Workflow run ID.
     * @param {string} ideaId Idea ID.
     * @return {Error} Script Engine error.
     */
    function createEngineError_(
      originalError,
      runId,
      ideaId
    ) {
      if (
        originalError &&
        originalError.name ===
          "ScriptEngineError"
      ) {
        return originalError;
      }

      const detail = String(
        originalError &&
        originalError.message
          ? originalError.message
          : originalError ||
            "Unknown script-generation error."
      );

      const error = new Error(
        "Script generation failed: " +
          detail
      );

      error.name = "ScriptEngineError";
      error.runId = runId;
      error.ideaId = ideaId;
      error.originalError = detail;

      return error;
    }

    /**
     * Shallow merges plain objects.
     */
    function mergeObjects_(
      base,
      overrides
    ) {
      const result = clone_(base || {});

      Object.keys(
        overrides || {}
      ).forEach(function (key) {
        result[key] =
          clone_(overrides[key]);
      });

      return result;
    }

    /**
     * Creates a JSON-compatible deep clone.
     */
    function clone_(value) {
      if (value === undefined) {
        return undefined;
      }

      return JSON.parse(
        JSON.stringify(value)
      );
    }

    return {
      combineAIResponses: combineAIResponses_,
      createScriptModel: createScriptModel_,
      buildWorkflowResult: buildWorkflowResult_,
      createEngineError: createEngineError_,
      clone: clone_
    };
  }

  return {
    forEngine: forEngine
  };
})();
