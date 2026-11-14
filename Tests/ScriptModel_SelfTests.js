/****************************************************
 * Project Savannah - ScriptModel hand-run self-tests
 *
 * Moved verbatim from Models/Script.js (modular refactor,
 * November 2026) so the production file holds production code only. The functions keep
 * their global names and still appear in the Apps Script editor's Run menu. Nothing here
 * runs automatically; tests with real side effects stay behind assertLiveTestAllowed_.
 ****************************************************/

/**
 * Tests creation of an empty draft Script model.
 *
 * @return {Object} Created draft.
 */
function testScriptModelCreatesDraft() {
  const script = ScriptModel.create({
    ideaId: "IDEA-TEST-001",
    title: "Five Mistakes Tourists Make in Rome"
  });

  if (!script.id || script.status !== "DRAFT") {
    throw new Error(
      "Script Model did not create a valid draft."
    );
  }

  if (script.version !== 1) {
    throw new Error(
      "New Script Model must begin at version 1."
    );
  }

  if (
    script.modelVersion !==
    ScriptModel.getModelVersion()
  ) {
    throw new Error(
      "Script Model version was not assigned."
    );
  }

  Logger.log(JSON.stringify(script, null, 2));
  Logger.log(
    "Script Model draft test completed successfully."
  );

  return script;
}

/**
 * Tests creation from an idea record.
 *
 * @return {Object} Created Script model.
 */
function testScriptModelCreatesFromIdea() {
  const idea = {
    id: "IDEA-TEST-002",
    title: "Five Rome Mistakes Tourists Always Make",
    category: "Travel",
    status: "NEW"
  };

  const script = ScriptModel.fromIdea(idea);

  if (script.ideaId !== idea.id) {
    throw new Error(
      "Script Model did not preserve the idea ID."
    );
  }

  if (script.title !== idea.title) {
    throw new Error(
      "Script Model did not preserve the idea title."
    );
  }

  if (
    !script.metadata.sourceIdea ||
    script.metadata.sourceIdea.category !==
      "Travel"
  ) {
    throw new Error(
      "Script Model did not preserve source idea metadata."
    );
  }

  Logger.log(JSON.stringify(script, null, 2));
  Logger.log(
    "Script Model from-idea test completed successfully."
  );

  return script;
}

/**
 * Tests creation from a formatter result.
 *
 * @return {Object} Created Script model.
 */
function testScriptModelCreatesFromFormatter() {
  const sourceScript =
    createScriptModelTestFixture_();

  const formattedResult = {
    valid: true,
    formatVersion: "scripts-format-v1.0",
    script: sourceScript,
    metadata: {
      wordCount: 120,
      sceneCount: 3,
      estimatedDurationSeconds: 45
    },
    displayText:
      "TITLE\n" +
      sourceScript.title +
      "\n\nHOOK\n" +
      sourceScript.hook
  };

  const script = ScriptModel.fromFormattedResult(
    formattedResult,
    {
      ideaId: "IDEA-TEST-003",
      promptVersion: "script-prompt-v1.0",
      aiModel: "test-model"
    }
  );

  if (script.status !== "FORMATTED") {
    throw new Error(
      "Formatted Script Model has an incorrect status."
    );
  }

  if (
    script.formatting.formatVersion !==
    "scripts-format-v1.0"
  ) {
    throw new Error(
      "Formatter version was not preserved."
    );
  }

  if (!script.displayText) {
    throw new Error(
      "Formatted display text was not preserved."
    );
  }

  Logger.log(JSON.stringify(script, null, 2));
  Logger.log(
    "Script Model formatter test completed successfully."
  );

  return script;
}

/**
 * Tests Script model updates and version increments.
 *
 * @return {Object} Updated Script model.
 */
function testScriptModelUpdatesVersion() {
  const original = ScriptModel.create({
    ideaId: "IDEA-TEST-004",
    title: "Draft Travel Script"
  });

  const updated = ScriptModel.update(original, {
    title: "Updated Travel Script"
  });

  if (updated.id !== original.id) {
    throw new Error(
      "Script update changed the script ID."
    );
  }

  if (updated.createdAt !== original.createdAt) {
    throw new Error(
      "Script update changed the creation timestamp."
    );
  }

  if (updated.version !== original.version + 1) {
    throw new Error(
      "Script update did not increment the version."
    );
  }

  if (updated.title !== "Updated Travel Script") {
    throw new Error(
      "Script update did not apply changes."
    );
  }

  Logger.log(JSON.stringify(updated, null, 2));
  Logger.log(
    "Script Model update test completed successfully."
  );

  return updated;
}

