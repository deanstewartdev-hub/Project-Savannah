/****************************************************
 * Project Savannah v1.1
 * Idea_Engine.js
 *
 * Purpose:
 * Coordinate the idea-generation workflow.
 *
 * Responsibilities:
 * - Load idea-generation settings.
 * - Build the idea-generation prompt.
 * - Select the expected response schema.
 * - Request ideas through AIService.
 * - Validate the returned idea collection.
 * - Save ideas through IdeasRepository.
 *
 * Must not:
 * - Call OpenAI directly.
 * - Access sheet ranges directly.
 * - Construct provider-specific payloads.
 ****************************************************/

/**
 * Generates and saves video ideas.
 *
 * @return {Object} Workflow result.
 */
function generateIdeasWorkflow() {
  const niche = Settings.getNiche();
  const targetAudience = Settings.getTargetAudience();
  const ideasPerRun = Settings.getIdeasPerRun();

  const prompt = buildVideoIdeasPrompt(
    niche,
    targetAudience,
    ideasPerRun
  );

  const response = callAIService(prompt, {
    temperature: Settings.getTemperature(),
    maxTokens: Settings.getMaxTokens(),
    responseFormat: "json_schema",
    schema: Schemas.getVideoIdeasSchema(),
    systemMessage:
      "You are Project Savannah, an AI content strategist " +
      "for YouTube Shorts. Produce original video ideas and " +
      "return only data matching the supplied schema."
  });

  validateGeneratedIdeas_(response.data, ideasPerRun);

  const saveResult = IdeasRepository.saveIdeas(
    response.data.ideas
  );

  const result = {
    success: true,
    runId: saveResult.runId,
    generatedCount: response.data.ideas.length,
    savedCount: saveResult.savedCount,
    provider: response.provider,
    model: response.model,
    usage: response.usage
  };

  Logger.log(
    JSON.stringify(result, null, 2)
  );

  return result;
}

/**
 * Validates the idea-generation response before persistence.
 *
 * @param {Object} responseData Parsed AI response.
 * @param {number} expectedCount Expected number of ideas.
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
    responseData.ideas.length !== expectedCount
  ) {
    throw new Error(
      "AI returned " +
      responseData.ideas.length +
      " ideas, but " +
      expectedCount +
      " were requested."
    );
  }

  responseData.ideas.forEach(function (idea, index) {
    if (!idea || typeof idea !== "object") {
      throw new Error(
        "Idea " + (index + 1) + " is invalid."
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
      typeof idea.targetAudience !== "string"
    ) {
      throw new Error(
        "Idea " +
        (index + 1) +
        " is missing targetAudience."
      );
    }
  });
}/****************************************************
 * Project Savannah v1.0
 * IdeaEngine.gs
 * Purpose: Idea generation workflow
 ****************************************************/

function generateIdeasWorkflow() {

  const niche = Settings.getNiche();
  const targetAudience = Settings.getTargetAudience();
  const ideasPerRun = Settings.getIdeasPerRun();

  const prompt = buildVideoIdeasPrompt(
    niche,
    targetAudience,
    ideasPerRun
  );

  const response = callAIService(prompt, {
    temperature: Settings.getTemperature(),
    maxTokens: Settings.getMaxTokens(),
    responseFormat: "json"
  });

  IdeasRepository.saveIdeas(response.data.ideas);

  Logger.log(response);

    Logger.log(
    response.data.ideas.length +
    " ideas successfully generated and saved."
  );

}