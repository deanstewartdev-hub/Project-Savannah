/****************************************************
 * Project Savannah
 * AI_AIService_Requests.js
 *
 * Purpose:
 * Validate an AI request and turn it into the normalised request the
 * service executes: prompt, options, schema, retry limits, and the
 * configured provider and model. Makes no provider call.
 *
 * Split out of AI/AI_AIService.js (modular refactor, November 2026). The function
 * bodies are unchanged. AIService remains the public entry point; nothing outside
 * it should call this module directly.
 ****************************************************/

const AIServiceRequests = (() => {
  const DEFAULT_SYSTEM_MESSAGE =
    "You are Project Savannah, an AI content production assistant.";

  const DEFAULT_RETRY_OPTIONS = Object.freeze({
    maxAttempts: 3,
    initialDelayMilliseconds: 750,
    backoffMultiplier: 2
  });

  // Helpers owned by sibling modules are looked up when called, so file load order never matters.
  function cloneObject_(value) { return AIServiceValues.cloneObject(value); }
  function createAIServiceError_(message) { return AIServiceValues.createAIServiceError(message); }
  function normaliseOptionalString_(value) { return AIServiceValues.normaliseOptionalString(value); }

  /**
   * Builds this module's helpers for one owner.
   *
   * @param {string} RESPONSE_FORMATS Value supplied by AIService.
   * @return {Object} Helpers.
   */
  function forService(RESPONSE_FORMATS) {
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

    return {
      createRequest: createRequest_,
      validateSchema: validateSchema_
    };
  }

  return {
    forService: forService
  };
})();
