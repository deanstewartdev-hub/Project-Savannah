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

  const DEFAULT_SYSTEM_MESSAGE =
    "You are Project Savannah, an AI content production assistant.";

  const DEFAULT_RETRY_OPTIONS = Object.freeze({
    maxAttempts: 3,
    initialDelayMilliseconds: 750,
    backoffMultiplier: 2
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
   * Creates a provider-independent request.
   *
   * @param {string} prompt AI prompt.
   * @param {Object} options Request options.
   * @return {Object} Normalised request.
   */
  function createRequest_(prompt, options) {
    validatePrompt_(prompt);
    validateOptions_(options);

    const provider = resolveProvider_();
    const model = resolveModel_();

    return {
      provider: provider,
      model: model,

      prompt: String(prompt).trim(),

      temperature: resolveOption_(
        options.temperature,
        Settings.getTemperature()
      ),

      maxTokens: resolveOption_(
        options.maxTokens,
        Settings.getMaxTokens()
      ),

      responseFormat:
        options.responseFormat ||
        RESPONSE_FORMATS.TEXT,

      schema: options.schema || null,

      systemMessage:
        normaliseOptionalString_(
          options.systemMessage
        ) || DEFAULT_SYSTEM_MESSAGE,

      retry: normaliseRetryOptions_(
        options.retry
      ),

      metadata: cloneObject_(
        options.metadata || {}
      )
    };
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
   * Converts a provider response into the canonical
   * AI service response contract.
   *
   * @param {Object} providerResponse Provider response.
   * @param {Object} request Original request.
   * @param {Date} startedAt Start time.
   * @param {Date} completedAt Completion time.
   * @return {Object} Normalised response.
   */
  function normaliseResponse_(
    providerResponse,
    request,
    startedAt,
    completedAt
  ) {
    if (
      providerResponse.success !== true
    ) {
      throw createAIServiceError_(
        "AI provider did not report a successful response."
      );
    }

    if (
      providerResponse.data === undefined ||
      providerResponse.data === null
    ) {
      throw createAIServiceError_(
        "AI provider returned no usable data."
      );
    }

    const durationMilliseconds =
      completedAt.getTime() -
      startedAt.getTime();

    return {
      success: true,

      provider:
        providerResponse.provider ||
        request.provider,

      model:
        providerResponse.model ||
        request.model,

      data: cloneObject_(
        providerResponse.data
      ),

      usage: normaliseUsage_(
        providerResponse.usage
      ),

      request: {
        responseFormat:
          request.responseFormat,

        temperature:
          request.temperature,

        maxTokens:
          request.maxTokens,

        schemaName:
          resolveSchemaName_(
            request.schema
          ),

        metadata: cloneObject_(
          request.metadata
        )
      },

      execution: {
        attemptCount:
          Number(
            providerResponse.attemptCount ||
              1
          ),

        startedAt:
          startedAt.toISOString(),

        completedAt:
          completedAt.toISOString(),

        durationMilliseconds:
          durationMilliseconds
      },

      serviceVersion:
        SERVICE_VERSION
    };
  }

  /**
   * Normalises token-usage data across providers.
   *
   * OpenAI Responses API commonly returns:
   * - input_tokens
   * - output_tokens
   * - total_tokens
   *
   * @param {*} usage Provider usage.
   * @return {Object} Normalised usage.
   */
  function normaliseUsage_(usage) {
    const source =
      usage &&
      typeof usage === "object" &&
      !Array.isArray(usage)
        ? usage
        : {};

    const inputTokens = normaliseTokenCount_(
      firstDefined_([
        source.input_tokens,
        source.prompt_tokens,
        source.inputTokens
      ])
    );

    const outputTokens = normaliseTokenCount_(
      firstDefined_([
        source.output_tokens,
        source.completion_tokens,
        source.outputTokens
      ])
    );

    const suppliedTotal =
      normaliseTokenCount_(
        firstDefined_([
          source.total_tokens,
          source.totalTokens
        ])
      );

    return {
      inputTokens: inputTokens,
      outputTokens: outputTokens,
      totalTokens:
        suppliedTotal ||
        inputTokens + outputTokens,

      raw: cloneObject_(source)
    };
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
   * Validates a prompt.
   *
   * @param {*} prompt Prompt candidate.
   */
  function validatePrompt_(prompt) {
    if (
      typeof prompt !== "string" ||
      !prompt.trim()
    ) {
      throw createAIServiceError_(
        "AI prompt must be a non-empty string."
      );
    }
  }

  /**
   * Validates request options.
   *
   * @param {Object} options Request options.
   */
  function validateOptions_(options) {
    if (
      !options ||
      typeof options !== "object" ||
      Array.isArray(options)
    ) {
      throw createAIServiceError_(
        "AI request options must be an object."
      );
    }

    const responseFormat =
      options.responseFormat ||
      RESPONSE_FORMATS.TEXT;

    const supportedFormats = [
      RESPONSE_FORMATS.TEXT,
      RESPONSE_FORMATS.JSON,
      RESPONSE_FORMATS.JSON_SCHEMA
    ];

    if (
      supportedFormats.indexOf(
        responseFormat
      ) === -1
    ) {
      throw createAIServiceError_(
        "Unsupported AI response format: " +
          responseFormat +
          "."
      );
    }

    if (
      responseFormat ===
        RESPONSE_FORMATS.JSON_SCHEMA &&
      !options.schema
    ) {
      throw createAIServiceError_(
        "A schema is required when responseFormat is json_schema."
      );
    }

    if (
      options.schema !== undefined &&
      options.schema !== null
    ) {
      validateSchema_(options.schema);
    }

    if (
      options.temperature !== undefined &&
      options.temperature !== null
    ) {
      if (
        typeof options.temperature !==
          "number" ||
        !isFinite(options.temperature) ||
        options.temperature < 0 ||
        options.temperature > 2
      ) {
        throw createAIServiceError_(
          "AI temperature must be a number between 0 and 2."
        );
      }
    }

    if (
      options.maxTokens !== undefined &&
      options.maxTokens !== null
    ) {
      if (
        typeof options.maxTokens !==
          "number" ||
        !isFinite(options.maxTokens) ||
        options.maxTokens <= 0
      ) {
        throw createAIServiceError_(
          "AI maxTokens must be a positive number."
        );
      }
    }

    if (
      options.metadata !== undefined &&
      (
        typeof options.metadata !==
          "object" ||
        options.metadata === null ||
        Array.isArray(options.metadata)
      )
    ) {
      throw createAIServiceError_(
        "AI request metadata must be an object."
      );
    }
  }

  /**
   * Validates a structured-output schema.
   *
   * @param {*} schema Schema candidate.
   */
  function validateSchema_(schema) {
    if (
      !schema ||
      typeof schema !== "object" ||
      Array.isArray(schema)
    ) {
      throw createAIServiceError_(
        "AI schema must be a valid object."
      );
    }

    if (
      schema.type !== "json_schema"
    ) {
      throw createAIServiceError_(
        'AI schema type must be "json_schema".'
      );
    }

    if (
      typeof schema.name !== "string" ||
      !schema.name.trim()
    ) {
      throw createAIServiceError_(
        "AI schema name is required."
      );
    }

    if (
      !schema.schema ||
      typeof schema.schema !== "object" ||
      Array.isArray(schema.schema)
    ) {
      throw createAIServiceError_(
        "AI schema must contain a schema object."
      );
    }
  }

  /**
   * Normalises retry settings.
   *
   * @param {*} retryOptions Retry options.
   * @return {Object} Normalised retry configuration.
   */
  function normaliseRetryOptions_(
    retryOptions
  ) {
    if (
      retryOptions === undefined ||
      retryOptions === null
    ) {
      return cloneObject_(
        DEFAULT_RETRY_OPTIONS
      );
    }

    if (
      typeof retryOptions !== "object" ||
      Array.isArray(retryOptions)
    ) {
      throw createAIServiceError_(
        "AI retry options must be an object."
      );
    }

    const options = {
      maxAttempts: normalisePositiveInteger_(
        retryOptions.maxAttempts,
        DEFAULT_RETRY_OPTIONS.maxAttempts
      ),

      initialDelayMilliseconds:
        normaliseNonNegativeNumber_(
          retryOptions
            .initialDelayMilliseconds,
          DEFAULT_RETRY_OPTIONS
            .initialDelayMilliseconds
        ),

      backoffMultiplier:
        normalisePositiveNumber_(
          retryOptions.backoffMultiplier,
          DEFAULT_RETRY_OPTIONS
            .backoffMultiplier
        )
    };

    if (options.maxAttempts > 5) {
      throw createAIServiceError_(
        "AI retry maxAttempts cannot exceed 5."
      );
    }

    return options;
  }

  /**
   * Resolves the configured provider.
   *
   * @return {string} Provider name.
   */
  function resolveProvider_() {
    const provider = normaliseOptionalString_(
      Settings.getProvider()
    );

    if (!provider) {
      throw createAIServiceError_(
        "No AI provider is configured."
      );
    }

    return provider;
  }

  /**
   * Resolves the configured model.
   *
   * @return {string} Model name.
   */
  function resolveModel_() {
    const model = normaliseOptionalString_(
      Settings.getModel()
    );

    if (!model) {
      throw createAIServiceError_(
        "No AI model is configured."
      );
    }

    return model;
  }

  /**
   * Returns an explicitly supplied option or fallback.
   *
   * This preserves valid values such as temperature 0.
   *
   * @param {*} value Candidate value.
   * @param {*} fallback Fallback.
   * @return {*} Resolved value.
   */
  function resolveOption_(value, fallback) {
    return (
      value !== undefined &&
      value !== null
    )
      ? value
      : fallback;
  }

  /**
   * Resolves the schema name.
   *
   * @param {*} schema Structured schema.
   * @return {string} Schema name.
   */
  function resolveSchemaName_(schema) {
    if (
      !schema ||
      typeof schema !== "object"
    ) {
      return "";
    }

    return normaliseOptionalString_(
      schema.name
    );
  }

  /**
   * Returns the first defined value.
   *
   * @param {Array} values Candidate values.
   * @return {*} First defined value.
   */
  function firstDefined_(values) {
    for (
      let index = 0;
      index < values.length;
      index++
    ) {
      if (
        values[index] !== undefined &&
        values[index] !== null
      ) {
        return values[index];
      }
    }

    return undefined;
  }

  /**
   * Normalises a token count.
   *
   * @param {*} value Token candidate.
   * @return {number} Non-negative integer.
   */
  function normaliseTokenCount_(value) {
    const numericValue = Number(value);

    if (
      !isFinite(numericValue) ||
      numericValue < 0
    ) {
      return 0;
    }

    return Math.round(numericValue);
  }

  /**
   * Normalises a positive integer.
   *
   * @param {*} value Candidate.
   * @param {number} fallback Fallback.
   * @return {number} Positive integer.
   */
  function normalisePositiveInteger_(
    value,
    fallback
  ) {
    if (
      value === undefined ||
      value === null
    ) {
      return fallback;
    }

    const numericValue = Number(value);

    if (
      !Number.isInteger(numericValue) ||
      numericValue < 1
    ) {
      throw createAIServiceError_(
        "AI retry maxAttempts must be a positive integer."
      );
    }

    return numericValue;
  }

  /**
   * Normalises a non-negative number.
   *
   * @param {*} value Candidate.
   * @param {number} fallback Fallback.
   * @return {number} Non-negative number.
   */
  function normaliseNonNegativeNumber_(
    value,
    fallback
  ) {
    if (
      value === undefined ||
      value === null
    ) {
      return fallback;
    }

    const numericValue = Number(value);

    if (
      !isFinite(numericValue) ||
      numericValue < 0
    ) {
      throw createAIServiceError_(
        "AI retry delay must be a non-negative number."
      );
    }

    return numericValue;
  }

  /**
   * Normalises a positive number.
   *
   * @param {*} value Candidate.
   * @param {number} fallback Fallback.
   * @return {number} Positive number.
   */
  function normalisePositiveNumber_(
    value,
    fallback
  ) {
    if (
      value === undefined ||
      value === null
    ) {
      return fallback;
    }

    const numericValue = Number(value);

    if (
      !isFinite(numericValue) ||
      numericValue <= 0
    ) {
      throw createAIServiceError_(
        "AI retry backoffMultiplier must be a positive number."
      );
    }

    return numericValue;
  }

  /**
   * Normalises an optional string.
   *
   * @param {*} value Source value.
   * @return {string} Normalised string.
   */
  function normaliseOptionalString_(value) {
    if (
      value === undefined ||
      value === null
    ) {
      return "";
    }

    return String(value).trim();
  }

  /**
   * Merges two plain objects.
   *
   * @param {Object} base Base object.
   * @param {Object} overrides Override object.
   * @return {Object} Merged object.
   */
  function mergeObjects_(base, overrides) {
    const result = cloneObject_(
      base || {}
    );

    Object.keys(
      overrides || {}
    ).forEach(function (key) {
      result[key] = cloneObject_(
        overrides[key]
      );
    });

    return result;
  }

  /**
   * Creates a JSON-compatible deep clone.
   *
   * @param {*} value Source value.
   * @return {*} Clone.
   */
  function cloneObject_(value) {
    if (value === undefined) {
      return undefined;
    }

    return JSON.parse(
      JSON.stringify(value)
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

  /**
   * Creates an AI-service-specific error.
   *
   * @param {string} message Error detail.
   * @return {Error} AI service error.
   */
  function createAIServiceError_(message) {
    const error = new Error(
      "AI service error: " + message
    );

    error.name = "AIServiceError";

    return error;
  }

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

/**
 * Tests request validation without calling the provider.
 *
 * @return {boolean} True when invalid input is rejected.
 */
function testAIServiceRejectsInvalidPrompt() {
  try {
    AIService.generate("", {});
  } catch (error) {
    if (error.name !== "AIServiceError") {
      throw error;
    }

    Logger.log(error.message);
    Logger.log(
      "AI Service invalid-prompt test completed successfully."
    );

    return true;
  }

  throw new Error(
    "AI Service accepted an empty prompt."
  );
}

/**
 * Tests schema validation without calling the provider.
 *
 * @return {boolean} True when invalid schema is rejected.
 */
function testAIServiceRejectsInvalidSchema() {
  try {
    AIService.generateStructuredContent(
      "Return a structured result.",
      {
        type: "object"
      }
    );
  } catch (error) {
    if (error.name !== "AIServiceError") {
      throw error;
    }

    Logger.log(error.message);
    Logger.log(
      "AI Service invalid-schema test completed successfully."
    );

    return true;
  }

  throw new Error(
    "AI Service accepted an invalid schema."
  );
}

/**
 * Performs a real provider integration test.
 *
 * This test makes a small live AI request and may
 * incur a minimal API charge.
 *
 * @return {Object} AI service response.
 */
function testAIServiceLiveConnection() {
  const schema = {
    type: "json_schema",
    name:
      "project_savannah_ai_service_test",
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

  const response =
    AIService.generateStructuredContent(
      [
        "Confirm that the Project Savannah",
        "AI service is operational.",
        "Return status as success and",
        "a short confirmation message."
      ].join(" "),
      schema,
      {
        temperature: 0,
        maxTokens: 150,

        systemMessage:
          "You are testing the Project Savannah AI service. " +
          "Return only data matching the supplied schema.",

        retry: {
          maxAttempts: 2,
          initialDelayMilliseconds: 500,
          backoffMultiplier: 2
        },

        metadata: {
          testName:
            "AI Service live connection"
        }
      }
    );

  if (response.success !== true) {
    throw new Error(
      "AI Service live test did not succeed."
    );
  }

  if (
    !response.data ||
    typeof response.data.status !==
      "string" ||
    typeof response.data.message !==
      "string"
  ) {
    throw new Error(
      "AI Service live test returned an invalid data structure."
    );
  }

  if (
    response.serviceVersion !==
    AIService.getServiceVersion()
  ) {
    throw new Error(
      "AI Service returned the wrong service version."
    );
  }

  Logger.log(
    JSON.stringify(response, null, 2)
  );

  Logger.log(
    "AI Service live connection test completed successfully."
  );

  return response;
}

/**
 * Runs the safe AI Service unit tests.
 *
 * This function does not call the AI provider.
 *
 * @return {Object} Unit-test summary.
 */
function testAIServiceUnitTests() {
  testAIServiceRejectsInvalidPrompt();
  testAIServiceRejectsInvalidSchema();

  const result = {
    passed: true,
    testsRun: 2,
    liveProviderCalled: false,
    serviceVersion:
      AIService.getServiceVersion()
  };

  Logger.log(
    JSON.stringify(result, null, 2)
  );

  Logger.log(
    "All AI Service unit tests completed successfully."
  );

  return result;
}

/**
 * Runs unit tests followed by the live integration test.
 *
 * This function makes one real AI request.
 *
 * @return {Object} Full-test summary.
 */
function testAIServiceAll() {
  testAIServiceUnitTests();

  const liveResult =
    testAIServiceLiveConnection();

  const result = {
    passed: true,
    testsRun: 3,
    liveProviderCalled: true,
    provider:
      liveResult.provider,
    model:
      liveResult.model,
    serviceVersion:
      AIService.getServiceVersion()
  };

  Logger.log(
    JSON.stringify(result, null, 2)
  );

  Logger.log(
    "All AI Service tests completed successfully."
  );

  return result;
}