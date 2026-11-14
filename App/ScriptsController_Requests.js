/****************************************************
 * Project Savannah
 * ScriptsController_Requests.js
 *
 * Purpose:
 * Turn untrusted browser requests into safe, normalised input for the
 * Scripts controller: generation requests, list filters, IDs and limits.
 * Pure: no sheet, provider or logging access.
 *
 * Split out of App/ScriptsController.js (modular refactor, November 2026). The function
 * bodies are unchanged. ScriptsController remains the only public entry point; nothing
 * outside the controller should call this module directly.
 ****************************************************/

const ScriptsControllerRequests = (() => {
  const DEFAULT_LIST_LIMIT = 50;
  const MAX_LIST_LIMIT = 200;

  // Shared helpers are looked up when called, so file load order never matters.
  function firstNonEmptyString_(values) { return ScriptsControllerValues.firstNonEmptyString(values); }
  function normaliseOptionalString_(value) { return ScriptsControllerValues.normaliseOptionalString(value); }
  function createControllerError_(message) { return ScriptsControllerValues.createControllerError(message); }
  function clone_(value) { return ScriptsControllerValues.clone(value); }

  /**
   * Normalises a script-generation request.
   *
   * @param {*} request Frontend request.
   * @return {Object} Normalised request.
   * @private
   */
  function normaliseGenerateRequest_(
    request
  ) {
    if (
      !request ||
      typeof request !== "object" ||
      Array.isArray(request)
    ) {
      throw createControllerError_(
        "A script-generation request is required."
      );
    }

    const sourceIdea =
      request.idea &&
      typeof request.idea ===
        "object" &&
      !Array.isArray(
        request.idea
      )
        ? request.idea
        : request;

    const idea = {
      id:
        firstNonEmptyString_([
          sourceIdea.id,
          sourceIdea.ideaId,
          sourceIdea["Idea ID"],
          sourceIdea.ID
        ]),

      videoIdea:
        firstNonEmptyString_([
          sourceIdea.videoIdea,
          sourceIdea.title,
          sourceIdea.idea,
          sourceIdea.topic,
          sourceIdea["Video Idea"],
          sourceIdea.Title
        ]),

      hook:
        firstNonEmptyString_([
          sourceIdea.hook,
          sourceIdea.Hook
        ]),

      targetAudience:
        firstNonEmptyString_([
          sourceIdea.targetAudience,
          sourceIdea[
            "Target Audience"
          ],
          sourceIdea.audience
        ]),

      niche:
        firstNonEmptyString_([
          sourceIdea.niche,
          sourceIdea.Niche
        ])
    };

    if (!idea.id) {
      throw createControllerError_(
        "Idea ID is required."
      );
    }

    if (!idea.videoIdea) {
      throw createControllerError_(
        "Idea title is required."
      );
    }

    const options =
      request.options ===
        undefined ||
      request.options === null
        ? {}
        : request.options;

    if (
      typeof options !==
        "object" ||
      Array.isArray(options)
    ) {
      throw createControllerError_(
        "Script-generation options must be an object."
      );
    }

    return {
      idea:
        idea,

      options:
        sanitiseOptions_(
          options
        )
    };
  }

  /**
   * Returns only supported workflow options.
   *
   * @param {Object} options Supplied options.
   * @return {Object} Safe options.
   * @private
   */
  function sanitiseOptions_(options) {
    const supportedKeys = [
      "temperature",
      "maxTokens",
      "targetDurationSeconds",
      "minimumWordCount",
      "maximumWordCount",
      "minimumDurationSeconds",
      "maximumDurationSeconds",
      "durationToleranceSeconds",
      "maxValidationAttempts",
      "tone",
      "language",
      "callToActionStyle",
      "status"
    ];

    const sanitised = {};

    supportedKeys.forEach(
      function (key) {
        if (
          options[key] !== undefined &&
          options[key] !== null &&
          options[key] !== ""
        ) {
          sanitised[key] =
            clone_(
              options[key]
            );
        }
      }
    );

    return sanitised;
  }

  /**
   * Normalises script-list filters.
   *
   * @param {*} request Query request.
   * @return {Object} Safe query.
   * @private
   */
  function normaliseListRequest_(
    request
  ) {
    const source =
      request === undefined ||
      request === null
        ? {}
        : request;

    if (
      typeof source !==
        "object" ||
      Array.isArray(source)
    ) {
      throw createControllerError_(
        "Script-list request must be an object."
      );
    }

    return {
      status:
        normaliseOptionalString_(
          source.status
        ).toUpperCase(),

      ideaId:
        normaliseOptionalString_(
          source.ideaId
        ),

      limit:
        normaliseLimit_(
          source.limit
        )
    };
  }

  /**
   * Extracts a Script ID.
   *
   * @param {*} request Request value.
   * @return {string} Script ID.
   * @private
   */
  function extractScriptId_(request) {
    const value =
      typeof request === "string"
        ? request
        : request &&
          typeof request ===
            "object"
          ? (
              request.scriptId ||
              request.id
            )
          : "";

    const scriptId =
      normaliseOptionalString_(
        value
      );

    if (!scriptId) {
      throw createControllerError_(
        "Script ID is required."
      );
    }

    return scriptId;
  }

  /**
   * Extracts an Idea ID.
   *
   * @param {*} request Request value.
   * @return {string} Idea ID.
   * @private
   */
  function extractIdeaId_(request) {
    const value =
      typeof request === "string"
        ? request
        : request &&
          typeof request ===
            "object"
          ? (
              request.ideaId ||
              request.id
            )
          : "";

    const ideaId =
      normaliseOptionalString_(
        value
      );

    if (!ideaId) {
      throw createControllerError_(
        "Idea ID is required."
      );
    }

    return ideaId;
  }

  /**
   * Normalises list limits.
   *
   * @param {*} value Supplied limit.
   * @return {number} Safe list limit.
   * @private
   */
  function normaliseLimit_(value) {
    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      return DEFAULT_LIST_LIMIT;
    }

    const numericValue =
      Number(value);

    if (
      !Number.isInteger(
        numericValue
      ) ||
      numericValue < 1
    ) {
      throw createControllerError_(
        "Script-list limit must be a positive integer."
      );
    }

    return Math.min(
      numericValue,
      MAX_LIST_LIMIT
    );
  }

  return {
    normaliseGenerateRequest: normaliseGenerateRequest_,
    normaliseListRequest: normaliseListRequest_,
    extractScriptId: extractScriptId_,
    extractIdeaId: extractIdeaId_
  };
})();
