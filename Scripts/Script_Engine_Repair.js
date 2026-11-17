/****************************************************
 * Project Savannah
 * Script_Engine_Repair.js
 *
 * Purpose:
 * Support the validation-and-repair loop: recompute honest scene and total
 * timing from the narration word count, and build the correction prompt
 * sent back to the AI when a generated script fails validation.
 *
 * Split out of Scripts/Script_Engine.js (modular refactor, November 2026). The function
 * bodies are unchanged. ScriptEngine remains the public entry point; nothing outside
 * it should call this module directly.
 ****************************************************/

const ScriptEngineRepair = (() => {
  // Real Cloud Run renders (2026-08-14 calibration, jobs cr-5ff223a6.../cr-06a28788...)
  // measured 2.2981 and 2.2097 words/second of actual ElevenLabs narration audio. This uses
  // the faster of the two so the estimate is conservative: a script that clears a duration
  // floor against this rate will, if real narration speaks slightly slower, run LONGER once
  // measured - never shorter. This is only ever a pre-render estimate to let ScriptValidator's
  // duration check mean something; the post-TTS probe result remains the authoritative
  // duration (see RenderQuality_Service.js's evaluateProbe_).
  const NARRATION_WORDS_PER_SECOND_ESTIMATE = 2.3;

  function normaliseGeneratedTiming_(generatedScript) {
    if (!generatedScript || !Array.isArray(generatedScript.scenes) || !generatedScript.scenes.length) return;
    let totalWords = 0;
    const sceneWordCounts = generatedScript.scenes.map(function (scene) {
      const words = countTimingWords_(scene && scene.narration);
      totalWords += words;
      return words;
    });
    generatedScript.scenes.forEach(function (scene, index) {
      scene.estimatedSeconds = roundTiming_(sceneWordCounts[index] / NARRATION_WORDS_PER_SECOND_ESTIMATE, 2);
    });
    generatedScript.estimatedDurationSeconds = roundTiming_(totalWords / NARRATION_WORDS_PER_SECOND_ESTIMATE, 2);
  }

  function countTimingWords_(text) {
    return String(text || "").trim().split(/\s+/).filter(Boolean).length;
  }

  function roundTiming_(value, places) {
    const factor = Math.pow(10, places);
    return Math.round(value * factor) / factor;
  }

  /**
   * Builds a focused correction prompt after validation
   * failure.
   *
   * @param {string} originalPrompt Original prompt.
   * @param {Object} rejectedScript Rejected AI output.
   * @param {Error} validationError Validation error.
   * @param {Object} idea Normalised idea.
   * @param {Object} options Workflow options.
   * @param {number} nextAttempt Next attempt number.
   * @return {string} Correction prompt.
   */
  function buildCorrectionPrompt_(
    originalPrompt,
    rejectedScript,
    validationError,
    idea,
    options,
    nextAttempt
  ) {
    const validationErrors =
      Array.isArray(
        validationError.validationErrors
      )
        ? validationError.validationErrors
        : [validationError.message];

    const rejectedScenes = Array.isArray(rejectedScript && rejectedScript.scenes) ? rejectedScript.scenes : [];
    const currentCanonicalWords = rejectedScenes.reduce(function (total, scene) {
      return total + countTimingWords_(scene && scene.narration);
    }, 0);
    const currentHookWords = countTimingWords_(rejectedScript && rejectedScript.hook);
    const currentSceneCount = rejectedScenes.length;
    const HOOK_MAXIMUM_WORDS = 18;
    const MINIMUM_SCENE_COUNT = 4;
    const MAXIMUM_SCENE_COUNT = 6;
    const sceneCountTooHigh = currentSceneCount > MAXIMUM_SCENE_COUNT;
    const sceneCountTooLow = currentSceneCount > 0 && currentSceneCount < MINIMUM_SCENE_COUNT;
    const sceneCountInvalid = sceneCountTooHigh || sceneCountTooLow;

    // When the rejected script's own scene count is already invalid, fixing it must come
    // first and every later instruction (narration total, "preserve structure") has to defer
    // to the repaired count - not the rejected one. See the 2026-08-17 v88 live proof: a
    // 7-scene rejection was previously told to "preserve the same number of scenes", which
    // directly told the model to keep the invalid count.
    const priorityFixes = [];
    if (sceneCountTooHigh) {
      priorityFixes.push(
        "Reduce the scene count from " + currentSceneCount + " to at most " + MAXIMUM_SCENE_COUNT + " scenes."
      );
      priorityFixes.push(
        "Merge the excess scene(s)' narration and visual content into the remaining scenes rather than deleting information."
      );
      priorityFixes.push(
        "Preserve the important information from the merged scenes while redistributing their narration across the repaired scene set."
      );
      priorityFixes.push(
        "Bring the combined scenes[].narration into " + options.minimumWordCount + " to " + options.maximumWordCount +
          " words (currently " + currentCanonicalWords + ") by adding narration within your repaired, valid scene set."
      );
      priorityFixes.push(
        "Do NOT add scenes to solve a narration-length shortage; add words to existing scene narration instead."
      );
    } else if (sceneCountTooLow) {
      priorityFixes.push(
        "Restructure the script from " + currentSceneCount + " scenes into at least " + MINIMUM_SCENE_COUNT + " scenes."
      );
      priorityFixes.push(
        "Bring the combined scenes[].narration into " + options.minimumWordCount + " to " + options.maximumWordCount +
          " words (currently " + currentCanonicalWords + ") across that repaired, valid scene set."
      );
    } else {
      priorityFixes.push(
        "Combined scenes[].narration currently totals " + currentCanonicalWords +
          " words; it must total between " + options.minimumWordCount + " and " + options.maximumWordCount +
          " words. Expand or reduce the scenes[].narration text itself into that range; do not just edit voiceoverScript."
      );
    }
    priorityFixes.push(
      "script.hook is currently " + currentHookWords + " words; it must be at most " + HOOK_MAXIMUM_WORDS +
        " words (aim for 8 to 15). Rewrite it shorter if it exceeds " + HOOK_MAXIMUM_WORDS + "."
    );
    priorityFixes.push(
      "Scene 1's narration must begin with that corrected hook text, word for word, with no paraphrase and no separate spoken hook."
    );

    return [
      "Revise the rejected YouTube Shorts script below.",
      "",
      "This is correction attempt " +
        nextAttempt +
        ".",
      "",
      "MANDATORY CORRECTIONS:",
      validationErrors
        .map(function (message, index) {
          return (
            (index + 1) +
            ". " +
            message
          );
        })
        .join("\n"),
      "",
      "FIX THESE IN PRIORITY ORDER:",
      priorityFixes
        .map(function (message, index) {
          return (index + 1) + ". " + message;
        })
        .join("\n"),
      "",
      "STRICT REQUIREMENTS:",
      "- scenes[].narration is the canonical field being measured and rendered, not voiceoverScript.",
      "- The final script must contain between " + MINIMUM_SCENE_COUNT + " and " + MAXIMUM_SCENE_COUNT +
        " scenes; never create an extra scene merely to add narration length.",
      sceneCountInvalid
        ? "- The rejected script's scene count (" + currentSceneCount + ") is itself invalid - do not preserve it. " +
          "Once repaired to " + MINIMUM_SCENE_COUNT + "-" + MAXIMUM_SCENE_COUNT + " scenes, keep that corrected " +
          "scene count and structure stable while adjusting narration length."
        : "- Preserve the same number of scenes and the same scene structure while adjusting narration length.",
      "- Redistribute narration across scenes as needed to reach the required total; do not concentrate all the added or removed words in a single scene.",
      "- Once scene narration is corrected, regenerate voiceoverScript as that exact scene narration joined in order, word for word.",
      "- Changing voiceoverScript alone will NOT fix this validation failure; only scenes[].narration is checked.",
      "- Aim for approximately " + Math.round((options.minimumWordCount + options.maximumWordCount) / 2) + " combined scene-narration words. Count the words in scenes[].narration only, not voiceoverScript, before returning JSON.",
      "- Never begin with 'Did you know', 'Here are', 'Welcome', 'Today', or 'In this video'.",
      "- Keep most spoken sentences below 14 words.",
      "- Add a new reveal, consequence or pattern interrupt every one or two sentences.",
      "- Delay the clearest payoff until the final third, before the call to action.",
      "- Keep the call to action to 12 words or fewer.",
      "- Keep on-screen text between 2 and 5 words.",
      "- Give every scene a distinct visual direction naming the subject, action, setting and camera composition.",
      "- Make each visual direction a model-neutral shot brief with one primary action, motion intensity and an audio-relevant beat.",
      "- Preserve subject, wardrobe, prop, location and lighting continuity across connected scenes.",
      "- Prefer believable physics and one readable camera move; simplify risky multi-subject choreography.",
      "- Make every shot usable as both a strong still and a future image-to-video prompt without naming a generator.",
      "- Do not request stock footage, logos, celebrities, copyrighted characters or another creator's style.",
      "- Keep every scene at 15 seconds or less so visuals change with the narration.",
      "- voiceoverScript must exactly reproduce the corrected scenes[].narration joined in order, word for word.",
      "- Keep estimated duration between " +
        options.minimumDurationSeconds +
        " and " +
        options.maximumDurationSeconds +
        " seconds.",
      "- Add every scene duration, then set estimatedDurationSeconds to that exact sum.",
      "- The exact scene-duration sum and estimatedDurationSeconds must both be between 30 and 60 seconds.",
      "- Preserve factual accuracy.",
      "- Do not include Markdown or explanatory text.",
      "- Return only data matching the supplied JSON schema.",
      "",
      "IDEA:",
      idea.title,
      "",
      "REQUIRED HOOK:",
      idea.hook ||
        "Create a powerful opening hook appropriate to the idea.",
      "",
      "REJECTED SCRIPT:",
      JSON.stringify(
        rejectedScript,
        null,
        2
      ),
      "",
      "ORIGINAL GENERATION INSTRUCTIONS:",
      originalPrompt
    ].join("\n");
  }

  return {
    normaliseGeneratedTiming: normaliseGeneratedTiming_,
    buildCorrectionPrompt: buildCorrectionPrompt_
  };
})();
