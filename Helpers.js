/****************************************************
 * Project Savannah v1.0
 * Helpers.gs
 ****************************************************/

function deleteSheetIfExists(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);

  if (sheet) {
    ss.deleteSheet(sheet);
  }
}
/****************************************************
 * Project Savannah v1.0
 * Sheet Setup Helpers
 ****************************************************/

function setupSettingsSheet(ss) {
  const sheet = getOrCreateSheet(ss, SHEETS.SETTINGS);
  resetSheet(sheet);

  const rows = [
    ["Setting", "Value", "Notes"],
    ["OPENAI_API_KEY", "", "Paste your OpenAI API key here later"],
    ["AI_PROVIDER", "OpenAI", "Current AI provider"],
    ["OPENAI_MODEL", DEFAULT_MODEL, "Default low-cost model"],
    ["AI_TEMPERATURE", 0.8, "Creativity level"],
    ["AI_MAX_TOKENS", 1200, "Maximum response size"],
    ["IDEAS_PER_RUN", 3, "How many ideas to generate per click"],
    ["NICHE", "Travel facts", "Main content niche"],
    ["TARGET_AUDIENCE", "People who enjoy short educational videos", "Who the Shorts are for"],
    ["PROJECT_VERSION", PROJECT_VERSION, "Current system version"]
  ];

  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  formatHeaderRow(sheet, 1, 3);

  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 300);
  sheet.setColumnWidth(3, 500);
  sheet.setFrozenRows(1);
}

function setupIdeasSheet(ss) {
  const sheet = getOrCreateSheet(ss, SHEETS.IDEAS);
  resetSheet(sheet);

  const headers = [
    "Idea ID",
    "Created At",
    "Niche",
    "Video Idea",
    "Hook",
    "Target Audience",
    "Status",
    "Model Used",
    "Prompt Version",
    "Run ID"
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  formatHeaderRow(sheet, 1, headers.length);
  sheet.setFrozenRows(1);
}

function setupScriptsSheet(ss) {
  const sheet = getOrCreateSheet(ss, SHEETS.SCRIPTS);
  resetSheet(sheet);

  const headers = [
    "Script ID",
    "Idea ID",
    "Created At",
    "Video Title",
    "Voiceover Script",
    "On-Screen Text",
    "CTA",
    "Word Count",
    "Status"
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  formatHeaderRow(sheet, 1, headers.length);
  sheet.setFrozenRows(1);
}

function setupSeoPackSheet(ss) {
  const sheet = getOrCreateSheet(ss, SHEETS.SEO_PACK);
  resetSheet(sheet);

  const headers = [
    "SEO ID",
    "Idea ID",
    "Created At",
    "Title Option 1",
    "Title Option 2",
    "Description",
    "Tags",
    "Hashtags",
    "Keywords"
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  formatHeaderRow(sheet, 1, headers.length);
  sheet.setFrozenRows(1);
}

function setupApprovalQueueSheet(ss) {
  const sheet = getOrCreateSheet(ss, SHEETS.APPROVAL_QUEUE);
  resetSheet(sheet);

  const headers = [
    "Queue ID",
    "Idea ID",
    "Created At",
    "Item Type",
    "Item Summary",
    "Approval Status",
    "Reviewer Notes",
    "Approved At"
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  formatHeaderRow(sheet, 1, headers.length);
  sheet.setFrozenRows(1);
}

function setupLogsSheet(ss) {
  const sheet = getOrCreateSheet(ss, SHEETS.LOGS);
  resetSheet(sheet);

  const headers = [
    "Log ID",
    "Timestamp",
    "Run ID",
    "Action",
    "Status",
    "Message",
    "Error Details"
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  formatHeaderRow(sheet, 1, headers.length);
  sheet.setFrozenRows(1);
}

function setupCostsSheet(ss) {
  const sheet = getOrCreateSheet(ss, SHEETS.COSTS);
  resetSheet(sheet);

  const headers = [
    "Cost ID",
    "Timestamp",
    "Run ID",
    "Model",
    "Input Tokens",
    "Output Tokens",
    "Estimated Cost",
    "Action"
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  formatHeaderRow(sheet, 1, headers.length);
  sheet.setFrozenRows(1);
}

function getOrCreateSheet(ss, sheetName) {
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  return sheet;
}

function resetSheet(sheet) {
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).breakApart();
  sheet.clear();
}

function formatHeaderRow(sheet, rowNumber, numberOfColumns) {
  sheet.getRange(rowNumber, 1, 1, numberOfColumns)
    .setFontWeight("bold")
    .setBackground("#1F4E79")
    .setFontColor("#FFFFFF");

  sheet.autoResizeColumns(1, numberOfColumns);
}

function deleteSheetIfExists(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);

  if (sheet) {
    ss.deleteSheet(sheet);
  }
}

function getSettingValue(ss, settingName) {
  const sheet = ss.getSheetByName(SHEETS.SETTINGS);
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === settingName) {
      return values[i][1];
    }
  }

  return "";
}