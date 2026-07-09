/****************************************************
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