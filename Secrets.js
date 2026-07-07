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
  }

};