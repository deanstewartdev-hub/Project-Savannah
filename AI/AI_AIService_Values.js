/****************************************************
 * Project Savannah
 * AI_AIService_Values.js
 *
 * Purpose:
 * Small helpers shared by the AI service modules: the AIServiceError type,
 * JSON cloning and merging, and optional-string normalisation.
 *
 * Split out of AI/AI_AIService.js (modular refactor, November 2026). The function
 * bodies are unchanged. AIService remains the public entry point; nothing outside
 * it should call this module directly.
 ****************************************************/

const AIServiceValues = (() => {
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

  return {
    createAIServiceError: createAIServiceError_,
    cloneObject: cloneObject_,
    mergeObjects: mergeObjects_,
    normaliseOptionalString: normaliseOptionalString_
  };
})();
