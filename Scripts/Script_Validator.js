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
  const DEFAULT_RULES = Object.freeze({
    minimumWordCount: 105,
    maximumWordCount: 145,
    minimumSceneCount: 3,
    maximumSceneCount: 12,
    minimumDurationSeconds: 30,
    maximumDurationSeconds: 60,
    durationToleranceSeconds: 5
  });

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

    validateNoMarkdown_(
      script.voiceoverScript,
      errors
    );

    validateNoPlaceholders_(
      script,
      errors
    );

    const wordCount = countWords_(
      script.voiceoverScript
    );

    validateWordCount_(
      wordCount,
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
      script.voiceoverScript,
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
          script.voiceoverScript.trim(),

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
        sceneCount: script.scenes.length,
        sceneDurationSeconds:
          scenesResult.totalDurationSeconds,

        estimatedDurationSeconds:
          estimatedDuration,

        durationDifferenceSeconds:
          Math.abs(
            scenesResult.totalDurationSeconds -
            estimatedDuration
          )
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

      validateSceneString_(
        scene,
        "visualDirection",
        "Visual direction",
        expectedSceneNumber,
        errors
      );

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
      }
    });

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
          DEFAULT_RULES.durationToleranceSeconds
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
    result.metadata.wordCount < 105 ||
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