/**
 * Tests rejection of incomplete generated content.
 *
 * @return {boolean} True when invalid content is rejected.
 */
function testScriptModelRejectsIncompleteGeneratedScript() {
  try {
    ScriptModel.create({
      title: "Incomplete Generated Script",
      status: "GENERATED"
    });
  } catch (error) {
    if (
      error.name !==
      "ScriptModelValidationError"
    ) {
      throw error;
    }

    Logger.log(error.message);
    Logger.log(
      "Incomplete generated Script Model test completed successfully."
    );

    return true;
  }

  throw new Error(
    "Script Model accepted incomplete generated content."
  );
}

/**
 * Tests that cloning does not retain shared references.
 *
 * @return {boolean} True when clone is independent.
 */
function testScriptModelCloneIsIndependent() {
  const original = ScriptModel.create({
    title: "Independent Draft"
  });

  const cloned = ScriptModel.clone(original);
  cloned.metadata.changed = true;

  if (original.metadata.changed === true) {
    throw new Error(
      "Script Model clone retained a shared reference."
    );
  }

  Logger.log(
    "Script Model clone test completed successfully."
  );

  return true;
}

/**
 * Runs all Script Model tests.
 *
 * @return {Object} Test summary.
 */
function testScriptModelAll() {
  testScriptModelCreatesDraft();
  testScriptModelCreatesFromIdea();
  testScriptModelCreatesFromFormatter();
  testScriptModelUpdatesVersion();
  testScriptModelRejectsIncompleteGeneratedScript();
  testScriptModelCloneIsIndependent();

  const result = {
    passed: true,
    testsRun: 6,
    modelVersion: ScriptModel.getModelVersion()
  };

  Logger.log(JSON.stringify(result, null, 2));
  Logger.log(
    "All Script Model tests completed successfully."
  );

  return result;
}

/**
 * Creates a complete Script Model test fixture.
 *
 * @return {Object} Complete script fixture.
 */
function createScriptModelTestFixture_() {
  return {
    title: "Five Rome Mistakes Tourists Always Make",

    hook:
      "Visiting Rome? Avoid these five mistakes that ruin thousands of trips.",

    voiceoverScript:
      "Visiting Rome? Avoid these five mistakes that ruin thousands of trips. " +
      "Avoid restaurants beside major landmarks because prices are often higher. " +
      "Walk several streets away and choose somewhere busy with local customers. " +
      "Explore central Rome on foot rather than relying entirely on taxis. " +
      "Remember that churches may require covered shoulders and knees. " +
      "Do not attempt every landmark in a single rushed day. " +
      "Slow travel gives you more time for local cafés and quieter streets. " +
      "Keep valuables secure around crowded stations and attractions. " +
      "Plan carefully and your first Roman holiday will be much more enjoyable. " +
      "Follow for more practical travel advice before your next adventure.",

    scenes: [
      {
        sceneNumber: 1,
        narration:
          "Visiting Rome? Avoid these common tourist mistakes.",
        onScreenText: "Going to Rome?",
        visualDirection:
          "Fast aerial view of central Rome.",
        estimatedSeconds: 8
      },
      {
        sceneNumber: 2,
        narration:
          "Avoid tourist restaurants and explore central Rome on foot.",
        onScreenText:
          "Skip tourist traps · Walk more",
        visualDirection:
          "Restaurant menu followed by a walking scene.",
        estimatedSeconds: 18
      },
      {
        sceneNumber: 3,
        narration:
          "Dress respectfully, slow down and protect your valuables.",
        onScreenText:
          "Dress respectfully · Stay aware",
        visualDirection:
          "Church entrance followed by a crowded station.",
        estimatedSeconds: 19
      }
    ],

    callToAction:
      "Follow for more practical travel advice before your next adventure.",

    estimatedDurationSeconds: 45,
    generationNotes: ""
  };
}
