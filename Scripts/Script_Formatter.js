/****************************************************
 * Project Savannah v1.2
 * Script_Formatter.js
 *
 * Purpose:
 * Format validated YouTube Shorts scripts into a
 * consistent application and human-readable structure.
 *
 * Responsibilities:
 * - Accept validated script results or script objects.
 * - Normalise script text without changing its meaning.
 * - Preserve script and scene structure.
 * - Produce consistent display text.
 * - Produce formatter metadata.
 *
 * Must not:
 * - Call AI providers.
 * - Access Google Sheets.
 * - Save scripts.
 * - Perform full script validation.
 ****************************************************/

const ScriptFormatter = (() => {
  const FORMAT_VERSION = "scripts-format-v1.0";

  /**
   * Formats a validated script result or normalised script object.
   *
   * Accepted input shapes:
   *
   * Validator result:
   * {
   *   valid: true,
   *   script: {...},
   *   metadata: {...}
   * }
   *
   * Direct script:
   * {
   *   title: string,
   *   hook: string,
   *   voiceoverScript: string,
   *   scenes: Array,
   *   callToAction: string,
   *   estimatedDurationSeconds: number,
   *   generationNotes: string
   * }
   *
   * @param {Object} source Validated result or script object.
   * @return {Object} Formatted script result.
   */
  function format(source) {
    const extracted = extractSource_(source);
    const formattedScript = formatScriptObject_(extracted.script);
    const calculatedMetadata = buildMetadata_(
      formattedScript,
      extracted.metadata
    );

    return {
      valid: true,
      formatVersion: FORMAT_VERSION,
      script: formattedScript,
      metadata: calculatedMetadata,
      displayText: buildDisplayText_(formattedScript)
    };
  }

  /**
   * Extracts the script and metadata from supported input shapes.
   *
   * @param {Object} source Source object.
   * @return {Object} Extracted script and metadata.
   */
  function extractSource_(source) {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw createFormatterError_(
        "Script formatter requires a valid object."
      );
    }

    if (
      source.script &&
      typeof source.script === "object" &&
      !Array.isArray(source.script)
    ) {
      return {
        script: cloneObject_(source.script),
        metadata: cloneObject_(source.metadata || {})
      };
    }

    return {
      script: cloneObject_(source),
      metadata: {}
    };
  }

  /**
   * Formats the complete script object.
   *
   * @param {Object} script Source script.
   * @return {Object} Formatted script.
   */
  function formatScriptObject_(script) {
    assertRequiredScriptShape_(script);

    const formattedScenes = script.scenes.map(function (scene, index) {
      return formatScene_(scene, index);
    });

    return {
      title: formatTitle_(script.title),
      hook: formatSentence_(script.hook),
      voiceoverScript: formatParagraph_(script.voiceoverScript),
      scenes: formattedScenes,
      callToAction: formatSentence_(script.callToAction),
      estimatedDurationSeconds: normaliseNumber_(
        script.estimatedDurationSeconds,
        "Estimated duration"
      ),
      generationNotes: formatOptionalText_(script.generationNotes)
    };
  }

  /**
   * Verifies that the formatter received the expected script shape.
   *
   * This is intentionally a structural guard rather than full content
   * validation. Full validation belongs to ScriptValidator.
   *
   * @param {Object} script Script object.
   */
  function assertRequiredScriptShape_(script) {
    if (!script || typeof script !== "object" || Array.isArray(script)) {
      throw createFormatterError_(
        "The supplied script must be a valid object."
      );
    }

    assertString_(script.title, "Title");
    assertString_(script.hook, "Hook");
    assertString_(script.voiceoverScript, "Voiceover script");
    assertString_(script.callToAction, "Call to action");

    if (typeof script.generationNotes !== "string") {
      throw createFormatterError_(
        "Generation notes must be a string, even when empty."
      );
    }

    if (!Array.isArray(script.scenes)) {
      throw createFormatterError_("Scenes must be an array.");
    }

    if (script.scenes.length === 0) {
      throw createFormatterError_(
        "At least one scene is required for formatting."
      );
    }

    normaliseNumber_(
      script.estimatedDurationSeconds,
      "Estimated duration"
    );
  }

  /**
   * Formats one scene.
   *
   * @param {Object} scene Source scene.
   * @param {number} index Scene array index.
   * @return {Object} Formatted scene.
   */
  function formatScene_(scene, index) {
    const expectedSceneNumber = index + 1;

    if (!scene || typeof scene !== "object" || Array.isArray(scene)) {
      throw createFormatterError_(
        "Scene " + expectedSceneNumber + " must be a valid object."
      );
    }

    assertString_(
      scene.narration,
      "Narration for scene " + expectedSceneNumber
    );

    assertString_(
      scene.onScreenText,
      "On-screen text for scene " + expectedSceneNumber
    );

    assertString_(
      scene.visualDirection,
      "Visual direction for scene " + expectedSceneNumber
    );

    return {
      sceneNumber: normaliseSceneNumber_(
        scene.sceneNumber,
        expectedSceneNumber
      ),
      narration: formatSentence_(scene.narration),
      onScreenText: formatOnScreenText_(scene.onScreenText),
      visualDirection: formatSentence_(scene.visualDirection),
      estimatedSeconds: normaliseNumber_(
        scene.estimatedSeconds,
        "Estimated duration for scene " + expectedSceneNumber
      )
    };
  }

  /**
   * Formats the title while preserving its wording.
   *
   * @param {string} value Source title.
   * @return {string} Formatted title.
   */
  function formatTitle_(value) {
    return removeTrailingPunctuation_(
      normaliseText_(value)
        .replace(/^title\s*:\s*/i, "")
    );
  }

  /**
   * Formats normal sentence-style text.
   *
   * @param {string} value Source text.
   * @return {string} Formatted sentence.
   */
  function formatSentence_(value) {
    return normaliseText_(value);
  }

  /**
   * Formats the complete voiceover as one clean paragraph.
   *
   * @param {string} value Voiceover text.
   * @return {string} Formatted voiceover.
   */
  function formatParagraph_(value) {
    return normaliseText_(value)
      .replace(/\s*\n+\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  /**
   * Formats concise on-screen text.
   *
   * @param {string} value On-screen text.
   * @return {string} Formatted on-screen text.
   */
  function formatOnScreenText_(value) {
    return removeWrappingQuotes_(
      normaliseText_(value)
        .replace(/^on[-\s]?screen text\s*:\s*/i, "")
    );
  }

  /**
   * Formats an optional text field.
   *
   * @param {string} value Optional text.
   * @return {string} Formatted optional text.
   */
  function formatOptionalText_(value) {
    if (!value || !String(value).trim()) {
      return "";
    }

    return normaliseText_(value);
  }

  /**
   * Applies general text cleanup.
   *
   * @param {*} value Source value.
   * @return {string} Normalised text.
   */
  function normaliseText_(value) {
    return removeWrappingQuotes_(
      String(value || "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/\u00A0/g, " ")
        .replace(/[ \t]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    );
  }

  /**
   * Removes matching quotation marks surrounding a whole value.
   *
   * @param {string} value Source text.
   * @return {string} Text without unnecessary wrapping quotes.
   */
  function removeWrappingQuotes_(value) {
    let result = String(value || "").trim();

    const matchingQuotePairs = [
      ['"', '"'],
      ["'", "'"],
      ["“", "”"],
      ["‘", "’"]
    ];

    matchingQuotePairs.some(function (pair) {
      if (
        result.length >= 2 &&
        result.charAt(0) === pair[0] &&
        result.charAt(result.length - 1) === pair[1]
      ) {
        result = result.slice(1, -1).trim();
        return true;
      }

      return false;
    });

    return result;
  }

  /**
   * Removes punctuation that should not end a title.
   *
   * Question marks and exclamation marks are preserved because they
   * may intentionally form part of a title.
   *
   * @param {string} value Source title.
   * @return {string} Title without unwanted trailing punctuation.
   */
  function removeTrailingPunctuation_(value) {
    return String(value || "")
      .replace(/[.:;,]+$/g, "")
      .trim();
  }

  /**
   * Resolves a scene number.
   *
   * The validator should already enforce sequence. The formatter
   * retains the supplied value when it is numeric.
   *
   * @param {*} value Supplied scene number.
   * @param {number} fallback Expected scene number.
   * @return {number} Scene number.
   */
  function normaliseSceneNumber_(value, fallback) {
    const numericValue = Number(value);

    if (!isFinite(numericValue) || numericValue <= 0) {
      return fallback;
    }

    return Math.round(numericValue);
  }

  /**
   * Resolves a numeric script value.
   *
   * @param {*} value Source value.
   * @param {string} displayName Field name.
   * @return {number} Numeric value.
   */
  function normaliseNumber_(value, displayName) {
    const numericValue = Number(value);

    if (!isFinite(numericValue)) {
      throw createFormatterError_(
        displayName + " must be a valid number."
      );
    }

    return roundNumber_(numericValue, 2);
  }

  /**
   * Builds formatter metadata.
   *
   * Existing validator metadata is preserved and supplemented with
   * values calculated from the formatted script.
   *
   * @param {Object} script Formatted script.
   * @param {Object} existingMetadata Validator metadata.
   * @return {Object} Formatter metadata.
   */
  function buildMetadata_(script, existingMetadata) {
    const metadata = cloneObject_(existingMetadata || {});

    metadata.wordCount = countWords_(script.voiceoverScript);
    metadata.sceneCount = script.scenes.length;
    metadata.sceneDurationSeconds = calculateSceneDuration_(script.scenes);
    metadata.estimatedDurationSeconds =
      script.estimatedDurationSeconds;

    metadata.durationDifferenceSeconds = roundNumber_(
      Math.abs(
        metadata.sceneDurationSeconds -
          metadata.estimatedDurationSeconds
      ),
      2
    );

    metadata.formatVersion = FORMAT_VERSION;

    return metadata;
  }

  /**
   * Calculates the total scene duration.
   *
   * @param {Object[]} scenes Formatted scenes.
   * @return {number} Combined scene duration.
   */
  function calculateSceneDuration_(scenes) {
    const total = scenes.reduce(function (sum, scene) {
      return sum + Number(scene.estimatedSeconds || 0);
    }, 0);

    return roundNumber_(total, 2);
  }

  /**
   * Counts words in a text value.
   *
   * @param {string} value Source text.
   * @return {number} Word count.
   */
  function countWords_(value) {
    if (!value || !String(value).trim()) {
      return 0;
    }

    return String(value)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .length;
  }

  /**
   * Produces a readable script document.
   *
   * @param {Object} script Formatted script.
   * @return {string} Human-readable script.
   */
  function buildDisplayText_(script) {
    const sections = [
      "TITLE",
      script.title,
      "",
      "HOOK",
      script.hook,
      "",
      "VOICEOVER",
      script.voiceoverScript,
      "",
      "SCENES"
    ];

    script.scenes.forEach(function (scene) {
      sections.push(
        "",
        "SCENE " +
          scene.sceneNumber +
          " — " +
          formatDurationLabel_(scene.estimatedSeconds),
        "Narration: " + scene.narration,
        "On-screen text: " + scene.onScreenText,
        "Visual direction: " + scene.visualDirection
      );
    });

    sections.push(
      "",
      "CALL TO ACTION",
      script.callToAction,
      "",
      "ESTIMATED DURATION",
      formatDurationLabel_(script.estimatedDurationSeconds)
    );

    if (script.generationNotes) {
      sections.push(
        "",
        "GENERATION NOTES",
        script.generationNotes
      );
    }

    return sections.join("\n").trim();
  }

  /**
   * Formats a duration for display.
   *
   * @param {number} seconds Duration in seconds.
   * @return {string} Duration label.
   */
  function formatDurationLabel_(seconds) {
    const numericSeconds = Number(seconds);

    if (!isFinite(numericSeconds)) {
      return "0 seconds";
    }

    const roundedSeconds = roundNumber_(numericSeconds, 2);

    return (
      roundedSeconds +
      (roundedSeconds === 1 ? " second" : " seconds")
    );
  }

  /**
   * Validates a required string.
   *
   * @param {*} value Candidate value.
   * @param {string} displayName Field name.
   */
  function assertString_(value, displayName) {
    if (typeof value !== "string" || !value.trim()) {
      throw createFormatterError_(
        displayName + " is required."
      );
    }
  }

  /**
   * Creates a formatter-specific error.
   *
   * @param {string} message Error detail.
   * @return {Error} Formatter error.
   */
  function createFormatterError_(message) {
    const error = new Error(
      "Script formatting failed: " + message
    );

    error.name = "ScriptFormatterError";

    return error;
  }

  /**
   * Creates a plain deep clone suitable for script data.
   *
   * @param {*} value Source value.
   * @return {*} Cloned value.
   */
  function cloneObject_(value) {
    if (value === undefined) {
      return undefined;
    }

    return JSON.parse(JSON.stringify(value));
  }

  /**
   * Rounds a numeric value.
   *
   * @param {number} value Source number.
   * @param {number} decimalPlaces Decimal places.
   * @return {number} Rounded value.
   */
  function roundNumber_(value, decimalPlaces) {
    const multiplier = Math.pow(10, decimalPlaces);

    return (
      Math.round(Number(value) * multiplier) /
      multiplier
    );
  }

  return {
    format: format,

    buildDisplayText: function (script) {
      assertRequiredScriptShape_(script);
      return buildDisplayText_(
        formatScriptObject_(cloneObject_(script))
      );
    },

    getFormatVersion: function () {
      return FORMAT_VERSION;
    }
  };
})();

/**
 * Tests formatting from a successful validator result.
 *
 * Run this test first.
 *
 * @return {Object} Formatted result.
 */
function testScriptFormatterWithValidatedScript() {
  const sourceScript = createScriptFormatterFixture_();
  const validatedResult = ScriptValidator.validate(sourceScript);
  const formattedResult = ScriptFormatter.format(validatedResult);

  if (!formattedResult || formattedResult.valid !== true) {
    throw new Error(
      "Formatter did not return a valid result."
    );
  }

  if (
    formattedResult.formatVersion !==
    ScriptFormatter.getFormatVersion()
  ) {
    throw new Error(
      "Formatter returned an incorrect format version."
    );
  }

  if (formattedResult.script.scenes.length !== 5) {
    throw new Error(
      "Formatter returned an unexpected scene count."
    );
  }

  if (
    formattedResult.displayText.indexOf("TITLE") !== 0 ||
    formattedResult.displayText.indexOf("SCENE 1") === -1 ||
    formattedResult.displayText.indexOf("CALL TO ACTION") === -1
  ) {
    throw new Error(
      "Formatter display text is missing required sections."
    );
  }

  Logger.log(JSON.stringify(formattedResult, null, 2));
  Logger.log(
    "Validated script formatter test completed successfully."
  );

  return formattedResult;
}

/**
 * Tests formatting a direct script object.
 *
 * @return {Object} Formatted result.
 */
function testScriptFormatterWithDirectScript() {
  const sourceScript = createScriptFormatterFixture_();
  const formattedResult = ScriptFormatter.format(sourceScript);

  if (formattedResult.script.title !== sourceScript.title) {
    throw new Error(
      "Direct script formatter test changed the title unexpectedly."
    );
  }

  if (formattedResult.metadata.wordCount < 90) {
    throw new Error(
      "Direct script formatter test returned an invalid word count."
    );
  }

  Logger.log(JSON.stringify(formattedResult, null, 2));
  Logger.log(
    "Direct script formatter test completed successfully."
  );

  return formattedResult;
}

/**
 * Tests that formatting does not mutate the source script.
 *
 * @return {boolean} True when source data remains unchanged.
 */
function testScriptFormatterDoesNotMutateSource() {
  const sourceScript = createScriptFormatterFixture_();
  const originalSnapshot = JSON.stringify(sourceScript);

  ScriptFormatter.format(sourceScript);

  if (JSON.stringify(sourceScript) !== originalSnapshot) {
    throw new Error(
      "Formatter mutated the source script."
    );
  }

  Logger.log(
    "Script formatter immutability test completed successfully."
  );

  return true;
}

/**
 * Tests rejection of malformed formatter input.
 *
 * @return {boolean} True when malformed input is rejected.
 */
function testScriptFormatterRejectsInvalidInput() {
  try {
    ScriptFormatter.format({
      title: "Incomplete Script"
    });
  } catch (error) {
    if (error.name !== "ScriptFormatterError") {
      throw error;
    }

    Logger.log(error.message);
    Logger.log(
      "Invalid formatter input test completed successfully."
    );

    return true;
  }

  throw new Error(
    "Formatter accepted an invalid script object."
  );
}

/**
 * Runs every Script Formatter test.
 *
 * @return {Object} Test summary.
 */
function testScriptFormatterAll() {
  testScriptFormatterWithValidatedScript();
  testScriptFormatterWithDirectScript();
  testScriptFormatterDoesNotMutateSource();
  testScriptFormatterRejectsInvalidInput();

  const result = {
    passed: true,
    testsRun: 4,
    formatVersion: ScriptFormatter.getFormatVersion()
  };

  Logger.log(JSON.stringify(result, null, 2));
  Logger.log(
    "All Script Formatter tests completed successfully."
  );

  return result;
}

/**
 * Creates a reusable formatter fixture.
 *
 * @return {Object} Valid script fixture.
 */
function createScriptFormatterFixture_() {
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
    title: "Five Rome Mistakes Tourists Always Make",
    hook: hook,
    voiceoverScript: voiceoverScript,
    scenes: [
      {
        sceneNumber: 1,
        narration: hook,
        onScreenText: "Going to Rome?",
        visualDirection:
          "Fast aerial view of central Rome followed by crowded tourist streets.",
        estimatedSeconds: 7
      },
      {
        sceneNumber: 2,
        narration:
          "Avoid restaurants beside major attractions and walk a few streets away.",
        onScreenText: "Skip tourist-trap restaurants",
        visualDirection:
          "Contrast an overpriced tourist menu with a busy local restaurant.",
        estimatedSeconds: 10
      },
      {
        sceneNumber: 3,
        narration:
          "Explore central Rome on foot and carry clothing suitable for church visits.",
        onScreenText: "Walk more · Dress respectfully",
        visualDirection:
          "Walking shot through Rome followed by a church entrance sign.",
        estimatedSeconds: 11
      },
      {
        sceneNumber: 4,
        narration:
          "Slow down, avoid packing every landmark into one day, and protect valuables in crowds.",
        onScreenText: "Slow down · Stay aware",
        visualDirection:
          "Relaxed café scene transitioning to a crowded station.",
        estimatedSeconds: 13
      },
      {
        sceneNumber: 5,
        narration:
          "Plan carefully and follow for more useful travel advice.",
        onScreenText: "Follow for more travel tips",
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
