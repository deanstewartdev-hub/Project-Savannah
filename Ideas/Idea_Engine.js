/****************************************************
 * Project Savannah v1.2
 * Idea_Engine.js
 *
 * Purpose:
 * Coordinate the complete idea-generation workflow.
 *
 * Responsibilities:
 * - Load settings.
 * - Build the idea prompt.
 * - Call AIService.
 * - Validate generated ideas.
 * - Save ideas.
 * - Record usage cost.
 * - Record workflow activity.
 *
 * Must not:
 * - Access sheet ranges directly.
 * - Build provider-specific payloads.
 * - Display frontend UI.
 ****************************************************/

/**
 * Generates, validates, saves and records video ideas.
 *
 * @return {Object} Workflow result.
 */
function generateIdeasWorkflow() {
  const runId = createRunId();
  const action = "IDEA_GENERATION";

  LoggingService.started(
    runId,
    action,
    "Idea generation started."
  );

  try {
    const niche = Settings.getNiche();

    const targetAudience =
      Settings.getTargetAudience();

    const ideasPerRun =
      Settings.getIdeasPerRun();

    const prompt = buildVideoIdeasPrompt(
      niche,
      targetAudience,
      ideasPerRun
    );

    const response = callAIService(prompt, {
      temperature:
        Settings.getTemperature(),

      maxTokens:
        Settings.getMaxTokens(),

      responseFormat:
        "json_schema",

      schema:
        Schemas.getVideoIdeasSchema(),

      systemMessage:
        "You are Project Savannah, an AI content " +
        "strategist for YouTube Shorts. Produce " +
        "original video ideas and return only data " +
        "matching the supplied schema."
    });

    validateGeneratedIdeas_(
      response.data,
      ideasPerRun
    );

    const saveResult =
      IdeasRepository.saveIdeas(
        response.data.ideas,
        {
          runId: runId,
          model:
            response.model ||
            Settings.getModel(),

          promptVersion:
            APP.PROMPT_VERSION
        }
      );

    let costRecord = null;

    try {
      costRecord =
        CostService.recordAIUsage({
          runId: runId,

          model:
            response.model ||
            Settings.getModel(),

          usage:
            response.usage || {},

          action: action
        });
    } catch (costError) {
      LoggingService.log({
        runId: runId,
        action: "COST_RECORDING",
        status:
          LoggingService.STATUS.WARNING,
        message:
          "Ideas were saved, but AI cost tracking failed.",
        errorDetails: costError
      });
    }

    LoggingService.success(
      runId,
      action,
      saveResult.savedCount +
        " ideas successfully generated and saved."
    );

    const result = {
      success: true,
      runId: runId,
      generatedCount:
        response.data.ideas.length,
      savedCount:
        saveResult.savedCount,
      provider:
        response.provider,
      model:
        response.model ||
        Settings.getModel(),
      usage:
        response.usage || {},
      estimatedCost:
        costRecord
          ? costRecord.estimatedCost
          : 0
    };

    Logger.log(
      JSON.stringify(result, null, 2)
    );

    return result;
  } catch (error) {
    try {
      LoggingService.failure(
        runId,
        action,
        "Idea generation failed.",
        error
      );
    } catch (loggingError) {
      Logger.log(
        "Unable to write failure log: " +
        (
          loggingError.message ||
          loggingError
        )
      );
    }

    throw error;
  }
}

/**
 * Validates generated ideas before persistence.
 *
 * @param {Object} responseData Parsed AI output.
 * @param {number} expectedCount Expected idea count.
 */
function validateGeneratedIdeas_(
  responseData,
  expectedCount
) {
  if (
    !responseData ||
    typeof responseData !== "object"
  ) {
    throw new Error(
      "AI returned no valid idea-generation data."
    );
  }

  if (!Array.isArray(responseData.ideas)) {
    throw new Error(
      "AI response does not contain an ideas array."
    );
  }

  if (responseData.ideas.length === 0) {
    throw new Error(
      "AI returned an empty ideas array."
    );
  }

  if (
    expectedCount &&
    responseData.ideas.length !==
      expectedCount
  ) {
    throw new Error(
      "AI returned " +
      responseData.ideas.length +
      " ideas, but " +
      expectedCount +
      " were requested."
    );
  }

  responseData.ideas.forEach(
    function (idea, index) {
      if (!idea || typeof idea !== "object") {
        throw new Error(
          "Idea " +
          (index + 1) +
          " is invalid."
        );
      }

      if (
        !idea.videoIdea ||
        typeof idea.videoIdea !== "string"
      ) {
        throw new Error(
          "Idea " +
          (index + 1) +
          " is missing videoIdea."
        );
      }

      if (
        !idea.hook ||
        typeof idea.hook !== "string"
      ) {
        throw new Error(
          "Idea " +
          (index + 1) +
          " is missing hook."
        );
      }

      if (
        !idea.targetAudience ||
        typeof idea.targetAudience !==
          "string"
      ) {
        throw new Error(
          "Idea " +
          (index + 1) +
          " is missing targetAudience."
        );
      }
    }
  );
}

/**
 * Tests the complete production idea workflow.
 *
 * This calls OpenAI and creates real Ideas,
 * Logs and Costs records.
 *
 * @return {Object} Workflow result.
 */
function testIdeaGenerationWithTracking() {
  const result =
    generateIdeasWorkflow();

  if (
    !result ||
    result.success !== true ||
    result.savedCount <= 0
  ) {
    throw new Error(
      "Tracked idea-generation test failed."
    );
  }

  Logger.log(
    "Tracked idea-generation test completed successfully."
  );

  return result;
}