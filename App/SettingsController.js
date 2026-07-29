/****************************************************
 * Project Savannah v1.3 - secure integration settings.
 ****************************************************/
const SettingsController = (() => {
  function getIntegrations() {
    return { success: true, data: {
      openAIConnected: Secrets.hasOpenAIApiKey(),
      creatomateConnected: Secrets.hasCreatomateApiKey() && !!Secrets.getCreatomateTemplateId(),
      creatomateTemplateId: Secrets.getCreatomateTemplateId() || ""
    }};
  }
  function saveCreatomate(request) {
    try {
      const source = request || {};
      Secrets.setCreatomateApiKey(source.apiKey);
      Secrets.setCreatomateTemplateId(source.templateId);
      return { success: true, message: "Creatomate connected securely.", data: getIntegrations().data };
    } catch (error) {
      return { success: false, message: "Creatomate could not be connected.", error: {
        code: "CREATOMATE_SETTINGS_INVALID", message: String(error.message || error).slice(0, 300)
      }};
    }
  }
  return { getIntegrations: getIntegrations, saveCreatomate: saveCreatomate };
})();
function settingsGetIntegrations() { return SettingsController.getIntegrations(); }
function settingsSaveCreatomate(request) { return SettingsController.saveCreatomate(request); }
function testSettingsRejectsMissingCreatomateKey() {
  const result = SettingsController.saveCreatomate({ templateId: "9157fd7e-ef01-4c63-bcf4-388e7282d779" });
  if (result.success) throw new Error("Settings accepted a missing Creatomate API key.");
  return { passed: true };
}
