/****************************************************
 * Project Savannah v1.0
 * Main.gs
 ****************************************************/

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Project Savannah")
    .addItem("Setup v1.0 Sheet", "setupProjectSavannah")
    .addSeparator()
    .addItem("Configure OpenAI API Key", "configureOpenAIKey")
    .addItem("Test OpenAI Connection", "testOpenAIConnection")
    .addItem("Generate 3 Video Ideas", "generateThreeVideoIdeas")
    .addToUi();
}

function setupProjectSavannah() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  setupSettingsSheet(ss);
  setupIdeasSheet(ss);
  setupScriptsSheet(ss);
  setupSeoPackSheet(ss);
  setupApprovalQueueSheet(ss);
  setupLogsSheet(ss);
  setupCostsSheet(ss);

  setupDashboardSheet(ss);

  SpreadsheetApp.getUi().alert("Project Savannah v1.0 setup complete.");
}

function generateThreeVideoIdeas() {
  generateIdeasWorkflow();
}

function configureOpenAIKey() {

  const ui = SpreadsheetApp.getUi();

  const response = ui.prompt(
    "OpenAI API Key",
    "Paste your OpenAI API key below.\n\nIt will be stored securely in Script Properties.",
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  const apiKey = response.getResponseText();

  try {

    Secrets.setOpenAIApiKey(apiKey);

    ui.alert(
      "Success",
      "Your OpenAI API key has been securely stored.",
      ui.ButtonSet.OK
    );

  } catch (err) {

    ui.alert(
      "Error",
      err.message,
      ui.ButtonSet.OK
    );

  }

}