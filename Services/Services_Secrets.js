/****************************************************
 * Project Savannah v1.0
 * Secrets.gs
 * Purpose: Secure storage for API keys and secrets
 ****************************************************/

const Secrets = {

  setOpenAIApiKey(apiKey) {
    if (!apiKey || apiKey.trim() === "") {
      throw new Error("API key cannot be empty.");
    }

    PropertiesService
      .getScriptProperties()
      .setProperty("OPENAI_API_KEY", apiKey.trim());
  },

  getOpenAIApiKey() {
    return PropertiesService
      .getScriptProperties()
      .getProperty("OPENAI_API_KEY");
  },

  hasOpenAIApiKey() {
    return !!this.getOpenAIApiKey();
  },

  deleteOpenAIApiKey() {
    PropertiesService
      .getScriptProperties()
      .deleteProperty("OPENAI_API_KEY");
  },

  setCreatomateApiKey(apiKey) {
    const value = String(apiKey || "").trim();
    if (!value) throw new Error("Creatomate API key cannot be empty.");
    PropertiesService.getScriptProperties().setProperty("CREATOMATE_API_KEY", value);
  },

  getCreatomateApiKey() {
    return PropertiesService.getScriptProperties().getProperty("CREATOMATE_API_KEY");
  },

  hasCreatomateApiKey() {
    return !!this.getCreatomateApiKey();
  },

  setCreatomateTemplateId(templateId) {
    const value = String(templateId || "").trim();
    if (!/^[a-f0-9-]{36}$/i.test(value)) throw new Error("A valid Creatomate template ID is required.");
    PropertiesService.getScriptProperties().setProperty("CREATOMATE_TEMPLATE_ID", value);
  },

  getCreatomateTemplateId() {
    return PropertiesService.getScriptProperties().getProperty("CREATOMATE_TEMPLATE_ID");
  }

};
