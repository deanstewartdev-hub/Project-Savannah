/****************************************************
 * Project Savannah
 * AI_AIService_Responses.js
 *
 * Purpose:
 * Turn a raw provider response into the provider-independent response the
 * rest of Savannah consumes: data, normalised token usage, request echo
 * and execution timing.
 *
 * Split out of AI/AI_AIService.js (modular refactor, November 2026). The function
 * bodies are unchanged. AIService remains the public entry point; nothing outside
 * it should call this module directly.
 ****************************************************/

const AIServiceResponses = (() => {
  // Helpers owned by sibling modules are looked up when called, so file load order never matters.
  function cloneObject_(value) { return AIServiceValues.cloneObject(value); }
  function createAIServiceError_(message) { return AIServiceValues.createAIServiceError(message); }
  function normaliseOptionalString_(value) { return AIServiceValues.normaliseOptionalString(value); }

  /**
   * Builds this module's helpers for one owner.
   *
   * @param {string} SERVICE_VERSION Value supplied by AIService.
   * @return {Object} Helpers.
   */
  function forService(SERVICE_VERSION) {
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

    return {
      normaliseResponse: normaliseResponse_
    };
  }

  return {
    forService: forService
  };
})();
