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
  const PROMPT_VERSION = "scripts-v1.4-benchmark-ready";

  const DEFAULT_OPTIONS = Object.freeze({
    targetDurationSeconds: 50,
    minimumWordCount: 99,
    maximumWordCount: 125,
    tone: "Fast-paced, conversational, vivid and confident",
    language: "British English",
    callToActionStyle: "Eight words or fewer, natural and relevant"
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
    const narrationMidpoint = Math.round((settings.minimumWordCount + settings.maximumWordCount) / 2);

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
      "- The combined words across every scene's narration field, added together, must total between " +
        settings.minimumWordCount +
        " and " +
        settings.maximumWordCount +
        " words - this combined scene narration is the actual spoken and rendered narration.",
      "- Longer target durations require proportionally more spoken narration; do not pad with silent scenes.",
      "- Rewrite the source hook when needed; do not preserve weak wording.",
      "- Begin with an 8 to 15 word hook that creates a specific curiosity gap; the hook must never exceed 18 words, so stay comfortably under that limit.",
      "- Write scene 1's narration to begin with that exact hook text, word for word; do not paraphrase or shorten it there, and do not write a separate, different spoken hook.",
      "- Make the first spoken line understandable in under two seconds.",
      "- Prefer surprise, consequence, contrast or an unanswered question over hype.",
      "- Never begin with 'Did you know', 'Here are', 'Welcome', 'Today', or 'In this video'.",
      "- Do not use introductions such as 'Welcome back' or " +
        "'In today’s video'.",
      "- Use short, clean sentences suitable for spoken delivery and captions.",
      "- Keep most sentences below 14 words and vary their rhythm.",
      "- Use punctuation deliberately so text-to-speech sounds natural, expressive and unhurried.",
      "- Write difficult names and numbers in a form that can be pronounced clearly.",
      "- The narration must remain understandable without visuals.",
      "- Deliver clearly on the promise made by the title and hook.",
      "- Open a question in the hook, build tension, and delay the clearest payoff until the final third.",
      "- Add a new reveal, consequence or pattern interrupt every one or two sentences.",
      "- Lead with a strong example, escalate, and save the most surprising useful detail for last.",
      "- Avoid filler, repetition, throat-clearing, fake urgency and generic statements.",
      "- Avoid robotic list transitions such as 'firstly', 'secondly' and 'finally'.",
      "- Do not repeat the title, hook or the same fact in different words.",
      "- Do not invent statistics, quotations or precise claims.",
      "- When a claim may require verification, mention it briefly in " +
        "generationNotes.",
      "- Do not imitate a named creator or reproduce copyrighted scripts.",
      "- Place the payoff before the call to action.",
      "- Make the call to action a natural extension of the story, preferably inviting a specific comment or follow.",
      "- End with a call to action that is " +
        settings.callToActionStyle +
        ".",
      "",
      "SCENE REQUIREMENTS",
      "- Divide the script into 4 to 6 sequential scenes.",
      "- Plan roughly " + narrationMidpoint +
        " total narration words divided across however many scenes you use, as a planning target, not a separate validation rule: " +
        "about " + Math.round(narrationMidpoint / 4) + " words per scene across 4 scenes, " +
        Math.round(narrationMidpoint / 5) + " across 5 scenes, or " +
        Math.round(narrationMidpoint / 6) + " across 6 scenes. Scene 1 may run slightly longer because it carries the hook.",
      "- Six short scenes that only add up to a fraction of the target (for example, far under " + narrationMidpoint +
        " words in total) fail validation just as badly as one long scene would; keep every scene's narration substantial.",
      "- Scene numbers must begin at 1 and increase by exactly 1.",
      "- Each scene must contain narration.",
      "- Scene narration is the exact spoken and rendered narration; write voiceoverScript only after every scene's narration is finished.",
      "- Each scene must contain concise on-screen text.",
      "- Keep on-screen text to 2 to 5 words; do not write full sentences.",
      "- Each scene must contain a practical visual direction naming a subject, action, setting and camera composition.",
      "- Write each visual direction as a renderer-independent shot brief that can be tested unchanged across different image or video models.",
      "- Give each scene one clear primary physical action, its motion intensity, and an audio-relevant beat that should align with the narration.",
      "- Prioritise believable physics and continuity of subject identity, wardrobe, props, location and lighting between connected scenes.",
      "- Avoid risky multi-subject choreography unless it is essential; simplify complex motion to one readable action and one camera move.",
      "- Make every visual direction work both as a strong still frame and as a future image-to-video prompt.",
      "- Do not name a video generator or model in the visual direction.",
      "- The opening visual must communicate the topic immediately, even with the sound off.",
      "- Change the subject, action or camera composition in every scene to create a visible pattern interrupt.",
      "- Use original visual concepts. Do not request stock footage, logos, watermarks, celebrities, copyrighted characters or another creator's style.",
      "- Keep every scene at 15 seconds or less so the visual never lingers after its narration beat.",
      "- Each scene must include an estimated duration in seconds.",
      "- The combined scene duration should closely match the declared " +
        "estimatedDurationSeconds.",
      "- The complete script must fit between 30 and 60 seconds.",
      "- voiceoverScript must exactly reproduce every scene's narration joined in order, word for word, with no additions, omissions or rewording.",
      "- Never make voiceoverScript longer than the combined scene narration, and never summarise or shorten scene narration relative to voiceoverScript.",
      "- Do not create a separate narrator intro or outro outside the scenes.",
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
      "1. The hook creates curiosity, avoids banned openings, is at most 18 words, and appears word for word at the very start of scene 1's narration.",
      "2. The combined scene narration is within the requested word range, and voiceoverScript exactly matches it.",
      "3. Scene numbers are sequential.",
      "4. The scene durations approximately match the total duration.",
      "5. The final third contains the promised payoff.",
      "6. Every scene has a distinct, physically plausible visual action and concise caption.",
      "7. Visual directions are model-neutral, continuity-aware and include a clear motion beat.",
      "8. Every required JSON field is populated."
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
    "99 and 125 words",
    "4 to 6 sequential scenes",
    "8 to 15 word hook",
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
    "scripts-v1.4-benchmark-ready"
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
