/****************************************************
 * Project Savannah - guard for in-app tests with real side effects.
 *
 * Some test* functions call paid providers (OpenAI) or write real rows to the
 * production spreadsheet. They appear in the Apps Script editor's Run menu, so
 * one mis-click spends money or pollutes data. Each such test calls this first.
 * To run one deliberately, set the script property SAVANNAH_ALLOW_LIVE_TESTS
 * to "true", run it, then delete the property again.
 ****************************************************/
function assertLiveTestAllowed_(testName) {
  const allowed = PropertiesService.getScriptProperties().getProperty("SAVANNAH_ALLOW_LIVE_TESTS") === "true";
  if (!allowed) {
    throw new Error("Refused: " + testName + " calls paid services or writes real spreadsheet rows. To run it on " +
      "purpose, set the script property SAVANNAH_ALLOW_LIVE_TESTS = true, run it, then delete that property.");
  }
}
