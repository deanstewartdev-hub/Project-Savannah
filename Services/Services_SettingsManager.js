/****************************************************
 * Project Savannah v1.0
 * SettingsManager.gs
 * Purpose: Central access point for Settings sheet values
 ****************************************************/

const Settings = {
  getValue: function(settingName) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEETS.SETTINGS);

    if (!sheet) {
      throw new Error("Settings sheet not found.");
    }

    const values = sheet.getDataRange().getValues();

    for (let i = 1; i < values.length; i++) {
      if (values[i][0] === settingName) {
        return values[i][1];
      }
    }

    return "";
  },

  getApiKey: function() {
    return this.getValue("OPENAI_API_KEY");
  },

  getProvider: function() {
    return this.getValue("AI_PROVIDER") || "OpenAI";
  },

  getModel: function() {
    return this.getValue("OPENAI_MODEL") || DEFAULT_MODEL;
  },

  getTemperature: function() {
    return Number(this.getValue("AI_TEMPERATURE")) || 0.8;
  },

  getMaxTokens: function() {
    return Number(this.getValue("AI_MAX_TOKENS")) || 1200;
  },

  getIdeasPerRun: function() {
    return Number(this.getValue("IDEAS_PER_RUN")) || DEFAULTS.IDEAS_PER_RUN;
  },

  getNiche: function() {
    return this.getValue("NICHE") || "Travel facts";
  },

  getTargetAudience: function() {
    return this.getValue("TARGET_AUDIENCE") || "People who enjoy short educational videos";
  }
};