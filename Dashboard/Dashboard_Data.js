/****************************************************
 * Project Savannah v1.0
 * DashboardData.gs
 * Purpose: Dashboard metrics and live formulas
 ****************************************************/

function getDashboardData() {
  return {
    systemStatus: Secrets.hasOpenAIApiKey()
    ? "🟢 Ready"
    : "🟡 Awaiting API Key",
    version: APP.VERSION,
    ideasTodayFormula: getIdeasTodayFormula(),
    totalCostFormula: getTotalCostFormula(),
    runsLoggedFormula: getRunsLoggedFormula(),
    costRecordsFormula: getCostRecordsFormula()
  };
}

function getIdeasTodayFormula() {
  return '=COUNTIF(Ideas!B:B,">="&TODAY())';
}

function getScriptsTodayFormula() {
  return '=COUNTIF(Scripts!C:C,">="&TODAY())';
}

function getSeoTodayFormula() {
  return '=COUNTIF(\'SEO Pack\'!C:C,">="&TODAY())';
}

function getTotalCostFormula() {
  return '=IFERROR("£"&TEXT(SUM(Costs!G:G),"0.0000"),"£0.0000")';
}

function getRunsLoggedFormula() {
  return '=COUNTA(Logs!A2:A)';
}

function getCostRecordsFormula() {
  return '=COUNTA(Costs!A2:A)';
}

function getIdeasTotalFormula() {
  return '=COUNTA(Ideas!A2:A)';
}

function getScriptsTotalFormula() {
  return '=COUNTA(Scripts!A2:A)';
}

function getSeoTotalFormula() {
  return '=COUNTA(\'SEO Pack\'!A2:A)';
}

function getApprovalQueueTotalFormula() {
  return '=COUNTA(\'Approval Queue\'!A2:A)';
}