/****************************************************
 * Project Savannah
 * Script_Engine_Inputs.js
 *
 * Purpose:
 * Turn the caller's idea and options into the normalised idea and the
 * fully resolved workflow options the Script Engine runs with: defaults,
 * settings fallbacks, word-count range for the target duration, and limits.
 *
 * Split out of Scripts/Script_Engine.js (modular refactor, November 2026). The function
 * bodies are unchanged. ScriptEngine remains the public entry point; nothing outside
 * it should call this module directly.
 ****************************************************/

const ScriptEngineInputs = (() => {
  const DEFAULT_OPTIONS = Object.freeze({
      temperature: null,
      maxTokens: null,
      targetDurationSeconds: 50,
      minimumWordCount: 99,
      maximumWordCount: 125,
      status: "FORMATTED",
      maxValidationAttempts: 3
  });

  /**
   * Normalises and validates an idea.
   *
   * @param {*} idea Source idea.
   * @return {Object} Normalised idea.
   */
  function normaliseIdea_(idea) {
    if (
      !idea ||
      typeof idea !== "object" ||
      Array.isArray(idea)
    ) {
      throw new Error(
        "A valid idea object is required."
      );
    }

    const ideaId = firstString_([
      idea.id,
      idea.ideaId,
      idea["Idea ID"],
      idea.ID
    ]);

    const title = firstString_([
      idea.title,
      idea.videoIdea,
      idea.idea,
      idea.topic,
      idea["Video Idea"],
      idea.Title
    ]);

    const hook = firstString_([
      idea.hook,
      idea.Hook
    ]);

    const targetAudience =
      firstString_([
        idea.targetAudience,
        idea["Target Audience"],
        idea.audience
      ]);

    const niche = firstString_([
      idea.niche,
      idea.Niche
    ]);

    if (!ideaId) {
      throw new Error(
        "Idea ID is required for script generation."
      );
    }

    if (!title) {
      throw new Error(
        "Idea title is required for script generation."
      );
    }

    return {
      ideaId: ideaId,
      title: title,
      hook: hook,
      targetAudience:
        targetAudience ||
        safeSetting_(
          "getTargetAudience",
          ""
        ),
      niche:
        niche ||
        safeSetting_(
          "getNiche",
          ""
        )
    };
  }

  /**
   * Resolves and validates Script Engine options.
   *
   * @param {Object=} options Supplied options.
   * @return {Object} Normalised options.
   */
  function resolveOptions_(options) {
    const supplied = options || {};

    if (
      typeof supplied !== "object" ||
      Array.isArray(supplied)
    ) {
      throw new Error(
        "Script Engine options must be an object."
      );
    }

    const validatorDefaults = ScriptValidator.getDefaultRules();
    const targetDurationSeconds = resolvePositiveNumber_(
      supplied.targetDurationSeconds,
      DEFAULT_OPTIONS.targetDurationSeconds
    );
    const durationWordRange = wordRangeForDuration_(targetDurationSeconds);

    const resolved = {
      temperature:
        resolveOptionalNumber_(
          supplied.temperature,
          safeSetting_(
            "getTemperature",
            DEFAULT_OPTIONS.temperature
          )
        ),

      maxTokens:
        resolveOptionalNumber_(
          supplied.maxTokens,
          safeSetting_(
            "getMaxTokens",
            DEFAULT_OPTIONS.maxTokens
          )
        ),

      targetDurationSeconds: targetDurationSeconds,

      minimumWordCount:
        resolvePositiveNumber_(
          supplied.minimumWordCount,
          durationWordRange.minimumWordCount
        ),

      maximumWordCount:
        resolvePositiveNumber_(
          supplied.maximumWordCount,
          durationWordRange.maximumWordCount
        ),

      minimumDurationSeconds:
        resolvePositiveNumber_(
          supplied.minimumDurationSeconds,
          validatorDefaults
            .minimumDurationSeconds
        ),

      maximumDurationSeconds:
        resolvePositiveNumber_(
          supplied.maximumDurationSeconds,
          validatorDefaults
            .maximumDurationSeconds
        ),

      durationToleranceSeconds:
        resolveNonNegativeNumber_(
          supplied.durationToleranceSeconds,
          validatorDefaults
            .durationToleranceSeconds
        ),

      maxValidationAttempts:
        resolvePositiveIntegerOption_(
          supplied.maxValidationAttempts,
          DEFAULT_OPTIONS
            .maxValidationAttempts
        ),

      tone:
        normaliseString_(
          supplied.tone
        ),

      language:
        normaliseString_(
          supplied.language
        ),

      callToActionStyle:
        normaliseString_(
          supplied.callToActionStyle
        ),

      status:
        normaliseString_(
          supplied.status ||
          DEFAULT_OPTIONS.status
        ).toUpperCase()
    };

    if (
      resolved.maximumWordCount <
      resolved.minimumWordCount
    ) {
      throw new Error(
        "Maximum word count cannot be lower than minimum word count."
      );
    }

    if (
      resolved.maximumDurationSeconds <
      resolved.minimumDurationSeconds
    ) {
      throw new Error(
        "Maximum duration cannot be lower than minimum duration."
      );
    }

    if (
      resolved.maxValidationAttempts > 5
    ) {
      throw new Error(
        "Maximum validation attempts cannot exceed 5."
      );
    }

    const statuses =
      ScriptModel.getStatuses();

    const allowedStatuses =
      Object.keys(statuses).map(
        function (key) {
          return statuses[key];
        }
      );

    if (
      allowedStatuses.indexOf(
        resolved.status
      ) === -1
    ) {
      throw new Error(
        "Unsupported Script Engine status: " +
          resolved.status +
          "."
      );
    }

    return resolved;
  }

  function wordRangeForDuration_(targetDurationSeconds) {
    const seconds = Math.max(30, Math.min(60, Number(targetDurationSeconds) || 50));
    return {
      minimumWordCount: Math.max(90, Math.round(seconds * 1.98)),
      maximumWordCount: Math.round(seconds * 2.5)
    };
  }

  /**
   * Safely reads one Settings method.
   *
   * @param {string} methodName Settings method.
   * @param {*} fallback Fallback.
   * @return {*} Setting or fallback.
   */
  function safeSetting_(
    methodName,
    fallback
  ) {
    try {
      if (
        typeof Settings !== "undefined" &&
        Settings &&
        typeof Settings[methodName] ===
          "function"
      ) {
        const value =
          Settings[methodName]();

        if (
          value !== undefined &&
          value !== null &&
          value !== ""
        ) {
          return value;
        }
      }
    } catch (error) {
      Logger.log(
        "Script Engine setting warning: " +
          error.message
      );
    }

    return fallback;
  }

  /**
   * Returns the first non-empty string.
   *
   * @param {Array} values Candidate values.
   * @return {string} First value.
   */
  function firstString_(values) {
    for (
      let index = 0;
      index < values.length;
      index++
    ) {
      const value =
        normaliseString_(
          values[index]
        );

      if (value) {
        return value;
      }
    }

    return "";
  }

  /**
   * Normalises a string.
   *
   * @param {*} value Source value.
   * @return {string} String value.
   */
  function normaliseString_(value) {
    if (
      value === undefined ||
      value === null
    ) {
      return "";
    }

    return String(value).trim();
  }

  /**
   * Resolves an optional number.
   *
   * @param {*} value Candidate.
   * @param {*} fallback Fallback.
   * @return {?number} Number or null.
   */
  function resolveOptionalNumber_(
    value,
    fallback
  ) {
    const selected =
      value !== undefined &&
      value !== null &&
      value !== ""
        ? value
        : fallback;

    if (
      selected === undefined ||
      selected === null ||
      selected === ""
    ) {
      return null;
    }

    const numericValue =
      Number(selected);

    if (!isFinite(numericValue)) {
      throw new Error(
        "Script Engine numeric options must contain valid numbers."
      );
    }

    return numericValue;
  }

  /**
   * Resolves a positive integer option.
   *
   * @param {*} value Candidate value.
   * @param {number} fallback Fallback value.
   * @return {number} Positive integer.
   */
  function resolvePositiveIntegerOption_(
    value,
    fallback
  ) {
    const selected =
      value !== undefined &&
      value !== null &&
      value !== ""
        ? value
        : fallback;

    const numericValue = Number(selected);

    if (
      !Number.isInteger(numericValue) ||
      numericValue < 1
    ) {
      throw new Error(
        "Maximum validation attempts must be a positive integer."
      );
    }

    return numericValue;
  }

  /**
   * Resolves a positive number.
   */
  function resolvePositiveNumber_(
    value,
    fallback
  ) {
    const numericValue =
      Number(
        value !== undefined &&
        value !== null &&
        value !== ""
          ? value
          : fallback
      );

    if (
      !isFinite(numericValue) ||
      numericValue <= 0
    ) {
      throw new Error(
        "Script Engine options must contain positive numbers."
      );
    }

    return numericValue;
  }

  /**
   * Resolves a non-negative number.
   */
  function resolveNonNegativeNumber_(
    value,
    fallback
  ) {
    const numericValue =
      Number(
        value !== undefined &&
        value !== null &&
        value !== ""
          ? value
          : fallback
      );

    if (
      !isFinite(numericValue) ||
      numericValue < 0
    ) {
      throw new Error(
        "Duration tolerance must be a non-negative number."
      );
    }

    return numericValue;
  }

  return {
    normaliseIdea: normaliseIdea_,
    resolveOptions: resolveOptions_
  };
})();
