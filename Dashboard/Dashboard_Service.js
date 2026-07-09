/****************************************************
 * Project Savannah v1.0
 * DashboardService.js
 * Purpose: Refresh live dashboard values
 ****************************************************/

const DashboardService = {
  refreshDashboard: function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const dashboard = ss.getSheetByName(SHEETS.DASHBOARD);
    const ideas = ss.getSheetByName(SHEETS.IDEAS);
    const scripts = ss.getSheetByName(SHEETS.SCRIPTS);
    const costs = ss.getSheetByName(SHEETS.COSTS);
    const logs = ss.getSheetByName(SHEETS.LOGS);

    if (!dashboard) {
      throw new Error("Dashboard sheet not found.");
    }

    const totalIdeas = ideas ? Math.max(ideas.getLastRow() - 1, 0) : 0;
    const totalScripts = scripts ? Math.max(scripts.getLastRow() - 1, 0) : 0;
    const totalCost = this.getTotalCost(costs);
    const todayIdeas = this.getIdeasGeneratedToday(ideas);
    const recentActivity = this.getRecentActivity(logs);

    // Top KPI cards
    dashboard.getRange("A5:B6").setValue("🟢 Ready");
    dashboard.getRange("C5:D6").setValue(PROJECT_VERSION);
    dashboard.getRange("E5:F6").setValue(todayIdeas);
    dashboard.getRange("G5:H6").setValue("£" + totalCost.toFixed(4));

    // Today's progress table
    dashboard.getRange("B11").setValue(totalIdeas);
    dashboard.getRange("B12").setValue(totalScripts);
    dashboard.getRange("B13").setValue(0);
    dashboard.getRange("B14").setValue(0);

    // Content pipeline
    dashboard.getRange("C20").setValue(totalIdeas);
    dashboard.getRange("C21").setValue(totalScripts);

    // API status
  // API status
    const openAiConnected = Secrets.hasOpenAIApiKey();

    dashboard.getRange("G22").setValue(
      openAiConnected ? "🟢 Connected" : "🔴 Not Connected"
    );

    dashboard.getRange("H22").setValue(
      openAiConnected ? "API key stored" : "Configure API key"
    );

    // Cost overview
    dashboard.getRange("B29").setValue("£" + totalCost.toFixed(4));
    dashboard.getRange("B30").setValue(logs ? Math.max(logs.getLastRow() - 1, 0) : 0);
    dashboard.getRange("B31").setValue(costs ? Math.max(costs.getLastRow() - 1, 0) : 0);

    // Recent activity
    dashboard.getRange("E28:H31").setValue(recentActivity);
  },

  getTotalCost: function (costsSheet) {
    if (!costsSheet || costsSheet.getLastRow() <= 1) {
      return 0;
    }

    const values = costsSheet
      .getRange(2, 7, costsSheet.getLastRow() - 1, 1)
      .getValues();

    return values.reduce(function (total, row) {
      return total + (Number(row[0]) || 0);
    }, 0);
  },

  getIdeasGeneratedToday: function (ideasSheet) {
    if (!ideasSheet || ideasSheet.getLastRow() <= 1) {
      return 0;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dates = ideasSheet
      .getRange(2, 2, ideasSheet.getLastRow() - 1, 1)
      .getValues();

    return dates.filter(function (row) {
      const date = row[0];

      if (!(date instanceof Date)) {
        return false;
      }

      const ideaDate = new Date(date);
      ideaDate.setHours(0, 0, 0, 0);

      return ideaDate.getTime() === today.getTime();
    }).length;
  },

  getRecentActivity: function (logsSheet) {
    if (!logsSheet || logsSheet.getLastRow() <= 1) {
      return "No recent activity yet.";
    }

    const lastRow = logsSheet.getLastRow();
    const row = logsSheet.getRange(lastRow, 1, 1, 7).getValues()[0];

    const timestamp = row[1];
    const action = row[3];
    const status = row[4];
    const message = row[5];

    return status + " - " + action + "\n" + message + "\n" + timestamp;
  }
};