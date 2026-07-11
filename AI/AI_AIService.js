/****************************************************
 * Project Savannah v1.1
 * AI_AIService.js
 *
 * Purpose:
 * Provider-independent AI service layer.
 *
 * Responsibilities:
 * - Resolve shared AI configuration.
 * - Validate provider-independent request options.
 * - Route requests to the configured AI provider.
 *
 * Must not:
 * - Contain domain-specific prompts.
 * - Select idea or script schemas automatically.
 * - Access Google Sheets directly.
 ****************************************************/

/**
 * Sends a provider-independent AI request.
 *
 * @param {string} prompt Prompt sent to the AI provider.
 * @param {Object=} options Request configuration.
 * @return {Object} Normalised provider response.
 */
function callAIService(prompt, options) {
  const requestOptions = options || {};

  validateAIServiceRequest_(prompt, requestOptions);

  const provider = Settings.getProvider();
  const model = Settings.getModel();

  const providerRequest = {
    provider: provider,
    model: model,
    prompt: prompt,

    temperature: resolveAIOption_(
      requestOptions.temperature,
      Settings.getTemperature()
    ),

    maxTokens: resolveAIOption_(
      requestOptions.maxTokens,
      Settings.getMaxTokens()
    ),

    responseFormat:
      requestOptions.responseFormat || "text",

    schema:
      requestOptions.schema || null,

    systemMessage:
      requestOptions.systemMessage ||
      "You are Project Savannah, an AI content production assistant."
  };

  if (provider === "OpenAI") {
    return callOpenAI(providerRequest);
  }

  throw new Error(
    "Unsupported AI provider: " + provider
  );
}

/**
 * Validates a provider-independent AI request.
 *
 * @param {string} prompt AI prompt.
 * @param {Object} options Request options.
 */
function validateAIServiceRequest_(prompt, options) {
  if (
    !prompt ||
    typeof prompt !== "string" ||
    !prompt.trim()
  ) {
    throw new Error(
      "AI prompt must be a non-empty string."
    );
  }

  const responseFormat =
    options.responseFormat || "text";

  const supportedFormats = [
    "text",
    "json",
    "json_schema"
  ];

  if (
    supportedFormats.indexOf(responseFormat) === -1
  ) {
    throw new Error(
      "Unsupported AI response format: " +
      responseFormat
    );
  }

  if (
    responseFormat === "json_schema" &&
    (
      !options.schema ||
      typeof options.schema !== "object"
    )
  ) {
    throw new Error(
      "A schema must be supplied when " +
      "responseFormat is json_schema."
    );
  }

  if (
    options.temperature !== undefined &&
    options.temperature !== null &&
    (
      typeof options.temperature !== "number" ||
      options.temperature < 0 ||
      options.temperature > 2
    )
  ) {
    throw new Error(
      "AI temperature must be a number between 0 and 2."
    );
  }

  if (
    options.maxTokens !== undefined &&
    options.maxTokens !== null &&
    (
      typeof options.maxTokens !== "number" ||
      options.maxTokens <= 0
    )
  ) {
    throw new Error(
      "AI maxTokens must be a positive number."
    );
  }
}

/**
 * Returns an explicitly supplied option or its fallback.
 *
 * This preserves valid values such as temperature 0.
 *
 * @param {*} value Candidate value.
 * @param {*} fallback Fallback value.
 * @return {*} Resolved value.
 */
function resolveAIOption_(value, fallback) {
  return value !== undefined && value !== null
    ? value
    : fallback;
}

/**
 * Tests the provider-independent AI service.
 *
 * @return {Object} AI provider response.
 */
function testAIServiceLayer() {
  const testPrompt = [
    "Confirm that the Project Savannah AI service is operational.",
    "Return only data matching the supplied schema."
  ].join("\n");

  const testSchema = {
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
      required: [
        "status",
        "message"
      ]
    }
  };

  const response = callAIService(testPrompt, {
    temperature: 0.2,
    maxTokens: 200,
    responseFormat: "json_schema",
    schema: testSchema,
    systemMessage:
      "You are testing the Project Savannah AI service. " +
      "Return only data matching the supplied schema."
  });

  Logger.log(
    JSON.stringify(response, null, 2)
  );

  Logger.log(
    "AI Service Layer test completed successfully."
  );

  return response;
}function testAIServiceLayer() {
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
  Logger.log("AI Service Layer test completed successfully.");

  return response;
}