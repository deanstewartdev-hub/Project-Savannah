/****************************************************
 * Project Savannah v1.0
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
    responseFormat: options && options.responseFormat ? options.responseFormat : "json"
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
    responseFormat: "json"
  });

  Logger.log(response);

  SpreadsheetApp.getUi().alert("AI Service Layer test complete. Check execution log.");
}