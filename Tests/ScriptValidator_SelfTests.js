/****************************************************
 * Project Savannah - ScriptValidator hand-run self-tests
 *
 * Moved verbatim from Scripts/Script_Validator.js (modular refactor,
 * November 2026) so the production file holds production code only. The functions keep
 * their global names and still appear in the Apps Script editor's Run menu. Nothing here
 * runs automatically; tests with real side effects stay behind assertLiveTestAllowed_.
 ****************************************************/

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
  // The validator counts the scene narration (the text that is actually narrated), not this
  // field, so the narration is shortened too.
  script.scenes.forEach(function (scene, index) {
    scene.narration = index === 0 ? script.hook : "Far too short.";
  });

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

  // The scenes carry the whole narration (the validator counts scene narration, not this field), so the
  // voiceover is exactly the scene narration joined. 114 words, about 49.57 seconds.
  const voiceoverScript = [
    hook,
    "First, never eat beside the biggest tourist attractions, because prices rise while quality often drops.",
    "Walk a few streets away and look for smaller restaurants filled with local customers.",
    "Second, do not rely entirely on taxis, because central Rome is compact and best explored on foot.",
    "Third, remember that many churches enforce modest clothing, especially during warmer months.",
    "Fourth, avoid trying to see every landmark in one day.",
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
        narration:
          hook + " " + "First, never eat beside the biggest tourist attractions, because prices rise while quality often drops.",
        onScreenText:
          "Going to Rome?",
        visualDirection:
          "Fast aerial view of central Rome followed by crowded tourist streets.",
        estimatedSeconds: 11.3
      },
      {
        sceneNumber: 2,
        narration:
          "Walk a few streets away and look for smaller restaurants filled with local customers. Second, do not rely entirely on taxis, because central Rome is compact and best explored on foot.",
        onScreenText:
          "Skip tourist-trap restaurants",
        visualDirection:
          "Contrast an overpriced tourist menu with a busy local restaurant.",
        estimatedSeconds: 13.48
      },
      {
        sceneNumber: 3,
        narration:
          "Third, remember that many churches enforce modest clothing, especially during warmer months. Fourth, avoid trying to see every landmark in one day.",
        onScreenText:
          "Walk more · Dress respectfully",
        visualDirection:
          "Walking shot through Rome followed by a church entrance sign.",
        estimatedSeconds: 9.57
      },
      {
        sceneNumber: 4,
        narration:
          "Finally, keep valuables secure in crowded stations and around major attractions. Plan carefully, stay aware, and your first Roman holiday will be far more enjoyable.",
        onScreenText:
          "Slow down · Stay aware",
        visualDirection:
          "Relaxed café scene transitioning to a crowded station.",
        estimatedSeconds: 10.87
      },
      {
        sceneNumber: 5,
        narration:
          "Follow for more practical travel advice before your next adventure.",
        onScreenText:
          "Follow for more travel tips",
        visualDirection:
          "Sunset view over Rome with a clean follow animation.",
        estimatedSeconds: 4.35
      }
    ],

    callToAction:
      "Follow for more practical travel advice before your next adventure.",

    estimatedDurationSeconds: 49.57,

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
