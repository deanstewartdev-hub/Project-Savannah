/****************************************************
 * Project Savannah v1.2
 * Script_Engine.js
 *
 * Purpose:
 * Coordinate the complete YouTube Shorts script
 * generation workflow.
 *
 * Responsibilities:
 * - Validate script-generation input.
 * - Build the versioned script prompt.
 * - Call the provider-independent AI service.
 * - Validate and format generated content.
 * - Create the canonical ScriptModel.
 * - Persist the completed script.
 * - Record AI usage cost.
 * - Record workflow activity.
 * - Return a frontend-safe workflow result.
 *
 * Must not:
 * - Build provider-specific API payloads.
 * - Access spreadsheet ranges directly.
 * - Contain prompt templates.
 * - Duplicate validation or formatting logic.
 * - Display frontend UI.
 ****************************************************/

const ScriptEngine = (() => {
  const ENGINE_VERSION = "script-engine-v1.0";
  const ACTION = "SCRIPT_GENERATION";

  /**
   * Generates and saves one complete script from an idea.
   *
   * Supported idea properties:
   * - id / ideaId / "Idea ID"
   * - title / videoIdea / idea / topic / "Video Idea"
   * - hook
   * - targetAudience
   *
   * @param {Object} idea Source idea.
   * @param {Object=} options Workflow overrides.
   * @return {Object} Completed workflow result.
   */
    /**
   * Generates, validates, formats and saves one script.
   *
   * Invalid AI output is automatically returned to the
   * provider for correction, up to the configured maximum
   * number of validation attempts.
   *
   * @param {Object} idea Source idea.
   * @param {Object=} options Workflow overrides.
   * @return {Object} Completed workflow result.
   */
  function generateScript(idea, options) {
    const runId = createScriptRunId_();
    const workflowOptions = resolveOptions_(options);
    const normalisedIdea = normaliseIdea_(idea);
    const startedAt = new Date();

    safeLogStarted_(
      runId,
      ACTION,
      "Script generation started for idea " +
        normalisedIdea.ideaId +
        "."
    );

    try {
      const promptResult = buildPrompt_(
        normalisedIdea,
        workflowOptions
      );

      const generationResult =
        generateValidatedContent_(
          promptResult.prompt,
          normalisedIdea,
          workflowOptions,
          runId
        );

      const formattingResult =
        ScriptFormatter.format(
          generationResult.validationResult
        );

      const scriptModel = createScriptModel_(
        normalisedIdea,
        promptResult,
        generationResult.aiResponse,
        generationResult.validationResult,
        formattingResult,
        workflowOptions,
        runId
      );

      const saveResult =
        ScriptsRepository.saveScript(
          scriptModel
        );

      const costResult = recordCostSafely_(
        runId,
        generationResult.aiResponse
      );

      const completedAt = new Date();

      safeLogSuccess_(
        runId,
        ACTION,
        "Script " +
          scriptModel.id +
          " generated and saved successfully after " +
          generationResult.validationAttempts +
          " validation attempt(s)."
      );

      return buildWorkflowResult_({
        runId: runId,
        scriptModel: scriptModel,
        saveResult: saveResult,
        aiResponse:
          generationResult.aiResponse,
        promptResult: promptResult,
        validationResult:
          generationResult.validationResult,
        formattingResult: formattingResult,
        costResult: costResult,
        startedAt: startedAt,
        completedAt: completedAt,
        validationAttempts:
          generationResult.validationAttempts
      });
    } catch (error) {
      safeLogFailure_(
        runId,
        ACTION,
        "Script generation failed for idea " +
          normalisedIdea.ideaId +
          ".",
        error
      );

      throw createEngineError_(
        error,
        runId,
        normalisedIdea.ideaId
      );
    }
  }

  /**
   * Generates and validates a script without saving it.
   *
   * This performs a real AI request but does not write a
   * script record or cost record.
   *
   * @param {Object} idea Source idea.
   * @param {Object=} options Workflow overrides.
   * @return {Object} Generated ScriptModel preview.
   */
  function generatePreview(idea, options) {
    const runId = createScriptRunId_();
    const workflowOptions = resolveOptions_(options);
    const normalisedIdea = normaliseIdea_(idea);

    const promptResult = buildPrompt_(
      normalisedIdea,
      workflowOptions
    );

    const generationResult =
      generateValidatedContent_(
        promptResult.prompt,
        normalisedIdea,
        workflowOptions,
        runId
      );

    const formattingResult =
      ScriptFormatter.format(
        generationResult.validationResult
      );

    return createScriptModel_(
      normalisedIdea,
      promptResult,
      generationResult.aiResponse,
      generationResult.validationResult,
      formattingResult,
      workflowOptions,
      runId
    );
  }

  /**
   * Generates structured script content and validates it.
   *
   * When AI output fails validation, the rejected output
   * and exact validation errors are sent back to the AI
   * for correction.
   *
   * @param {string} originalPrompt Initial generation prompt.
   * @param {Object} idea Normalised idea.
   * @param {Object} options Workflow options.
   * @param {string} runId Workflow run ID.
   * @return {Object} Validated generation result.
   */
  function generateValidatedContent_(
    originalPrompt,
    idea,
    options,
    runId
  ) {
    let currentPrompt = originalPrompt;
    let lastValidationError = null;
    const aiResponses = [];

    for (
      let attempt = 1;
      attempt <= options.maxValidationAttempts;
      attempt++
    ) {
      const aiResponse = requestScript_(
        currentPrompt,
        idea,
        options,
        runId
      );

      aiResponses.push(aiResponse);

      try {
        const validationResult =
          validateGeneratedScript_(
            aiResponse.data,
            options
          );

        return {
          aiResponse:
            combineAIResponses_(
              aiResponses
            ),

          validationResult:
            validationResult,

          validationAttempts:
            attempt
        };
      } catch (error) {
        if (
          error.name !==
          "ScriptValidationError"
        ) {
          throw error;
        }

        lastValidationError = error;

        safeLogWarning_(
          runId,
          "SCRIPT_VALIDATION",
          "Generated script failed validation on attempt " +
            attempt +
            " of " +
            options.maxValidationAttempts +
            ".",
          error
        );

        if (
          attempt >=
          options.maxValidationAttempts
        ) {
          break;
        }

        currentPrompt =
          buildCorrectionPrompt_(
            originalPrompt,
            aiResponse.data,
            error,
            idea,
            options,
            attempt + 1
          );
      }
    }

    throw lastValidationError ||
      new Error(
        "Generated script could not be validated."
      );
  }

  /**
   * Runs ScriptValidator using the workflow rules.
   *
   * @param {Object} generatedScript AI-generated script.
   * @param {Object} options Workflow options.
   * @return {Object} Validation result.
   */
  function validateGeneratedScript_(
    generatedScript,
    options
  ) {
    normaliseGeneratedTiming_(generatedScript);
    return ScriptValidator.validate(
      generatedScript,
      {
        minimumWordCount:
          options.minimumWordCount,

        maximumWordCount:
          options.maximumWordCount,

        minimumDurationSeconds:
          options.minimumDurationSeconds,

        maximumDurationSeconds:
          options.maximumDurationSeconds,

        durationToleranceSeconds:
          options.durationToleranceSeconds
      }
    );
  }

  // Previously this forced estimatedDurationSeconds to an even split of a 30-60s target
  // regardless of what the AI actually wrote, which meant ScriptValidator's duration check
  // was validating a fabricated number that could never fail - see the 2026-08-14 forensic
  // audit (two real renders, both far under 30s, both still carried a fabricated 50s
  // estimate). This now derives an honest estimate from each scene's own narration word
  // count, so a genuinely too-short script produces a genuinely-too-short estimate.
  /**
   * Builds a script-generation request without calling AI.
   *
   * @param {Object} idea Source idea.
   * @param {Object=} options Workflow overrides.
   * @return {Object} Prepared request information.
   */
  function prepareRequest(idea, options) {
    const workflowOptions = resolveOptions_(options);
    const normalisedIdea = normaliseIdea_(idea);

    const promptResult = buildPrompt_(
      normalisedIdea,
      workflowOptions
    );

    return {
      idea: normalisedIdea,
      prompt: promptResult.prompt,
      promptVersion:
        promptResult.promptVersion,
      options: clone_(workflowOptions),
      schema: Schemas.getScriptSchema(),
      engineVersion: ENGINE_VERSION
    };
  }

  /**
   * Calls the provider-independent AI service.
   *
   * @param {string} prompt Script prompt.
   * @param {Object} idea Normalised idea.
   * @param {Object} options Workflow options.
   * @param {string} runId Workflow run ID.
   * @return {Object} Canonical AI response.
   */
  function requestScript_(
    prompt,
    idea,
    options,
    runId
  ) {
    const requestOptions = {
      temperature:
        options.temperature,

      maxTokens:
        options.maxTokens,

      responseFormat:
        "json_schema",

      schema:
        Schemas.getScriptSchema(),

      systemMessage:
        "You are Project Savannah's professional " +
        "YouTube Shorts script writer. Produce a " +
        "complete, factual, engaging script and return " +
        "only data matching the supplied JSON schema.",

      metadata: {
        runId: runId,
        action: ACTION,
        ideaId: idea.ideaId,
        engineVersion: ENGINE_VERSION
      }
    };

    let response;

    if (
      typeof AIService !== "undefined" &&
      AIService &&
      typeof AIService
        .generateStructuredContent ===
        "function"
    ) {
      response =
        AIService.generateStructuredContent(
          prompt,
          Schemas.getScriptSchema(),
          requestOptions
        );
    } else if (
      typeof callAIService === "function"
    ) {
      response = callAIService(
        prompt,
        requestOptions
      );
    } else {
      throw new Error(
        "No compatible AI service is available."
      );
    }

    validateAIResponse_(response);

    return response;
  }

  /**
   * Builds the script prompt using ScriptPromptLibrary.
   *
   * The adapter supports the public method names used
   * during Savannah's prompt-library evolution.
   *
   * @param {Object} idea Normalised idea.
   * @param {Object} options Workflow options.
   * @return {Object} Prompt and version.
   */
  /**
   * Records AI cost without losing a completed script
   * when the Costs sheet or pricing configuration fails.
   *
   * @param {string} runId Workflow run ID.
   * @param {Object} aiResponse AI response.
   * @return {?Object} Cost record or null.
   */
  function recordCostSafely_(
    runId,
    aiResponse
  ) {
    try {
      return CostService.recordAIUsage({
        runId: runId,

        model:
          aiResponse.model ||
          Settings.getModel(),

        usage:
          aiResponse.usage || {},

        action: ACTION
      });
    } catch (error) {
      safeLogWarning_(
        runId,
        "COST_RECORDING",
        "The script was saved, but AI cost tracking failed.",
        error
      );

      return null;
    }
  }

  /**
   * Validates the canonical AI response.
   *
   * @param {*} response AI response.
   */
  function validateAIResponse_(response) {
    if (
      !response ||
      typeof response !== "object" ||
      Array.isArray(response)
    ) {
      throw new Error(
        "AI service returned an invalid response."
      );
    }

    if (response.success !== true) {
      throw new Error(
        "AI service did not report success."
      );
    }

    if (
      !response.data ||
      typeof response.data !== "object" ||
      Array.isArray(response.data)
    ) {
      throw new Error(
        "AI service returned no structured script data."
      );
    }
  }

  /**
   * Logs workflow start without hiding the real workflow
   * if logging itself fails.
   */
  function safeLogStarted_(
    runId,
    action,
    message
  ) {
    try {
      LoggingService.started(
        runId,
        action,
        message
      );
    } catch (error) {
      Logger.log(
        "Unable to write start log: " +
          error.message
      );
    }
  }

  /**
   * Logs workflow success safely.
   */
  function safeLogSuccess_(
    runId,
    action,
    message
  ) {
    try {
      LoggingService.success(
        runId,
        action,
        message
      );
    } catch (error) {
      Logger.log(
        "Unable to write success log: " +
          error.message
      );
    }
  }

  /**
   * Logs workflow failure safely.
   */
  function safeLogFailure_(
    runId,
    action,
    message,
    error
  ) {
    try {
      LoggingService.failure(
        runId,
        action,
        message,
        error
      );
    } catch (loggingError) {
      Logger.log(
        "Unable to write failure log: " +
          loggingError.message
      );
    }
  }

  /**
   * Logs a non-fatal warning safely.
   */
  function safeLogWarning_(
    runId,
    action,
    message,
    error
  ) {
    try {
      LoggingService.log({
        runId: runId,
        action: action,
        status:
          LoggingService.STATUS.WARNING,
        message: message,
        errorDetails: error
      });
    } catch (loggingError) {
      Logger.log(
        "Unable to write warning log: " +
          loggingError.message
      );
    }
  }

  /**
   * Creates a workflow run ID.
   *
   * @return {string} Run ID.
   */
  function createScriptRunId_() {
    return (
      "RUN-SCRIPT-" +
      Utilities.getUuid()
        .slice(0, 8)
        .toUpperCase()
    );
  }

  /*
   * The helpers below live in sibling modules:
   *   Script_Engine_Inputs.js
   *   Script_Engine_Prompt.js
   *   Script_Engine_Repair.js
   *   Script_Engine_Results.js
   * Their private names are kept here as one-line delegates so every call site in
   * this file is unchanged. Each module is looked up when called, never while this
   * file loads, so file load order does not matter.
   */
  function normaliseIdea_(idea) { return ScriptEngineInputs.normaliseIdea(idea); }
  function resolveOptions_(options) { return ScriptEngineInputs.resolveOptions(options); }

  function buildPrompt_(idea, options) { return ScriptEnginePrompt.buildPrompt(idea, options); }

  function normaliseGeneratedTiming_(generatedScript) { return ScriptEngineRepair.normaliseGeneratedTiming(generatedScript); }
  function buildCorrectionPrompt_(originalPrompt, rejectedScript, validationError, idea, options, nextAttempt) { return ScriptEngineRepair.buildCorrectionPrompt(originalPrompt, rejectedScript, validationError, idea, options, nextAttempt); }

  let scriptEngineResults_ = null;

  function getScriptEngineResults_() {
    if (!scriptEngineResults_) {
      scriptEngineResults_ = ScriptEngineResults.forEngine(ENGINE_VERSION, ACTION);
    }

    return scriptEngineResults_;
  }

  function combineAIResponses_(responses) { return getScriptEngineResults_().combineAIResponses(responses); }
  function createScriptModel_(idea, promptResult, aiResponse, validationResult, formattingResult, options, runId) { return getScriptEngineResults_().createScriptModel(idea, promptResult, aiResponse, validationResult, formattingResult, options, runId); }
  function buildWorkflowResult_(data) { return getScriptEngineResults_().buildWorkflowResult(data); }
  function createEngineError_(originalError, runId, ideaId) { return getScriptEngineResults_().createEngineError(originalError, runId, ideaId); }
  function clone_(value) { return getScriptEngineResults_().clone(value); }

  return {
    generateScript: generateScript,
    generatePreview: generatePreview,
    prepareRequest: prepareRequest,

    getEngineVersion: function () {
      return ENGINE_VERSION;
    },

    // Exposed only so Tests/ScriptDurationValidation_Tests.js can exercise the honest
    // duration-estimate logic directly with fixture data, with no AI call involved.
    __test_normaliseGeneratedTiming: normaliseGeneratedTiming_,

    // Exposed only so Tests/PromptAlignment_Tests.js can exercise correction-prompt text
    // with a synthetic validation error, with no AI call involved.
    __test_buildCorrectionPrompt: buildCorrectionPrompt_,

    // Exposed only so Tests/ScriptEngineOptionsResolution_Tests.js can exercise option
    // resolution directly, with no AI call involved.
    __test_resolveOptions: resolveOptions_
  };
})();

/**
 * Backwards-compatible workflow wrapper.
 *
 * @param {Object} idea Source idea.
 * @param {Object=} options Workflow options.
 * @return {Object} Workflow result.
 */
function generateScriptWorkflow(
  idea,
  options
) {
  return ScriptEngine.generateScript(
    idea,
    options || {}
  );
}
