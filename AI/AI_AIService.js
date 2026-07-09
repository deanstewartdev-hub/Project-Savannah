/****************************************************
 * Project Savannah v1.0.1
 * AIService.gs
 * Purpose: Provider-independent AI service layer
 ****************************************************/

function callAIService(prompt, options) {
  const provider = Settings.getProvider();
  const model = Settings.getModel();

  const requestOptions = {
    provider: provider,
    model: model,
    prompt: prompt,
    temperature: options && options.temperature ? options.temperature : Settings.getTemperature(),
    maxTokens: options && options.maxTokens ? options.maxTokens : Settings.getMaxTokens(),
    responseFormat: options && options.responseFormat ? options.responseFormat : "json",
    schema: options && options.schema ? options.schema : Schemas.getVideoIdeasSchema(),
    systemMessage: options && options.systemMessage
      ? options.systemMessage
      : "You are Project Savannah, an AI content strategist for YouTube Shorts. Return only structured JSON."
  };

  if (provider === "OpenAI") {
    return callOpenAI(requestOptions);
  }

  throw new Error("Unsupported AI provider: " + provider);
}

function testAIServiceLayer() {
  const testPrompt = `
Return ONLY valid JSON:

{
  "status": "success",
  "message": "AI Service Layer is ready"
}
`;

  const response = callAIService(testPrompt, {
    temperature: 0.2,
    maxTokens: 200,
    responseFormat: "json",
    schema: {
      type: "json_schema",
      name: "project_savannah_ai_service_test",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: {
            type: "string"
          },
          message: {
            type: "string"
          }
        },
        required: ["status", "message"]
      }
    }
  });

  Logger.log(response);

  SpreadsheetApp.getUi().alert("AI Service Layer test complete. Check execution log.");
}