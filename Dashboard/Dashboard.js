/****************************************************
 * Project Savannah v1.0
 * Dashboard.gs
 ****************************************************/

function setupDashboardSheet(ss) {
  deleteSheetIfExists(ss, SHEETS.DASHBOARD);

  const sheet = ss.insertSheet(SHEETS.DASHBOARD, 0);
  buildDashboard(sheet);
}

function buildDashboard(sheet) {
  prepareDashboardCanvas(sheet);

  createTitleBlock(sheet);

  createKpiCard(sheet, "A4:B6", "SYSTEM STATUS", "🟢 Ready", DASHBOARD_STYLE.COLORS.GREEN);
  createKpiCard(sheet, "C4:D6", "VERSION", PROJECT_VERSION, DASHBOARD_STYLE.COLORS.LIGHT_BLUE);
  createKpiCard(sheet, "E4:F6", "IDEAS TODAY", '=COUNTIF(Ideas!B:B,">="&TODAY())', DASHBOARD_STYLE.COLORS.YELLOW);
  createKpiCard(sheet, "G4:H6", "TOTAL COST", '=IFERROR("£"&TEXT(SUM(Costs!G:G),"0.0000"),"£0.0000")', DASHBOARD_STYLE.COLORS.RED);

  createSectionHeader(sheet, "A8:D8", "TODAY'S PROGRESS");

  createTable(sheet, "A10", [
    ["Metric", "Current", "Target", "Status"],
    ["Ideas Generated", '=COUNTIF(Ideas!B:B,">="&TODAY())', 3, "Sprint 1"],
    ["Scripts Created", '=COUNTIF(Scripts!C:C,">="&TODAY())', 0, "Coming Sprint 4"],
    ["SEO Packs Created", '=COUNTIF(\'SEO Pack\'!C:C,">="&TODAY())', 0, "Coming Sprint 4"],
    ["Videos Published", 0, 0, "Coming later"]
  ]);

  createSectionHeader(sheet, "F8:H8", "QUICK ACTIONS");

  createActionButton(sheet, "F10:H11", "Generate 3 Ideas", "Project Savannah menu → Generate 3 Video Ideas");
  createActionButton(sheet, "F12:H13", "Generate Script", "Coming in Sprint 3");
  createActionButton(sheet, "F14:H15", "Generate SEO Pack", "Coming in Sprint 4");
  createActionButton(sheet, "F16:H17", "Review Approval Queue", "Coming in Sprint 5");

  createSectionHeader(sheet, "A17:D17", "CONTENT PIPELINE");

  createTable(sheet, "A19", [
    ["Stage", "Status", "Total Items", "Next Step"],
    ["Ideas", "🟢 Active", '=COUNTA(Ideas!A2:A)', "Connect OpenAI"],
    ["Scripts", "⚪ Pending", '=COUNTA(Scripts!A2:A)', "Sprint 3"],
    ["SEO Pack", "⚪ Pending", '=COUNTA(\'SEO Pack\'!A2:A)', "Sprint 4"],
    ["Approval Queue", "⚪ Pending", '=COUNTA(\'Approval Queue\'!A2:A)', "Sprint 5"]
  ]);

  createSectionHeader(sheet, "F19:H19", "API STATUS");

    const openAiConnected = Secrets.hasOpenAIApiKey();

    createTable(sheet, "F21", [
      ["Service", "Status", "Notes"],
      [
        "OpenAI",
        openAiConnected ? "🟢 Connected" : "🔴 Not Connected",
        openAiConnected ? "API key stored" : "Configure API key"
      ],
      ["Google Sheets", "🟢 Connected", "Working"],
      ["Google Drive", "🟢 Connected", "Working"],
      ["YouTube", "⚪ Not Connected", "Later version"]
    ]);

  createSectionHeader(sheet, "A26:C26", "COST OVERVIEW");

  createTable(sheet, "A28", [
    ["Metric", "Value"],
    ["Estimated Total Cost", '=IFERROR("£"&TEXT(SUM(Costs!G:G),"0.0000"),"£0.0000")'],
    ["Runs Logged", '=COUNTA(Logs!A2:A)'],
    ["Cost Records", '=COUNTA(Costs!A2:A)']
  ]);

  createSectionHeader(sheet, "E26:H26", "RECENT ACTIVITY");

  sheet.getRange("E28:H31").merge();
  sheet.getRange("E28")
    .setValue("Recent logs will appear here once the logging system is active.")
    .setFontStyle("italic")
    .setFontColor(DASHBOARD_STYLE.COLORS.TEXT_GREY)
    .setBackground("#F7F9FC")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(true)
    .setBorder(true, true, true, true, true, true);

  finalDashboardPolish(sheet);
}

function prepareDashboardCanvas(sheet) {
  sheet.clear();
  sheet.setHiddenGridlines(true);

  sheet.setColumnWidths(1, 8, 155);
  sheet.setRowHeights(1, 40, 28);

  sheet.setRowHeight(1, 55);
  sheet.setRowHeight(2, 30);
  sheet.setFrozenRows(2);
}

function finalDashboardPolish(sheet) {
  sheet.getRange("A1:H40")
    .setFontFamily(DASHBOARD_STYLE.FONT.FAMILY)
    .setFontSize(DASHBOARD_STYLE.FONT.BODY_SIZE)
    .setVerticalAlignment("middle");

  sheet.getRange("A1:H2").setFontSize(DASHBOARD_STYLE.FONT.TITLE_SIZE);
  sheet.getRange("A1:H40").setWrap(true);

  sheet.setColumnWidth(1, 210);
  sheet.setColumnWidth(2, 90);
  sheet.setColumnWidth(3, 80);
  sheet.setColumnWidth(4, 150);
  sheet.setColumnWidth(5, 35);
  sheet.setColumnWidth(6, 190);
  sheet.setColumnWidth(7, 150);
  sheet.setColumnWidth(8, 190);

  sheet.setRowHeights(10, 5, 28);
  sheet.setRowHeights(19, 5, 28);
  sheet.setRowHeights(21, 5, 28);
  sheet.setRowHeights(28, 4, 28);
}