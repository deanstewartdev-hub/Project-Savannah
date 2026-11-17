/****************************************************
 * Project Savannah - ScriptEngine hand-run self-tests
 *
 * Moved verbatim from Scripts/Script_Engine.js (modular refactor,
 * November 2026) so the production file holds production code only. The functions keep
 * their global names and still appear in the Apps Script editor's Run menu. Nothing here
 * runs automatically; tests with real side effects stay behind assertLiveTestAllowed_.
 ****************************************************/

/**
 * Tests invalid idea protection.
 *
 * No AI request is made.
 *
 * @return {boolean} True when rejected.
 */
function testScriptEngineRejectsInvalidIdea() {
  try {
    ScriptEngine.prepareRequest(
      {
        title:
          "Idea without an identifier"
      },
      {}
    );
  } catch (error) {
    Logger.log(error.message);
    Logger.log(
      "Script Engine invalid-idea test completed successfully."
    );

    return true;
  }

  throw new Error(
    "Script Engine accepted an idea without an ID."
  );
}

/**
 * Tests prompt and schema preparation.
 *
 * No AI request is made.
 *
 * @return {Object} Prepared request.
 */
function testScriptEnginePreparesRequest() {
  const request =
    ScriptEngine.prepareRequest(
      createScriptEngineIdeaFixture_(),
      {
        targetDurationSeconds: 50,
        minimumWordCount: 100,
        maximumWordCount: 145
      }
    );

  if (
    !request.prompt ||
    typeof request.prompt !== "string"
  ) {
    throw new Error(
      "Script Engine did not prepare a prompt."
    );
  }

  if (
    !request.schema ||
    request.schema.type !==
      "json_schema"
  ) {
    throw new Error(
      "Script Engine did not prepare the script schema."
    );
  }

  if (
    request.engineVersion !==
    ScriptEngine.getEngineVersion()
  ) {
    throw new Error(
      "Script Engine returned an incorrect version."
    );
  }

  Logger.log(
    JSON.stringify(request, null, 2)
  );

  Logger.log(
    "Script Engine request-preparation test completed successfully."
  );

  return request;
}

/**
 * Runs safe Script Engine unit tests.
 *
 * No AI request is made.
 *
 * @return {Object} Unit-test summary.
 */
function testScriptEngineUnitTests() {
  testScriptEngineRejectsInvalidIdea();
  testScriptEnginePreparesRequest();

  const result = {
    passed: true,
    testsRun: 2,
    liveProviderCalled: false,
    engineVersion:
      ScriptEngine.getEngineVersion()
  };

  Logger.log(
    JSON.stringify(result, null, 2)
  );

  Logger.log(
    "All Script Engine unit tests completed successfully."
  );

  return result;
}

/**
 * Runs the complete live Script Engine workflow.
 *
 * This function:
 * - Calls OpenAI.
 * - Creates a real Scripts record.
 * - Creates real Logs records.
 * - Creates a real Cost record.
 *
 * @return {Object} Complete workflow result.
 */
function testScriptEngineLiveWorkflow() {
  assertLiveTestAllowed_("testScriptEngineLiveWorkflow");
  const result =
    ScriptEngine.generateScript(
      createScriptEngineIdeaFixture_(),
      {
        targetDurationSeconds: 50,
        minimumWordCount: 100,
        maximumWordCount: 145,
        status: "FORMATTED"
      }
    );

  if (
    !result ||
    result.success !== true
  ) {
    throw new Error(
      "Script Engine live workflow did not succeed."
    );
  }

  if (!result.scriptId) {
    throw new Error(
      "Script Engine did not create a Script ID."
    );
  }

  const storedScript =
    ScriptsRepository.getScriptById(
      result.scriptId
    );

  if (!storedScript) {
    throw new Error(
      "Script Engine saved result could not be retrieved."
    );
  }

  if (
    storedScript.ideaId !==
    result.ideaId
  ) {
    throw new Error(
      "Stored script has the wrong Idea ID."
    );
  }

  Logger.log(
    JSON.stringify(result, null, 2)
  );

  Logger.log(
    "Script Engine live workflow test completed successfully."
  );

  return result;
}

/**
 * Creates the Script Engine test idea.
 *
 * @return {Object} Test idea.
 */
function createScriptEngineIdeaFixture_() {
  return {
    id:
      "IDEA-SCRIPT-ENGINE-TEST",

    videoIdea:
      "Five mistakes first-time visitors make in Rome",

    hook:
      "Visiting Rome soon? Avoid these five mistakes that can ruin your trip.",

    targetAudience:
      "First-time travellers planning a holiday to Rome",

    niche:
      "Travel advice"
  };
}
