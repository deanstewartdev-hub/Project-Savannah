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
