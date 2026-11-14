/****************************************************
 * Project Savannah - ScriptsRepository hand-run self-tests
 *
 * Moved verbatim from Scripts/Scripts_Repository.js (modular refactor,
 * November 2026) so the production file holds production code only. The functions keep
 * their global names and still appear in the Apps Script editor's Run menu. Nothing here
 * runs automatically; tests with real side effects stay behind assertLiveTestAllowed_.
 ****************************************************/

/**
 * Tests creation and verification of the Scripts sheet.
 *
 * @return {boolean} True when successful.
 */
function testScriptsRepositoryEnsuresSheet() {
  const sheet =
    ScriptsRepository.ensureSheet();

  const expectedHeaders =
    ScriptsRepository.getHeaders();

  const actualHeaders = sheet
    .getRange(
      1,
      1,
      1,
      expectedHeaders.length
    )
    .getDisplayValues()[0];

  if (
    JSON.stringify(actualHeaders) !==
    JSON.stringify(expectedHeaders)
  ) {
    throw new Error(
      "Scripts Repository created incorrect headers."
    );
  }

  Logger.log(
    "Scripts Repository sheet test completed successfully."
  );

  return true;
}

/**
 * Tests saving and retrieving a ScriptModel.
 *
 * @return {Object} Retrieved script.
 */
function testScriptsRepositorySaveAndRetrieve() {
  const fixture =
    createScriptsRepositoryFixture_();

  cleanupScriptsRepositoryTestRecord_(
    fixture.id
  );

  const saveResult =
    ScriptsRepository.saveScript(fixture);

  if (
    !saveResult.saved ||
    !saveResult.created
  ) {
    throw new Error(
      "Scripts Repository did not save the test script."
    );
  }

  const storedScript =
    ScriptsRepository.getScriptById(
      fixture.id
    );

  if (!storedScript) {
    throw new Error(
      "Scripts Repository could not retrieve the saved script."
    );
  }

  if (
    storedScript.title !== fixture.title ||
    storedScript.scenes.length !==
      fixture.scenes.length
  ) {
    throw new Error(
      "Scripts Repository returned incorrect script data."
    );
  }

  Logger.log(
    JSON.stringify(storedScript, null, 2)
  );

  cleanupScriptsRepositoryTestRecord_(
    fixture.id
  );

  Logger.log(
    "Scripts Repository save-and-retrieve test completed successfully."
  );

  return storedScript;
}

/**
 * Tests updating a stored ScriptModel.
 *
 * @return {Object} Updated stored script.
 */
function testScriptsRepositoryUpdate() {
  assertLiveTestAllowed_("testScriptsRepositoryUpdate");
  const fixture =
    createScriptsRepositoryFixture_();

  cleanupScriptsRepositoryTestRecord_(
    fixture.id
  );

  ScriptsRepository.saveScript(fixture);

  const updatedModel = ScriptModel.update(
    fixture,
    {
      title:
        "Updated Repository Test Script"
    }
  );

  const updateResult =
    ScriptsRepository.updateScript(
      updatedModel
    );

  if (
    !updateResult.updated ||
    updateResult.version !== 2
  ) {
    throw new Error(
      "Scripts Repository did not report a successful update."
    );
  }

  const storedScript =
    ScriptsRepository.getScriptById(
      fixture.id
    );

  if (
    storedScript.title !==
      "Updated Repository Test Script"
  ) {
    throw new Error(
      "Scripts Repository did not persist the updated title."
    );
  }

  if (storedScript.version !== 2) {
    throw new Error(
      "Scripts Repository did not persist the updated version."
    );
  }

  cleanupScriptsRepositoryTestRecord_(
    fixture.id
  );

  Logger.log(
    "Scripts Repository update test completed successfully."
  );

  return storedScript;
}

/**
 * Tests searching for scripts by idea ID.
 *
 * @return {boolean} True when successful.
 */
function testScriptsRepositoryFindsByIdeaId() {
  const fixture =
    createScriptsRepositoryFixture_();

  cleanupScriptsRepositoryTestRecord_(
    fixture.id
  );

  ScriptsRepository.saveScript(fixture);

  const matchingScripts =
    ScriptsRepository.getScriptsByIdeaId(
      fixture.ideaId
    );

  const found = matchingScripts.some(
    function (script) {
      return script.id === fixture.id;
    }
  );

  cleanupScriptsRepositoryTestRecord_(
    fixture.id
  );

  if (!found) {
    throw new Error(
      "Scripts Repository could not find a script by idea ID."
    );
  }

  Logger.log(
    "Scripts Repository idea search test completed successfully."
  );

  return true;
}

