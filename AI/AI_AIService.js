/****************************************************
 * Project Savannah v1.2
 * AI_AIService.js
 *
 * Purpose:
 * Provide a provider-independent AI service facade.
 *
 * Responsibilities:
 * - Validate provider-independent AI requests.
 * - Resolve shared AI configuration.
 * - Route requests to the configured provider.
 * - Retry temporary provider failures.
 * - Normalise provider responses.
 * - Expose convenience methods for structured content.
 *
 * Must not:
 * - Contain domain-specific prompts.
 * - Access Google Sheets directly.
 * - Persist ideas or scripts.
 * - Perform script validation or formatting.
 ****************************************************/

const AIService = (() => {
  const SERVICE_VERSION = "ai-service-v1.0";

  const PROVIDERS = Object.freeze({
    OPENAI: "OpenAI"
  });

  const RESPONSE_FORMATS = Object.freeze({
    TEXT: "text",
    JSON: "json",
    JSON_SCHEMA: "json_schema"
  });

  /**
   * Sends a provider-independent AI request.
   *
   * @param {string} prompt Prompt sent to the provider.
   * @param {Object=} options Request configuration.
   * @return {Object} Normalised AI service response.
   */
  function generate(prompt, options) {
    const request = createRequest_(prompt, options || {});
    const startedAt = new Date();
    const providerResponse = executeWithRetry_(request);
    const completedAt = new Date();

    return normaliseResponse_(
      providerResponse,
      request,
      startedAt,
      completedAt
    );
  }

  /**
   * Generates structured JSON content.
   *
   * @param {string} prompt Prompt sent to the provider.
   * @param {Object} schema Structured-output schema.
   * @param {Object=} options Additional request options.
   * @return {Object} Normalised AI service response.
   */
  function generateStructuredContent(
    prompt,
    schema,
    options
  ) {
    validateSchema_(schema);

    const requestOptions = mergeObjects_(
      options || {},
      {
        responseFormat:
          RESPONSE_FORMATS.JSON_SCHEMA,
        schema: schema
      }
    );

    return generate(prompt, requestOptions);
  }

  /**
   * Executes an AI request with retry handling.
   *
   * @param {Object} request Provider-independent request.
   * @return {Object} Provider response.
   */
  function executeWithRetry_(request) {
    let lastError = null;
    let delay =
      request.retry.initialDelayMilliseconds;

    for (
      let attempt = 1;
      attempt <= request.retry.maxAttempts;
      attempt++
    ) {
      try {
        const response = routeRequest_(request);

        if (
          !response ||
          typeof response !== "object"
        ) {
          throw createAIServiceError_(
            "AI provider returned an invalid response."
          );
        }

        response.attemptCount = attempt;

        return response;
      } catch (error) {
        lastError = error;

        if (
          attempt >= request.retry.maxAttempts ||
          !isRetryableError_(error)
        ) {
          break;
        }

        Utilities.sleep(delay);

        delay = Math.round(
          delay *
            request.retry.backoffMultiplier
        );
      }
    }

    throw wrapProviderError_(
      lastError,
      request
    );
  }

  /**
   * Routes a request to the configured provider.
   *
   * @param {Object} request Provider request.
   * @return {Object} Provider response.
   */
  function routeRequest_(request) {
    switch (request.provider) {
      case PROVIDERS.OPENAI:
        return callOpenAI({
          provider: request.provider,
          model: request.model,
          prompt: request.prompt,
          temperature:
            request.temperature,
          maxTokens: request.maxTokens,
          responseFormat:
            request.responseFormat,
          schema: request.schema,
          systemMessage:
            request.systemMessage
        });

      default:
        throw createAIServiceError_(
          "Unsupported AI provider: " +
            request.provider +
            "."
        );
    }
  }

  /**
   * Determines whether an error can be retried.
   *
   * @param {*} error Provider error.
   * @return {boolean} True for temporary failures.
   */
  function isRetryableError_(error) {
    const message = String(
      error && error.message
        ? error.message
        : error || ""
    ).toLowerCase();

    const retryableSignals = [
      "429",
      "rate limit",
      "timeout",
      "timed out",
      "temporarily unavailable",
      "service unavailable",
      "internal server error",
      "bad gateway",
      "gateway timeout",
      "api error 500",
      "api error 502",
      "api error 503",
      "api error 504"
    ];

    return retryableSignals.some(
      function (signal) {
        return (
          message.indexOf(signal) !== -1
        );
      }
    );
  }

  /**
   * Wraps a provider error.
   *
   * @param {*} error Original error.
   * @param {Object} request Request context.
   * @return {Error} AI service error.
   */
  function wrapProviderError_(
    error,
    request
  ) {
    const detail = String(
      error && error.message
        ? error.message
        : error || "Unknown provider error."
    );

    const wrapped =
      createAIServiceError_(
        request.provider +
          " request failed: " +
          detail
      );

    wrapped.provider =
      request.provider;

    wrapped.model =
      request.model;

    wrapped.originalError =
      detail;

    return wrapped;
  }

  /*
   * The helpers below live in sibling modules:
   *   AI_AIService_Values.js
   *   AI_AIService_Requests.js
   *   AI_AIService_Responses.js
   * Their private names are kept here as one-line delegates so every call site in
   * this file is unchanged. Each module is looked up when called, never while this
   * file loads, so file load order does not matter.
   */
  function createAIServiceError_(message) { return AIServiceValues.createAIServiceError(message); }
  function cloneObject_(value) { return AIServiceValues.cloneObject(value); }
  function mergeObjects_(base, overrides) { return AIServiceValues.mergeObjects(base, overrides); }

  let aiServiceRequests_ = null;

  function getAIServiceRequests_() {
    if (!aiServiceRequests_) {
      aiServiceRequests_ = AIServiceRequests.forService(RESPONSE_FORMATS);
    }

    return aiServiceRequests_;
  }

  function createRequest_(prompt, options) { return getAIServiceRequests_().createRequest(prompt, options); }
  function validateSchema_(schema) { return getAIServiceRequests_().validateSchema(schema); }

  let aiServiceResponses_ = null;

  function getAIServiceResponses_() {
    if (!aiServiceResponses_) {
      aiServiceResponses_ = AIServiceResponses.forService(SERVICE_VERSION);
    }

    return aiServiceResponses_;
  }

  function normaliseResponse_(providerResponse, request, startedAt, completedAt) { return getAIServiceResponses_().normaliseResponse(providerResponse, request, startedAt, completedAt); }

  return {
    generate: generate,

    generateStructuredContent:
      generateStructuredContent,

    getProviders: function () {
      return cloneObject_(PROVIDERS);
    },

    getResponseFormats: function () {
      return cloneObject_(
        RESPONSE_FORMATS
      );
    },

    getServiceVersion: function () {
      return SERVICE_VERSION;
    }
  };
})();

/**
 * Backwards-compatible wrapper for existing modules.
 *
 * Existing code may continue calling:
 *
 * callAIService(prompt, options)
 *
 * @param {string} prompt AI prompt.
 * @param {Object=} options Request options.
 * @return {Object} Normalised response.
 */
function callAIService(prompt, options) {
  return AIService.generate(
    prompt,
    options || {}
  );
}
