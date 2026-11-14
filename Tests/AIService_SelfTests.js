/****************************************************
 * Project Savannah - AIService hand-run self-tests
 *
 * Moved verbatim from AI/AI_AIService.js (modular refactor,
 * November 2026) so the production file holds production code only. The functions keep
 * their global names and still appear in the Apps Script editor's Run menu. Nothing here
 * runs automatically; tests with real side effects stay behind assertLiveTestAllowed_.
 ****************************************************/

/**
 * Tests request validation without calling the provider.
 *
 * @return {boolean} True when invalid input is rejected.
 */
function testAIServiceRejectsInvalidPrompt() {
  try {
    AIService.generate("", {});
  } catch (error) {
    if (error.name !== "AIServiceError") {
      throw error;
    }

    Logger.log(error.message);
    Logger.log(
      "AI Service invalid-prompt test completed successfully."
    );

    return true;
  }

  throw new Error(
    "AI Service accepted an empty prompt."
  );
}

/**
 * Tests schema validation without calling the provider.
 *
 * @return {boolean} True when invalid schema is rejected.
 */
function testAIServiceRejectsInvalidSchema() {
  try {
    AIService.generateStructuredContent(
      "Return a structured result.",
      {
        type: "object"
      }
    );
  } catch (error) {
    if (error.name !== "AIServiceError") {
      throw error;
    }

    Logger.log(error.message);
    Logger.log(
      "AI Service invalid-schema test completed successfully."
    );

    return true;
  }

  throw new Error(
    "AI Service accepted an invalid schema."
  );
}

/**
 * Performs a real provider integration test.
 *
 * This test makes a small live AI request and may
 * incur a minimal API charge.
 *
 * @return {Object} AI service response.
 */
function testAIServiceLiveConnection() {
  assertLiveTestAllowed_("testAIServiceLiveConnection");
  const schema = {
    type: "json_schema",
    name:
      "project_savannah_ai_service_test",
    strict: true,

    schema: {
      type: "object",
      additionalProperties: false,

      properties: {
        status: {
          type: "string"
        },

        message: {
          type: "string"
        }
      },

      required: [
        "status",
        "message"
      ]
    }
  };

  const response =
    AIService.generateStructuredContent(
      [
        "Confirm that the Project Savannah",
        "AI service is operational.",
        "Return status as success and",
        "a short confirmation message."
      ].join(" "),
      schema,
      {
        temperature: 0,
        maxTokens: 150,

        systemMessage:
          "You are testing the Project Savannah AI service. " +
          "Return only data matching the supplied schema.",

        retry: {
          maxAttempts: 2,
          initialDelayMilliseconds: 500,
          backoffMultiplier: 2
        },

        metadata: {
          testName:
            "AI Service live connection"
        }
      }
    );

  if (response.success !== true) {
    throw new Error(
      "AI Service live test did not succeed."
    );
  }

  if (
    !response.data ||
    typeof response.data.status !==
      "string" ||
    typeof response.data.message !==
      "string"
  ) {
    throw new Error(
      "AI Service live test returned an invalid data structure."
    );
  }

  if (
    response.serviceVersion !==
    AIService.getServiceVersion()
  ) {
    throw new Error(
      "AI Service returned the wrong service version."
    );
  }

  Logger.log(
    JSON.stringify(response, null, 2)
  );

  Logger.log(
    "AI Service live connection test completed successfully."
  );

  return response;
}

/**
 * Runs the safe AI Service unit tests.
 *
 * This function does not call the AI provider.
 *
 * @return {Object} Unit-test summary.
 */
function testAIServiceUnitTests() {
  testAIServiceRejectsInvalidPrompt();
  testAIServiceRejectsInvalidSchema();

  const result = {
    passed: true,
    testsRun: 2,
    liveProviderCalled: false,
    serviceVersion:
      AIService.getServiceVersion()
  };

  Logger.log(
    JSON.stringify(result, null, 2)
  );

  Logger.log(
    "All AI Service unit tests completed successfully."
  );

  return result;
}

/**
 * Runs unit tests followed by the live integration test.
 *
 * This function makes one real AI request.
 *
 * @return {Object} Full-test summary.
 */
function testAIServiceAll() {
  testAIServiceUnitTests();

  const liveResult =
    testAIServiceLiveConnection();

  const result = {
    passed: true,
    testsRun: 3,
    liveProviderCalled: true,
    provider:
      liveResult.provider,
    model:
      liveResult.model,
    serviceVersion:
      AIService.getServiceVersion()
  };

  Logger.log(
    JSON.stringify(result, null, 2)
  );

  Logger.log(
    "All AI Service tests completed successfully."
  );

  return result;
}
