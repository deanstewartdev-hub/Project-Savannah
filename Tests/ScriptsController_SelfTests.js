/****************************************************
 * Project Savannah - ScriptsController hand-run self-tests
 *
 * Moved verbatim from App/ScriptsController.js (modular refactor,
 * November 2026) so the production file holds production code only. The functions keep
 * their global names and still appear in the Apps Script editor's Run menu. Nothing here
 * runs automatically; tests with real side effects stay behind assertLiveTestAllowed_.
 ****************************************************/

/****************************************************
 * Controller tests
 ****************************************************/

/**
 * Tests invalid generation input.
 *
 * No AI request is made.
 *
 * @return {Object} Controller response.
 */
function testScriptsControllerRejectsInvalidRequest() {
  const response =
    ScriptsController.generateScript({
      idea: {
        title:
          "Idea missing its ID"
      }
    });

  if (
    response.success !== false
  ) {
    throw new Error(
      "Scripts Controller accepted an invalid request."
    );
  }

  if (
    response.error.code !==
    "INVALID_REQUEST"
  ) {
    throw new Error(
      "Scripts Controller returned the wrong error code."
    );
  }

  Logger.log(
    JSON.stringify(
      response,
      null,
      2
    )
  );

  Logger.log(
    "Scripts Controller invalid-request test completed successfully."
  );

  return response;
}

/**
 * Tests script listing.
 *
 * No AI request is made.
 *
 * @return {Object} Controller response.
 */
function testScriptsControllerListsScripts() {
  const response =
    ScriptsController.listScripts({
      limit: 10
    });

  if (
    response.success !== true
  ) {
    throw new Error(
      "Scripts Controller could not list scripts."
    );
  }

  if (
    !response.data ||
    !Array.isArray(
      response.data.scripts
    )
  ) {
    throw new Error(
      "Scripts Controller returned an invalid scripts collection."
    );
  }

  Logger.log(
    JSON.stringify(
      response,
      null,
      2
    )
  );

  Logger.log(
    "Scripts Controller list test completed successfully."
  );

  return response;
}

/**
 * Tests script metrics.
 *
 * No AI request is made.
 *
 * @return {Object} Controller response.
 */
function testScriptsControllerMetrics() {
  const response =
    ScriptsController.getMetrics();

  if (
    response.success !== true
  ) {
    throw new Error(
      "Scripts Controller could not load metrics."
    );
  }

  if (
    typeof response.data
      .totalScripts !== "number" ||
    typeof response.data
      .createdToday !== "number"
  ) {
    throw new Error(
      "Scripts Controller returned invalid metrics."
    );
  }

  Logger.log(
    JSON.stringify(
      response,
      null,
      2
    )
  );

  Logger.log(
    "Scripts Controller metrics test completed successfully."
  );

  return response;
}

/**
 * Runs safe Scripts Controller tests.
 *
 * No AI request is made.
 *
 * @return {Object} Test summary.
 */
function testScriptsControllerAll() {
  testScriptsControllerRejectsInvalidRequest();
  testScriptsControllerListsScripts();
  testScriptsControllerMetrics();

  const result = {
    passed: true,
    testsRun: 3,
    liveProviderCalled: false,
    controllerVersion:
      ScriptsController
        .getControllerVersion()
  };

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "All Scripts Controller tests completed successfully."
  );

  return result;
}