/**
 * Tests duplicate Script ID protection.
 *
 * @return {boolean} True when duplicate is rejected.
 */
function testScriptsRepositoryRejectsDuplicateId() {
  const fixture =
    createScriptsRepositoryFixture_();

  cleanupScriptsRepositoryTestRecord_(
    fixture.id
  );

  ScriptsRepository.saveScript(fixture);

  try {
    ScriptsRepository.saveScript(fixture);
  } catch (error) {
    cleanupScriptsRepositoryTestRecord_(
      fixture.id
    );

    if (
      error.name !==
      "ScriptsRepositoryError"
    ) {
      throw error;
    }

    Logger.log(error.message);
    Logger.log(
      "Scripts Repository duplicate test completed successfully."
    );

    return true;
  }

  cleanupScriptsRepositoryTestRecord_(
    fixture.id
  );

  throw new Error(
    "Scripts Repository accepted a duplicate script ID."
  );
}

/**
 * Runs every Scripts Repository test.
 *
 * Test records are removed after each test.
 *
 * @return {Object} Test summary.
 */
function testScriptsRepositoryAll() {
  testScriptsRepositoryEnsuresSheet();
  testScriptsRepositorySaveAndRetrieve();
  testScriptsRepositoryUpdate();
  testScriptsRepositoryFindsByIdeaId();
  testScriptsRepositoryRejectsDuplicateId();

  const result = {
    passed: true,
    testsRun: 5,
    repositoryVersion:
      ScriptsRepository.getRepositoryVersion()
  };

  Logger.log(JSON.stringify(result, null, 2));
  Logger.log(
    "All Scripts Repository tests completed successfully."
  );

  return result;
}

/**
 * Creates a complete repository test fixture.
 *
 * @return {Object} ScriptModel fixture.
 */
function createScriptsRepositoryFixture_() {
  const testId =
    "SCR-REPOSITORY-TEST";

  return ScriptModel.create({
    id: testId,
    ideaId: "IDEA-REPOSITORY-TEST",

    title:
      "Five Rome Mistakes Tourists Always Make",

    hook:
      "Visiting Rome? Avoid these common tourist mistakes.",

    voiceoverScript:
      "Visiting Rome? Avoid these common tourist mistakes. " +
      "Avoid restaurants beside the busiest attractions. " +
      "Walk several streets away and look for local customers. " +
      "Explore central Rome on foot instead of relying on taxis. " +
      "Dress appropriately before entering churches. " +
      "Slow down rather than rushing every landmark in one day. " +
      "Protect valuables in crowded stations and tourist areas. " +
      "Plan carefully and your Roman holiday will be much more enjoyable. " +
      "Follow for more practical travel advice.",

    scenes: [
      {
        sceneNumber: 1,
        narration:
          "Visiting Rome? Avoid these common tourist mistakes.",
        onScreenText:
          "Going to Rome?",
        visualDirection:
          "Aerial view of central Rome.",
        estimatedSeconds: 8
      },
      {
        sceneNumber: 2,
        narration:
          "Avoid tourist restaurants and explore the city on foot.",
        onScreenText:
          "Skip tourist traps",
        visualDirection:
          "Restaurant menu followed by a walking scene.",
        estimatedSeconds: 18
      },
      {
        sceneNumber: 3,
        narration:
          "Dress respectfully, slow down and protect your valuables.",
        onScreenText:
          "Slow down · Stay aware",
        visualDirection:
          "Church entrance followed by a crowded station.",
        estimatedSeconds: 19
      }
    ],

    callToAction:
      "Follow for more practical travel advice.",

    estimatedDurationSeconds: 45,
    generationNotes: "",

    status: "FORMATTED",

    validation: {
      valid: true
    },

    formatting: {
      valid: true,
      formatVersion:
        "scripts-format-v1.0"
    },

    metadata: {
      testRecord: true
    },

    displayText:
      "TITLE\nFive Rome Mistakes Tourists Always Make",

    promptVersion:
      "script-prompt-v1.0",

    aiModel:
      "repository-test-model"
  });
}

/**
 * Removes the repository test record when present.
 *
 * @param {string} scriptId Test Script ID.
 */
function cleanupScriptsRepositoryTestRecord_(
  scriptId
) {
  try {
    ScriptsRepository.deleteScriptById(
      scriptId
    );
  } catch (error) {
    Logger.log(
      "Repository test cleanup warning: " +
        error.message
    );
  }
}
