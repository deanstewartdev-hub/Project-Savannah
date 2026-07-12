/****************************************************
 * Project Savannah v1.2
 * Script_PromptLibrary.js
 *
 * Purpose:
 * Build versioned prompts for YouTube Shorts scripts.
 *
 * Responsibilities:
 * - Validate prompt input.
 * - Apply script-generation defaults.
 * - Build the script-generation prompt.
 * - Expose the prompt version.
 *
 * Must not:
 * - Call AI providers.
 * - Access Google Sheets.
 * - Save scripts.
 * - Validate AI responses.
 ****************************************************/

const ScriptPromptLibrary = (() => {
  const PROMPT_VERSION = "scripts-v1.0";

  const DEFAULT_OPTIONS = Object.freeze({
    targetDurationSeconds: 50,
    minimumWordCount: 105,
    maximumWordCount: 145,
    tone: "Fast-paced, useful, friendly and confident",
    language: "British English",
    callToActionStyle: "Short, natural and relevant"
  });

  /**
   * Builds a script-generation prompt from an idea.
   *
   * Expected idea shape:
   * {
   *   ideaId: string,
   *   niche: string,
   *   videoIdea: string,
   *   hook: string,
   *   targetAudience: string
   * }
   *
   * @param {Object} idea Source idea.
   * @param {Object=} options Optional script settings.
   * @return {string} Complete AI prompt.
   */
  function buildScriptPrompt(idea, options) {
    validateIdea_(idea);

    const settings = resolveOptions_(options);

    return [
      "Create one original YouTube Short script using the source idea below.",
      "",
      "SOURCE IDEA",
      "Idea ID: " + sanitisePromptValue_(idea.ideaId || ""),
      "Niche: " + sanitisePromptValue_(idea.niche),
      "Video idea: " + sanitisePromptValue_(idea.videoIdea),
      "Original hook: " + sanitisePromptValue_(idea.hook),
      "Target audience: " +
        sanitisePromptValue_(idea.targetAudience),
      "",
      "SCRIPT REQUIREMENTS",
      "- Write in " + settings.language + ".",
      "- Use this tone: " + settings.tone + ".",
      "- Target approximately " +
        settings.targetDurationSeconds +
        " seconds.",
      "- Keep the voiceover between " +
        settings.minimumWordCount +
        " and " +
        settings.maximumWordCount +
        " words.",
      "- Begin immediately with a strong hook.",
      "- Do not use introductions such as 'Welcome back' or " +
        "'In today’s video'.",
      "- Use concise, natural sentences suitable for spoken delivery.",
      "- The narration must remain understandable without visuals.",
      "- Deliver clearly on the promise made by the title and hook.",
      "- Avoid filler, repetition and generic statements.",
      "- Do not invent statistics, quotations or precise claims.",
      "- When a claim may require verification, mention it briefly in " +
        "generationNotes.",
      "- Do not imitate a named creator or reproduce copyrighted scripts.",
      "- End with a call to action that is " +
        settings.callToActionStyle +
        ".",
      "",
      "SCENE REQUIREMENTS",
      "- Divide the script into 3 to 12 sequential scenes.",
      "- Scene numbers must begin at 1 and increase by exactly 1.",
      "- Each scene must contain narration.",
      "- Each scene must contain concise on-screen text.",
      "- Each scene must contain a practical visual direction.",
      "- Each scene must include an estimated duration in seconds.",
      "- The combined scene duration should closely match the declared " +
        "estimatedDurationSeconds.",
      "- The complete script must fit between 30 and 60 seconds.",
      "",
      "OUTPUT REQUIREMENTS",
      "- Return only data matching the supplied JSON schema.",
      "- Do not include markdown.",
      "- Do not include code fences.",
      "- Do not include commentary outside the structured response.",
      "- generationNotes must be an empty string when no warning or " +
        "assumption is needed.",
      "",
      "QUALITY CHECK",
      "Before returning the response, confirm internally that:",
      "1. The hook is strong and appears at the beginning.",
      "2. The voiceover is within the requested word range.",
      "3. Scene numbers are sequential.",
      "4. The scene durations approximately match the total duration.",
      "5. Every required JSON field is populated."
    ].join("\n");
  }

  /**
   * Returns the current script prompt version.
   *
   * @return {string} Prompt version.
   */
  function getPromptVersion() {
    return PROMPT_VERSION;
  }

  /**
   * Returns the default script-generation options.
   *
   * A new object is returned to prevent callers from mutating
   * the internal defaults.
   *
   * @return {Object} Script-generation defaults.
   */
  function getDefaultOptions() {
    return {
      targetDurationSeconds:
        DEFAULT_OPTIONS.targetDurationSeconds,

      minimumWordCount:
        DEFAULT_OPTIONS.minimumWordCount,

      maximumWordCount:
        DEFAULT_OPTIONS.maximumWordCount,

      tone:
        DEFAULT_OPTIONS.tone,

      language:
        DEFAULT_OPTIONS.language,

      callToActionStyle:
        DEFAULT_OPTIONS.callToActionStyle
    };
  }

  /**
   * Combines supplied options with defaults.
   *
   * @param {Object=} options Optional overrides.
   * @return {Object} Resolved options.
   */
  function resolveOptions_(options) {
    const suppliedOptions = options || {};

    const resolved = {
      targetDurationSeconds: resolveNumberOption_(
        suppliedOptions.targetDurationSeconds,
        DEFAULT_OPTIONS.targetDurationSeconds
      ),

      minimumWordCount: resolveNumberOption_(
        suppliedOptions.minimumWordCount,
        DEFAULT_OPTIONS.minimumWordCount
      ),

      maximumWordCount: resolveNumberOption_(
        suppliedOptions.maximumWordCount,
        DEFAULT_OPTIONS.maximumWordCount
      ),

      tone: resolveStringOption_(
        suppliedOptions.tone,
        DEFAULT_OPTIONS.tone
      ),

      language: resolveStringOption_(
        suppliedOptions.language,
        DEFAULT_OPTIONS.language
      ),

      callToActionStyle: resolveStringOption_(
        suppliedOptions.callToActionStyle,
        DEFAULT_OPTIONS.callToActionStyle
      )
    };

    validateOptions_(resolved);

    return resolved;
  }

  /**
   * Validates the source idea.
   *
   * @param {Object} idea Source idea.
   */
  function validateIdea_(idea) {
    if (!idea || typeof idea !== "object") {
      throw new Error(
        "A valid idea is required to build a script prompt."
      );
    }

    const requiredFields = [
      "niche",
      "videoIdea",
      "hook",
      "targetAudience"
    ];

    requiredFields.forEach(function (fieldName) {
      if (
        typeof idea[fieldName] !== "string" ||
        !idea[fieldName].trim()
      ) {
        throw new Error(
          "Script prompt idea is missing " + fieldName + "."
        );
      }
    });
  }

  /**
   * Validates resolved prompt options.
   *
   * @param {Object} options Resolved options.
   */
  function validateOptions_(options) {
    if (
      options.targetDurationSeconds < 30 ||
      options.targetDurationSeconds > 60
    ) {
      throw new Error(
        "Script target duration must be between 30 and 60 seconds."
      );
    }

    if (options.minimumWordCount < 1) {
      throw new Error(
        "Script minimum word count must be greater than zero."
      );
    }

    if (
      options.maximumWordCount <
      options.minimumWordCount
    ) {
      throw new Error(
        "Script maximum word count must not be lower than " +
        "the minimum word count."
      );
    }
  }

  /**
   * Resolves a numeric option while preserving valid zero values.
   *
   * @param {*} value Candidate value.
   * @param {number} fallback Default value.
   * @return {number} Resolved numeric value.
   */
  function resolveNumberOption_(value, fallback) {
    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      return fallback;
    }

    const numericValue = Number(value);

    if (!isFinite(numericValue)) {
      throw new Error(
        "Script prompt numeric options must contain valid numbers."
      );
    }

    return numericValue;
  }

  /**
   * Resolves a string option.
   *
   * @param {*} value Candidate value.
   * @param {string} fallback Default value.
   * @return {string} Resolved string.
   */
  function resolveStringOption_(value, fallback) {
    if (
      value === undefined ||
      value === null ||
      !String(value).trim()
    ) {
      return fallback;
    }

    return String(value).trim();
  }

  /**
   * Cleans a value before inserting it into the prompt.
   *
   * @param {*} value Prompt value.
   * @return {string} Sanitised text.
   */
  function sanitisePromptValue_(value) {
    return String(value || "")
      .replace(/\r?\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return {
    buildScriptPrompt: buildScriptPrompt,
    getPromptVersion: getPromptVersion,
    getDefaultOptions: getDefaultOptions
  };
})();

/**
 * Tests the script prompt library without calling OpenAI.
 *
 * @return {Object} Test result.
 */
function testScriptPromptLibrary() {
  const testIdea = {
    ideaId: "TEST-IDEA-001",
    niche: "Travel facts",
    videoIdea: "Five mistakes tourists make in Rome",
    hook:
      "Most tourists make at least one of these mistakes in Rome.",
    targetAudience:
      "People planning their first trip to Rome"
  };

  const prompt =
    ScriptPromptLibrary.buildScriptPrompt(
      testIdea
    );

  const requiredPromptContent = [
    "Five mistakes tourists make in Rome",
    "People planning their first trip to Rome",
    "105 and 145 words",
    "3 to 12 sequential scenes",
    "Return only data matching the supplied JSON schema"
  ];

  requiredPromptContent.forEach(function (expectedText) {
    if (prompt.indexOf(expectedText) === -1) {
      throw new Error(
        "Script prompt is missing required content: " +
        expectedText
      );
    }
  });

  if (
    ScriptPromptLibrary.getPromptVersion() !==
    "scripts-v1.0"
  ) {
    throw new Error(
      "Unexpected script prompt version."
    );
  }

  Logger.log(prompt);

  Logger.log(
    "Script prompt library test completed successfully."
  );

  return {
    promptVersion:
      ScriptPromptLibrary.getPromptVersion(),

    prompt:
      prompt,

    defaults:
      ScriptPromptLibrary.getDefaultOptions()
  };
}