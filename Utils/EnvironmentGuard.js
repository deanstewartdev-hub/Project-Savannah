/****************************************************
 * Project Savannah - staging isolation guard.
 *
 * A project marked as staging (script property SAVANNAH_ENVIRONMENT = staging)
 * must never spend money or publish anything, even if a key was left behind or
 * someone opens its Production page. Every paid or irreversible outbound call
 * (OpenAI, image and voice generation, Creatomate, Cloud Run render submission,
 * YouTube upload) calls assertNotStaging_ first. Production never has the
 * property, so this is a no-op there.
 ****************************************************/
function isStagingEnvironment_() {
  return PropertiesService.getScriptProperties().getProperty("SAVANNAH_ENVIRONMENT") === "staging";
}

function assertNotStaging_(action) {
  if (isStagingEnvironment_()) {
    const error = new Error("Refused in staging: " + action + " would spend money or publish. " +
      "Staging only accepts synthetic callbacks (CALLBACK_INBOX_STAGING.md).");
    error.name = "StagingIsolationError";
    throw error;
  }
}
