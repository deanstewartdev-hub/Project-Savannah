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

  const WEAK_HOOK_PATTERNS = [
    /^\s*did you know\b/i,
    /^\s*here (?:are|is)\b/i,
    /^\s*welcome\b/i,
    /^\s*today\b/i,
    /^\s*in (?:this|today'?s) video\b/i
  ];

  const PLACEHOLDER_PATTERNS = [
    /\bTBD\b/i,
    /\bTODO\b/i,
    /\binsert fact\b/i,
    /\binsert statistic\b/i,
    /\bplaceholder\b/i,
    /\bexample text\b/i,
    /\blorem ipsum\b/i
  ];

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
   * Validates the complete scene array.
   *
   * @param {*} scenes Scene collection.
   * @param {Object} rules Validation rules.
   * @param {string[]} errors Validation errors.
   * @return {Object} Scene validation metadata.
   */
  function validateScenes_(
    scenes,
    rules,
    errors
  ) {
    if (!Array.isArray(scenes)) {
      errors.push(
        "Scenes must be an array."
      );

      return {
        totalDurationSeconds: 0
      };
    }

    if (
      scenes.length <
      rules.minimumSceneCount
    ) {
      errors.push(
        "Script contains " +
        scenes.length +
        " scenes; minimum is " +
        rules.minimumSceneCount +
        "."
      );
    }

    if (
      scenes.length >
      rules.maximumSceneCount
    ) {
      errors.push(
        "Script contains " +
        scenes.length +
        " scenes; maximum is " +
        rules.maximumSceneCount +
        "."
      );
    }

    let totalDurationSeconds = 0;
    const visualDirections = [];

    scenes.forEach(function (scene, index) {
      const expectedSceneNumber =
        index + 1;

      if (
        !scene ||
        typeof scene !== "object"
      ) {
        errors.push(
          "Scene " +
          expectedSceneNumber +
          " must be a valid object."
        );

        return;
      }

      if (
        Number(scene.sceneNumber) !==
        expectedSceneNumber
      ) {
        errors.push(
          "Scene " +
          expectedSceneNumber +
          " has an invalid scene number."
        );
      }

      validateSceneString_(
        scene,
        "narration",
        "Narration",
        expectedSceneNumber,
        errors
      );

      validateSceneString_(
        scene,
        "onScreenText",
        "On-screen text",
        expectedSceneNumber,
        errors
      );

      if (
        typeof scene.onScreenText === "string" &&
        countWords_(scene.onScreenText) >
          rules.maximumOnScreenTextWordCount
      ) {
        errors.push(
          "On-screen text for scene " +
          expectedSceneNumber +
          " must contain no more than " +
          rules.maximumOnScreenTextWordCount +
          " words."
        );
      }

      validateSceneString_(
        scene,
        "visualDirection",
        "Visual direction",
        expectedSceneNumber,
        errors
      );

      if (
        typeof scene.visualDirection === "string" &&
        countWords_(scene.visualDirection) < rules.minimumVisualDirectionWordCount
      ) {
        errors.push(
          "Visual direction for scene " + expectedSceneNumber +
          " must name enough concrete detail for an original scene."
        );
      }

      if (typeof scene.visualDirection === "string" && scene.visualDirection.trim()) {
        visualDirections.push(normaliseComparableText_(scene.visualDirection));
      }

      const duration =
        Number(scene.estimatedSeconds);

      if (
        !isFinite(duration) ||
        duration <= 0
      ) {
        errors.push(
          "Scene " +
          expectedSceneNumber +
          " must have a positive estimated duration."
        );
      } else {
        totalDurationSeconds += duration;

        if (duration > rules.maximumSceneDurationSeconds) {
          errors.push(
            "Scene " + expectedSceneNumber + " lasts " + duration +
            " seconds; maximum visual hold is " +
            rules.maximumSceneDurationSeconds + " seconds."
          );
        }
      }
    });

    if (visualDirections.length && new Set(visualDirections).size !== visualDirections.length) {
      errors.push(
        "Every scene must use a distinct visual direction to create visible pattern interrupts."
      );
    }

    return {
      totalDurationSeconds:
        roundNumber_(
          totalDurationSeconds,
          2
        )
    };
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
  function validateSceneString_(
    scene,
    propertyName,
    displayName,
    sceneNumber,
    errors
  ) {
    if (
      typeof scene[propertyName] !== "string" ||
      !scene[propertyName].trim()
    ) {
      errors.push(
        displayName +
        " is required for scene " +
        sceneNumber +
        "."
      );
    }
  }

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
   * Checks that the hook appears near the beginning.
   *
   * The first meaningful words of the hook must appear
   * within the opening portion of the voiceover.
   *
   * @param {string} hook Script hook.
   * @param {string} voiceover Voiceover script.
   * @param {string[]} errors Validation errors.
   */
  function validateHookPlacement_(
    hook,
    voiceover,
    errors
  ) {
    if (
      typeof hook !== "string" ||
      typeof voiceover !== "string"
    ) {
      return;
    }

    const hookWords =
      normaliseComparableText_(hook)
        .split(" ")
        .filter(Boolean)
        .slice(0, 5)
        .join(" ");

    const openingVoiceover =
      normaliseComparableText_(
        voiceover.slice(0, 350)
      );

    if (
      hookWords &&
      openingVoiceover.indexOf(hookWords) === -1
    ) {
      errors.push(
        "The script hook does not appear near the beginning of the voiceover."
      );
    }
  }

  /**
   * Rejects weak or overlong openings that lose viewers immediately.
   */
  function validateHookQuality_(hook, rules, errors) {
    if (typeof hook !== "string" || !hook.trim()) {
      return;
    }

    const wordCount = countWords_(hook);

    if (wordCount < rules.minimumHookWordCount) {
      errors.push(
        "The hook contains " + wordCount +
        " words; minimum is " + rules.minimumHookWordCount + "."
      );
    }

    if (wordCount > rules.maximumHookWordCount) {
      errors.push(
        "The hook contains " + wordCount +
        " words; maximum is " + rules.maximumHookWordCount + "."
      );
    }

    WEAK_HOOK_PATTERNS.forEach(function (pattern) {
      if (pattern.test(hook)) {
        errors.push(
          "The hook uses a weak opening pattern: " + pattern.toString()
        );
      }
    });
  }

  /**
   * Keeps the closing action short so it does not dilute the payoff.
   */
  function validateCallToActionQuality_(callToAction, rules, errors) {
    if (typeof callToAction !== "string" || !callToAction.trim()) {
      return;
    }

    const wordCount = countWords_(callToAction);

    if (wordCount > rules.maximumCallToActionWordCount) {
      errors.push(
        "Call to action contains " + wordCount +
        " words; maximum is " +
        rules.maximumCallToActionWordCount + "."
      );
    }
  }

  /**
   * Rejects narration dominated by long sentences that sound robotic in TTS.
   */
  function validateNarrationCadence_(voiceover, rules, errors) {
    if (typeof voiceover !== "string" || !voiceover.trim()) {
      return { sentenceCount: 0, longSentenceCount: 0 };
    }

    const sentences = voiceover.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [voiceover];
    const longSentenceCount = sentences.filter(function (sentence) {
      return countWords_(sentence) > rules.maximumSentenceWordCount;
    }).length;
    const allowedLongSentences = Math.floor(sentences.length * rules.maximumLongSentenceShare);

    if (longSentenceCount > allowedLongSentences) {
      errors.push(
        "Voiceover contains " + longSentenceCount +
        " overlong sentences; shorten them for natural narration and faster captions."
      );
    }

    return {
      sentenceCount: sentences.length,
      longSentenceCount: longSentenceCount
    };
  }

  /**
   * Detects markdown and code-fence content.
   *
   * @param {*} voiceover Voiceover text.
   * @param {string[]} errors Validation errors.
   */
  function validateNoMarkdown_(
    voiceover,
    errors
  ) {
    if (typeof voiceover !== "string") {
      return;
    }

    if (
      voiceover.indexOf("```") !== -1
    ) {
      errors.push(
        "Voiceover must not contain code fences."
      );
    }

    if (
      /^\s*#{1,6}\s/m.test(voiceover)
    ) {
      errors.push(
        "Voiceover must not contain markdown headings."
      );
    }
  }

  /**
   * Searches relevant script values for placeholders.
   *
   * @param {Object} script Generated script.
   * @param {string[]} errors Validation errors.
   */
  function validateNoPlaceholders_(
    script,
    errors
  ) {
    const searchableValues = [
      script.title,
      script.hook,
      script.voiceoverScript,
      script.callToAction,
      script.generationNotes
    ];

    if (Array.isArray(script.scenes)) {
      script.scenes.forEach(function (scene) {
        if (!scene) {
          return;
        }

        searchableValues.push(
          scene.narration,
          scene.onScreenText,
          scene.visualDirection
        );
      });
    }

    const combinedText =
      searchableValues
        .filter(function (value) {
          return typeof value === "string";
        })
        .join(" ");

    PLACEHOLDER_PATTERNS.forEach(
      function (pattern) {
        if (pattern.test(combinedText)) {
          errors.push(
            "Generated script contains placeholder content matching: " +
            pattern.toString()
          );
        }
      }
    );
  }

  /**
   * Calculates a reliable word count.
   *
   * @param {*} text Source text.
   * @return {number} Number of words.
   */
  function countWords_(text) {
    if (
      typeof text !== "string" ||
      !text.trim()
    ) {
      return 0;
    }

    return text
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .length;
  }

  /**
   * Joins scenes[].narration in order into the single canonical narration - the same
   * text Cloud Run's CloudRunFFmpegProvider.submitRender() sends to ElevenLabs as one
   * concatenated beats[].text string. Deliberately not the AI's separate voiceoverScript
   * field, which nothing enforces staying in sync with the actual scene narration.
   *
   * @param {*} scenes Scene collection.
   * @return {string} Canonical narration text.
   */
  function canonicalNarrationFromScenes_(scenes) {
    if (!Array.isArray(scenes)) return "";

    return scenes
      .map(function (scene) {
        return scene && typeof scene.narration === "string" ? scene.narration.trim() : "";
      })
      .filter(Boolean)
      .join(" ");
  }

  /**
   * Normalises one scene after successful validation.
   *
   * @param {Object} scene Validated scene.
   * @return {Object} Normalised scene.
   */
  function normaliseScene_(scene) {
    return {
      sceneNumber:
        Number(scene.sceneNumber),

      narration:
        scene.narration.trim(),

      onScreenText:
        scene.onScreenText.trim(),

      visualDirection:
        scene.visualDirection.trim(),

      estimatedSeconds:
        Number(scene.estimatedSeconds)
    };
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

  /**
   * Prepares text for loose comparison.
   *
   * @param {string} value Text value.
   * @return {string} Comparable text.
   */
  function normaliseComparableText_(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Rounds a number to the requested decimal places.
   *
   * @param {number} value Number to round.
   * @param {number} decimalPlaces Decimal places.
   * @return {number} Rounded value.
   */
  function roundNumber_(
    value,
    decimalPlaces
  ) {
    const multiplier = Math.pow(
      10,
      decimalPlaces
    );

    return (
      Math.round(
        Number(value) * multiplier
      ) / multiplier
    );
  }

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

/**
 * Tests the validator with a valid script response.
 *
 * @return {Object} Validation result.
 */
function testScriptValidatorWithValidScript() {
  const script = createValidScriptValidatorFixture_();

  const result =
    ScriptValidator.validate(script);

  if (
    !result ||
    result.valid !== true ||
    result.metadata.wordCount < 100 ||
    result.metadata.sceneCount !== 5
  ) {
    throw new Error(
      "Valid script validator test returned an unexpected result."
    );
  }

  Logger.log(
    JSON.stringify(result, null, 2)
  );

  Logger.log(
    "Valid script validator test completed successfully."
  );

  return result;
}

/**
 * Tests that invalid scene ordering is rejected.
 *
 * @return {boolean} True when correctly rejected.
 */
function testScriptValidatorRejectsInvalidScenes() {
  const script = createValidScriptValidatorFixture_();

  script.scenes[2].sceneNumber = 7;

  try {
    ScriptValidator.validate(script);
  } catch (error) {
    if (
      error.name !== "ScriptValidationError"
    ) {
      throw error;
    }

    Logger.log(error.message);

    Logger.log(
      "Invalid scene-order test completed successfully."
    );

    return true;
  }

  throw new Error(
    "Validator accepted an invalid scene order."
  );
}

/**
 * Tests that an undersized voiceover is rejected.
 *
 * @return {boolean} True when correctly rejected.
 */
function testScriptValidatorRejectsShortVoiceover() {
  const script = createValidScriptValidatorFixture_();

  script.voiceoverScript =
    script.hook + " This script is far too short.";

  try {
    ScriptValidator.validate(script);
  } catch (error) {
    if (
      error.name !== "ScriptValidationError"
    ) {
      throw error;
    }

    Logger.log(error.message);

    Logger.log(
      "Short voiceover test completed successfully."
    );

    return true;
  }

  throw new Error(
    "Validator accepted an undersized voiceover."
  );
}

/**
 * Creates a reusable valid script fixture.
 *
 * @return {Object} Valid script object.
 */
function createValidScriptValidatorFixture_() {
  const hook =
    "Visiting Rome? Avoid these five mistakes that ruin thousands of trips.";

  const voiceoverScript = [
    hook,
    "First, never eat beside the biggest tourist attractions, because prices rise while quality often drops.",
    "Walk a few streets away and look for smaller restaurants filled with local customers.",
    "Second, do not rely entirely on taxis, because central Rome is compact and best explored on foot.",
    "Third, remember that many churches enforce modest clothing, especially during warmer months.",
    "Carry something light to cover your shoulders and knees.",
    "Fourth, avoid trying to see every landmark in one day.",
    "Rome rewards slower travel, quiet streets, local cafés, and unexpected discoveries.",
    "Finally, keep valuables secure in crowded stations and around major attractions.",
    "Plan carefully, stay aware, and your first Roman holiday will be far more enjoyable.",
    "Follow for more practical travel advice before your next adventure."
  ].join(" ");

  return {
    title:
      "Five Rome Mistakes Tourists Always Make",

    hook: hook,

    voiceoverScript:
      voiceoverScript,

    scenes: [
      {
        sceneNumber: 1,
        narration: hook,
        onScreenText:
          "Going to Rome?",
        visualDirection:
          "Fast aerial view of central Rome followed by crowded tourist streets.",
        estimatedSeconds: 7
      },
      {
        sceneNumber: 2,
        narration:
          "Avoid restaurants beside major attractions and walk a few streets away.",
        onScreenText:
          "Skip tourist-trap restaurants",
        visualDirection:
          "Contrast an overpriced tourist menu with a busy local restaurant.",
        estimatedSeconds: 10
      },
      {
        sceneNumber: 3,
        narration:
          "Explore central Rome on foot and carry clothing suitable for church visits.",
        onScreenText:
          "Walk more · Dress respectfully",
        visualDirection:
          "Walking shot through Rome followed by a church entrance sign.",
        estimatedSeconds: 11
      },
      {
        sceneNumber: 4,
        narration:
          "Slow down, avoid packing every landmark into one day, and protect valuables in crowds.",
        onScreenText:
          "Slow down · Stay aware",
        visualDirection:
          "Relaxed café scene transitioning to a crowded station.",
        estimatedSeconds: 13
      },
      {
        sceneNumber: 5,
        narration:
          "Plan carefully and follow for more useful travel advice.",
        onScreenText:
          "Follow for more travel tips",
        visualDirection:
          "Sunset view over Rome with a clean follow animation.",
        estimatedSeconds: 7
      }
    ],

    callToAction:
      "Follow for more practical travel advice before your next adventure.",

    estimatedDurationSeconds: 48,

    generationNotes: ""
  };
}

/**
 * Tests that a generic low-retention opening is rejected.
 *
 * @return {boolean} True when correctly rejected.
 */
function testScriptValidatorRejectsWeakHook() {
  const script = createValidScriptValidatorFixture_();

  script.hook =
    "Did you know these common Rome mistakes can ruin your holiday?";
  script.voiceoverScript =
    script.hook + " " +
    script.voiceoverScript.split(" ").slice(11).join(" ");

  try {
    ScriptValidator.validate(script);
  } catch (error) {
    if (
      error.name === "ScriptValidationError" &&
      error.validationErrors.some(function (message) {
        return message.indexOf("weak opening pattern") !== -1;
      })
    ) {
      return true;
    }

    throw error;
  }

  throw new Error(
    "Validator accepted a weak hook opening."
  );
}
