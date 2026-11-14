/****************************************************
 * Project Savannah v1.2
 * Script_Validator.js
 *
 * Purpose:
 * Validate AI-generated YouTube Shorts scripts.
 *
 * Responsibilities:
 * - Validate required script fields.
 * - Enforce word-count rules.
 * - Validate scene structure and sequence.
 * - Validate script and scene durations.
 * - Detect placeholder or malformed content.
 * - Return normalised validation metadata.
 *
 * Must not:
 * - Call AI providers.
 * - Access Google Sheets.
 * - Save scripts.
 * - Format records for persistence.
 ****************************************************/

const ScriptValidator = (() => {
  // Cloud Run renders scenes[].narration directly (Production/VideoProcessingProvider.js) -
  // that is the only narration ElevenLabs ever receives, so word-count validation below is
  // gated on the sum of scenes[].narration, not the AI's separately-written voiceoverScript
  // field (see canonicalNarrationFromScenes_). Bounds calibrated 2026-08-14 from two real
  // Cloud Run renders' measured ElevenLabs rates (2.21-2.30 words/sec): 90 words is the
  // observed-safe floor for a 30s minimum; 130 keeps the ceiling under 60s even at the
  // slower observed rate. 100-120 is the preferred (advisory-only) target - see
  // PREFERRED_MINIMUM_WORD_COUNT/PREFERRED_MAXIMUM_WORD_COUNT below.
  const PREFERRED_MINIMUM_WORD_COUNT = 100;
  const PREFERRED_MAXIMUM_WORD_COUNT = 120;
  const DEFAULT_RULES = Object.freeze({
    minimumWordCount: 90,
    maximumWordCount: 130,
    minimumSceneCount: 4,
    maximumSceneCount: 6,
    minimumDurationSeconds: 30,
    maximumDurationSeconds: 60,
    durationToleranceSeconds: 5,
    minimumHookWordCount: 6,
    maximumHookWordCount: 18,
    maximumCallToActionWordCount: 12,
    maximumOnScreenTextWordCount: 5,
    minimumVisualDirectionWordCount: 4,
    maximumSceneDurationSeconds: 15,
    maximumSentenceWordCount: 22,
    maximumLongSentenceShare: 0.25
  });

  /**
   * Validates and normalises an AI-generated script.
   *
   * @param {Object} script Generated script response.
   * @param {Object=} options Optional validation overrides.
   * @return {Object} Validated script and metadata.
   */
  function validate(script, options) {
    const rules = resolveRules_(options);
    const errors = [];

    if (!script || typeof script !== "object") {
      throw createValidationError_([
        "Generated script must be a valid object."
      ]);
    }

    validateRequiredString_(
      script,
      "title",
      "Title",
      errors
    );

    validateRequiredString_(
      script,
      "hook",
      "Hook",
      errors
    );

    validateRequiredString_(
      script,
      "voiceoverScript",
      "Voiceover script",
      errors
    );

    validateRequiredString_(
      script,
      "callToAction",
      "Call to action",
      errors
    );

    if (typeof script.generationNotes !== "string") {
      errors.push(
        "Generation notes must be a string, even when empty."
      );
    }

    // The AI writes voiceoverScript and scenes[].narration as two separate fields (the
    // prompt only asks it to keep them in sync - see Script_PromptLibrary.js - nothing
    // programmatically enforced that). Cloud Run only ever renders scenes[].narration, so
    // that - not the AI's own voiceoverScript copy - is treated as the single canonical
    // narration from here on: it is what gets validated, and it is what gets stored back
    // as voiceoverScript below. This removes the divergence risk entirely rather than
    // trying to detect it after the fact.
    const canonicalNarration = canonicalNarrationFromScenes_(script.scenes);

    validateNoMarkdown_(
      canonicalNarration,
      errors
    );

    validateNoPlaceholders_(
      script,
      errors
    );

    const wordCount = countWords_(
      canonicalNarration
    );

    validateWordCount_(
      wordCount,
      rules,
      errors
    );

    const cadenceResult = validateNarrationCadence_(
      canonicalNarration,
      rules,
      errors
    );

    const scenesResult = validateScenes_(
      script.scenes,
      rules,
      errors
    );

    const estimatedDuration =
      validateEstimatedDuration_(
        script.estimatedDurationSeconds,
        rules,
        errors
      );

    validateDurationConsistency_(
      scenesResult.totalDurationSeconds,
      estimatedDuration,
      rules,
      errors
    );

    validateHookPlacement_(
      script.hook,
      canonicalNarration,
      errors
    );

    validateHookQuality_(
      script.hook,
      rules,
      errors
    );

    validateCallToActionQuality_(
      script.callToAction,
      rules,
      errors
    );

    if (errors.length > 0) {
      throw createValidationError_(errors);
    }

    return {
      valid: true,

      script: {
        title: script.title.trim(),
        hook: script.hook.trim(),
        voiceoverScript:
          canonicalNarration,

        scenes: script.scenes.map(
          normaliseScene_
        ),

        callToAction:
          script.callToAction.trim(),

        estimatedDurationSeconds:
          Number(
            script.estimatedDurationSeconds
          ),

        generationNotes:
          script.generationNotes.trim()
      },

      metadata: {
        wordCount: wordCount,
        withinPreferredWordRange:
          wordCount >= PREFERRED_MINIMUM_WORD_COUNT &&
          wordCount <= PREFERRED_MAXIMUM_WORD_COUNT,
        sceneCount: script.scenes.length,
        sceneDurationSeconds:
          scenesResult.totalDurationSeconds,

        estimatedDurationSeconds:
          estimatedDuration,

        durationDifferenceSeconds:
          Math.abs(
            scenesResult.totalDurationSeconds -
            estimatedDuration
          ),

        longSentenceCount:
          cadenceResult.longSentenceCount
      }
    };
  }

  /**
   * Resolves validation options against defaults.
   *
   * @param {Object=} options Optional overrides.
   * @return {Object} Validation rules.
   */
  function resolveRules_(options) {
    const supplied = options || {};

    const rules = {
      minimumWordCount: resolveNumber_(
        supplied.minimumWordCount,
        DEFAULT_RULES.minimumWordCount
      ),

      maximumWordCount: resolveNumber_(
        supplied.maximumWordCount,
        DEFAULT_RULES.maximumWordCount
      ),

      minimumSceneCount: resolveNumber_(
        supplied.minimumSceneCount,
        DEFAULT_RULES.minimumSceneCount
      ),

      maximumSceneCount: resolveNumber_(
        supplied.maximumSceneCount,
        DEFAULT_RULES.maximumSceneCount
      ),

      minimumDurationSeconds: resolveNumber_(
        supplied.minimumDurationSeconds,
        DEFAULT_RULES.minimumDurationSeconds
      ),

      maximumDurationSeconds: resolveNumber_(
        supplied.maximumDurationSeconds,
        DEFAULT_RULES.maximumDurationSeconds
      ),

      durationToleranceSeconds: resolveNumber_(
        supplied.durationToleranceSeconds,
        DEFAULT_RULES.durationToleranceSeconds
      ),

      minimumHookWordCount: resolveNumber_(
        supplied.minimumHookWordCount,
        DEFAULT_RULES.minimumHookWordCount
      ),

      maximumHookWordCount: resolveNumber_(
        supplied.maximumHookWordCount,
        DEFAULT_RULES.maximumHookWordCount
      ),

      maximumCallToActionWordCount: resolveNumber_(
        supplied.maximumCallToActionWordCount,
        DEFAULT_RULES.maximumCallToActionWordCount
      ),

      maximumOnScreenTextWordCount: resolveNumber_(
        supplied.maximumOnScreenTextWordCount,
        DEFAULT_RULES.maximumOnScreenTextWordCount
      ),

      minimumVisualDirectionWordCount: resolveNumber_(
        supplied.minimumVisualDirectionWordCount,
        DEFAULT_RULES.minimumVisualDirectionWordCount
      ),

      maximumSceneDurationSeconds: resolveNumber_(
        supplied.maximumSceneDurationSeconds,
        DEFAULT_RULES.maximumSceneDurationSeconds
      ),

      maximumSentenceWordCount: resolveNumber_(
        supplied.maximumSentenceWordCount,
        DEFAULT_RULES.maximumSentenceWordCount
      ),

      maximumLongSentenceShare: resolveNumber_(
        supplied.maximumLongSentenceShare,
        DEFAULT_RULES.maximumLongSentenceShare
      )
    };

    if (
      rules.maximumWordCount <
      rules.minimumWordCount
    ) {
      throw new Error(
        "Maximum word count cannot be lower than minimum word count."
      );
    }

    if (
      rules.maximumSceneCount <
      rules.minimumSceneCount
    ) {
      throw new Error(
        "Maximum scene count cannot be lower than minimum scene count."
      );
    }

    if (
      rules.maximumDurationSeconds <
      rules.minimumDurationSeconds
    ) {
      throw new Error(
        "Maximum duration cannot be lower than minimum duration."
      );
    }

    return rules;
  }

  /**
   * Validates one required string field.
   *
   * @param {Object} source Source object.
   * @param {string} propertyName Property name.
   * @param {string} displayName Human-readable name.
   * @param {string[]} errors Validation errors.
   */
  function validateRequiredString_(
    source,
    propertyName,
    displayName,
    errors
  ) {
    if (
      typeof source[propertyName] !== "string" ||
      !source[propertyName].trim()
    ) {
      errors.push(
        displayName + " is required."
      );
    }
  }

  /**
   * Validates the voiceover word count.
   *
   * @param {number} wordCount Calculated word count.
   * @param {Object} rules Validation rules.
   * @param {string[]} errors Validation errors.
   */
  function validateWordCount_(
    wordCount,
    rules,
    errors
  ) {
    if (
      wordCount <
      rules.minimumWordCount
    ) {
      errors.push(
        "Voiceover contains " +
        wordCount +
        " words; minimum is " +
        rules.minimumWordCount +
        "."
      );
    }

    if (
      wordCount >
      rules.maximumWordCount
    ) {
      errors.push(
        "Voiceover contains " +
        wordCount +
        " words; maximum is " +
        rules.maximumWordCount +
        "."
      );
    }
  }

  /**
   * Validates one required scene string.
   *
   * @param {Object} scene Scene object.
   * @param {string} propertyName Property name.
   * @param {string} displayName Human-readable name.
   * @param {number} sceneNumber Scene number.
   * @param {string[]} errors Validation errors.
   */
  // True when a reviewed clip list is absent, or is at most 5 positive whole numbers.
  /**
   * Validates the declared script duration.
   *
   * @param {*} duration Declared duration.
   * @param {Object} rules Validation rules.
   * @param {string[]} errors Validation errors.
   * @return {number} Numeric duration.
   */
  function validateEstimatedDuration_(
    duration,
    rules,
    errors
  ) {
    const numericDuration =
      Number(duration);

    if (
      !isFinite(numericDuration)
    ) {
      errors.push(
        "Estimated duration must be a valid number."
      );

      return 0;
    }

    if (
      numericDuration <
      rules.minimumDurationSeconds ||
      numericDuration >
      rules.maximumDurationSeconds
    ) {
      errors.push(
        "Estimated duration must be between " +
        rules.minimumDurationSeconds +
        " and " +
        rules.maximumDurationSeconds +
        " seconds."
      );
    }

    return numericDuration;
  }

  /**
   * Checks that scene durations align with total duration.
   *
   * @param {number} sceneDuration Combined scene duration.
   * @param {number} estimatedDuration Declared duration.
   * @param {Object} rules Validation rules.
   * @param {string[]} errors Validation errors.
   */
  function validateDurationConsistency_(
    sceneDuration,
    estimatedDuration,
    rules,
    errors
  ) {
    if (
      sceneDuration <= 0 ||
      estimatedDuration <= 0
    ) {
      return;
    }

    const difference = Math.abs(
      sceneDuration -
      estimatedDuration
    );

    if (
      difference >
      rules.durationToleranceSeconds
    ) {
      errors.push(
        "Combined scene duration differs from the declared duration by " +
        roundNumber_(difference, 2) +
        " seconds; maximum tolerance is " +
        rules.durationToleranceSeconds +
        " seconds."
      );
    }
  }

  /**
   * Creates a validation error containing every failure.
   *
   * @param {string[]} errors Validation errors.
   * @return {Error} Validation error.
   */
  function createValidationError_(errors) {
    const error = new Error(
      "Generated script failed validation:\n- " +
      errors.join("\n- ")
    );

    error.name = "ScriptValidationError";
    error.validationErrors = errors.slice();

    return error;
  }

  /**
   * Resolves a numeric setting.
   *
   * @param {*} value Candidate value.
   * @param {number} fallback Fallback value.
   * @return {number} Resolved value.
   */
  function resolveNumber_(value, fallback) {
    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      return fallback;
    }

    const number = Number(value);

    if (!isFinite(number)) {
      throw new Error(
        "Script validation options must contain valid numbers."
      );
    }

    return number;
  }

  /*
   * The helpers below live in sibling modules:
   *   Script_Validator_Text.js
   *   Script_Validator_Scenes.js
   * Their private names are kept here as one-line delegates so every call site in
   * this file is unchanged. Each module is looked up when called, never while this
   * file loads, so file load order does not matter.
   */
  function validateHookPlacement_(hook, voiceover, errors) { return ScriptValidatorText.validateHookPlacement(hook, voiceover, errors); }
  function validateHookQuality_(hook, rules, errors) { return ScriptValidatorText.validateHookQuality(hook, rules, errors); }
  function validateCallToActionQuality_(callToAction, rules, errors) { return ScriptValidatorText.validateCallToActionQuality(callToAction, rules, errors); }
  function validateNarrationCadence_(voiceover, rules, errors) { return ScriptValidatorText.validateNarrationCadence(voiceover, rules, errors); }
  function validateNoMarkdown_(voiceover, errors) { return ScriptValidatorText.validateNoMarkdown(voiceover, errors); }
  function validateNoPlaceholders_(script, errors) { return ScriptValidatorText.validateNoPlaceholders(script, errors); }
  function countWords_(text) { return ScriptValidatorText.countWords(text); }
  function roundNumber_(value, decimalPlaces) { return ScriptValidatorText.roundNumber(value, decimalPlaces); }

  function validateScenes_(scenes, rules, errors) { return ScriptValidatorScenes.validateScenes(scenes, rules, errors); }
  function canonicalNarrationFromScenes_(scenes) { return ScriptValidatorScenes.canonicalNarrationFromScenes(scenes); }
  function normaliseScene_(scene) { return ScriptValidatorScenes.normaliseScene(scene); }

  return {
    validate: validate,

    countWords: function (text) {
      return countWords_(text);
    },

    getDefaultRules: function () {
      return {
        minimumWordCount:
          DEFAULT_RULES.minimumWordCount,

        maximumWordCount:
          DEFAULT_RULES.maximumWordCount,

        minimumSceneCount:
          DEFAULT_RULES.minimumSceneCount,

        maximumSceneCount:
          DEFAULT_RULES.maximumSceneCount,

        minimumDurationSeconds:
          DEFAULT_RULES.minimumDurationSeconds,

        maximumDurationSeconds:
          DEFAULT_RULES.maximumDurationSeconds,

        durationToleranceSeconds:
          DEFAULT_RULES.durationToleranceSeconds,

        minimumHookWordCount:
          DEFAULT_RULES.minimumHookWordCount,

        maximumHookWordCount:
          DEFAULT_RULES.maximumHookWordCount,

        maximumCallToActionWordCount:
          DEFAULT_RULES.maximumCallToActionWordCount,

        maximumOnScreenTextWordCount:
          DEFAULT_RULES.maximumOnScreenTextWordCount
      };
    }
  };
})();
