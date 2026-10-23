/****************************************************
 * Project Savannah v1.3 - secure integration settings.
 ****************************************************/
const SettingsController = (() => {
  function getIntegrations() {
    return { success: true, data: {
      openAIConnected: Secrets.hasOpenAIApiKey(),
      creatomateConnected: Secrets.hasCreatomateApiKey() && !!Secrets.getCreatomateTemplateId(),
      creatomateTemplateId: Secrets.getCreatomateTemplateId() || "",
      productionBranding: Secrets.getProductionBranding()
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
  function saveProductionBranding(request) {
    try {
      Secrets.setProductionBranding(request || {});
      return {
        success: true,
        message: "Production branding saved.",
        data: Secrets.getProductionBranding()
      };
    } catch (error) {
      return {
        success: false,
        message: "Production branding could not be saved.",
        error: {
          code: "PRODUCTION_BRANDING_INVALID",
          message: String(error.message || error).slice(0, 300)
        }
      };
    }
  }
  return { getIntegrations: getIntegrations, saveCreatomate: saveCreatomate,
    saveProductionBranding: saveProductionBranding };
})();
function settingsGetIntegrations() { return SettingsController.getIntegrations(); }
function settingsSaveCreatomate(request) { return SettingsController.saveCreatomate(request); }
function settingsSaveProductionBranding(request) { return SettingsController.saveProductionBranding(request); }
// Read-only. Run from the deployed app so the callback check compares against the
// real /exec URL (from the editor it can only warn). Never returns secret values.
function settingsGetReleaseReadiness() {
  try {
    return { success: true, data: ReleaseReadinessService.run() };
  } catch (error) {
    return { success: false, error: { code: "RELEASE_READINESS_FAILED", message: String(error && error.message || error).slice(0, 300) } };
  }
}
function testSettingsRejectsMissingCreatomateKey() {
  const result = SettingsController.saveCreatomate({ templateId: "9157fd7e-ef01-4c63-bcf4-388e7282d779" });
  if (result.success) throw new Error("Settings accepted a missing Creatomate API key.");
  return { passed: true };
}
