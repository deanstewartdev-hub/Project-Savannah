/****************************************************
 * Project Savannah
 * Script_Validator_Text.js
 *
 * Purpose:
 * The text-quality rules of script validation: hook placement and strength,
 * call-to-action length, narration cadence, markdown and placeholder checks,
 * plus the word-counting and text-normalising helpers the other rules share.
 * Each rule appends its messages to the errors list it is given.
 *
 * Split out of Scripts/Script_Validator.js (modular refactor, November 2026). The function
 * bodies are unchanged. ScriptValidator remains the public entry point; nothing outside
 * it should call this module directly.
 ****************************************************/

const ScriptValidatorText = (() => {
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
    validateHookPlacement: validateHookPlacement_,
    validateHookQuality: validateHookQuality_,
    validateCallToActionQuality: validateCallToActionQuality_,
    validateNarrationCadence: validateNarrationCadence_,
    validateNoMarkdown: validateNoMarkdown_,
    validateNoPlaceholders: validateNoPlaceholders_,
    countWords: countWords_,
    normaliseComparableText: normaliseComparableText_,
    roundNumber: roundNumber_
  };
})();
