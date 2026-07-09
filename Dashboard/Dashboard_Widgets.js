/****************************************************
 * Project Savannah v1.0
 * DashboardWidgets.gs
 ****************************************************/

function createTitleBlock(sheet) {
  sheet.getRange("A1:H2").merge();
  sheet.getRange("A1")
    .setValue("PROJECT SAVANNAH\nAI YouTube Shorts Automation Platform")
    .setBackground(DASHBOARD_STYLE.COLORS.NAVY)
    .setFontColor(DASHBOARD_STYLE.COLORS.WHITE)
    .setFontSize(DASHBOARD_STYLE.FONT.TITLE_SIZE)
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(true);
}

function createKpiCard(sheet, rangeA1, title, value, backgroundColor) {
  const range = sheet.getRange(rangeA1);
  range.breakApart();

  const row = range.getRow();
  const col = range.getColumn();
  const cols = range.getNumColumns();

  const titleRange = sheet.getRange(row, col, 1, cols);
  const valueRange = sheet.getRange(row + 1, col, 2, cols);

  titleRange.merge();
  valueRange.merge();

  titleRange
    .setValue(title)
    .setBackground(backgroundColor)
    .setFontWeight("bold")
    .setFontSize(DASHBOARD_STYLE.FONT.CARD_TITLE_SIZE)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setBorder(true, true, false, true, false, false);

  valueRange
    .setBackground(backgroundColor)
    .setFontWeight("bold")
    .setFontSize(DASHBOARD_STYLE.FONT.CARD_VALUE_SIZE)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(true)
    .setBorder(false, true, true, true, false, false);

  if (typeof value === "string" && value.startsWith("=")) {
    valueRange.setFormula(value);
  } else {
    valueRange.setValue(value);
  }
}

function createSectionHeader(sheet, rangeA1, title) {
  const range = sheet.getRange(rangeA1);
  range.breakApart();
  range.merge();

  range
    .setValue(title)
    .setBackground(DASHBOARD_STYLE.COLORS.BLUE)
    .setFontColor(DASHBOARD_STYLE.COLORS.WHITE)
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
}

function createActionButton(sheet, rangeA1, title, subtitle) {
  const range = sheet.getRange(rangeA1);
  range.breakApart();
  range.merge();

  range
    .setValue(title + "\n" + subtitle)
    .setBackground(DASHBOARD_STYLE.COLORS.LIGHT_GREY)
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(true)
    .setBorder(true, true, true, true, true, true);
}

function createTable(sheet, startCellA1, values) {
  const start = sheet.getRange(startCellA1);
  const row = start.getRow();
  const col = start.getColumn();

  const numRows = values.length;
  const numCols = values[0].length;

  const range = sheet.getRange(row, col, numRows, numCols);
  range.setValues(values);
  range.setBorder(true, true, true, true, true, true);
  range.setVerticalAlignment("middle");

  const header = sheet.getRange(row, col, 1, numCols);
  header
    .setBackground(DASHBOARD_STYLE.COLORS.BLUE)
    .setFontColor(DASHBOARD_STYLE.COLORS.WHITE)
    .setFontWeight("bold");

  return range;
}