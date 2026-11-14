/****************************************************
 * Project Savannah - ScriptFormatter hand-run self-tests
 *
 * Moved verbatim from Scripts/Script_Formatter.js (modular refactor,
 * November 2026) so the production file holds production code only. The functions keep
 * their global names and still appear in the Apps Script editor's Run menu. Nothing here
 * runs automatically; tests with real side effects stay behind assertLiveTestAllowed_.
 ****************************************************/

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
