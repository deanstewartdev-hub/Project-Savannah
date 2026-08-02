/****************************************************
 * Project Savannah v1.3 - scene-specific render visuals.
 ****************************************************/
const VisualAssetService = (() => {
  const IMAGE_URL = "https://api.openai.com/v1/images/generations";
  const FOLDER_NAME = "Project Savannah Render Visuals";
  const MODEL = "gpt-image-2";

  function prepareSceneVisuals(script, plan) {
    requireDriveScope_();
    if (!script || !script.id) throw error_("A valid script is required.");
    const renderPlan = plan || ScenePlanService.create(script);
    const slots = renderPlan.slots || [];
    if (slots.length !== 4) throw error_("The render plan must contain exactly four visual slots.");
    return slots.map(function (slot, index) {
      const prompt = buildPrompt_(script, slot, index + 1);
      return getOrCreateImage_(script.id, index + 1, prompt);
    });
  }

  function prepareSceneVisual(script, plan, sceneNumber) {
    requireDriveScope_();
    if (!script || !script.id) throw error_("A valid script is required.");
    const renderPlan = plan || ScenePlanService.create(script);
    const number = Number(sceneNumber || 0);
    const slot = renderPlan.slots && renderPlan.slots[number - 1];
    if (!slot || number < 1 || number > 4) throw error_("A scene number from 1 to 4 is required.");
    const prompt = buildPrompt_(script, slot, number);
    return getOrCreateImage_(script.id, number, prompt);
  }

  function buildPrompt_(script, slot, sceneNumber) {
    return [
      "Create scene " + sceneNumber + " of a vertical YouTube Short.",
      "Topic: " + String(script.title || "travel discovery") + ".",
      "Visual direction: " + String(slot.visualDirection || slot.narration || "Show a relevant establishing shot") + ".",
      "Style: cinematic, photorealistic travel documentary, authentic location and people, vivid natural lighting, strong depth, 9:16 composition.",
      "The image must directly illustrate this scene, not generic food or unrelated stock imagery.",
      "No captions, letters, logos, watermarks, borders, or split screens. Keep the central lower area visually calm for subtitles."
    ].join(" ");
  }

  function getOrCreateImage_(scriptId, sceneNumber, prompt) {
    const imageQuality = Secrets.getProductionBranding().imageQuality;
    const imageSignature = [MODEL, imageQuality, prompt].join("|");
    const name = safeName_(scriptId) + "-scene-" + sceneNumber + "-" + digest_(imageSignature) + ".png";
    const folder = folder_();
    const existing = folder.getFilesByName(name);
    if (existing.hasNext()) return fileResult_(existing.next().getId(), sceneNumber, prompt);
    const blob = createImage_(prompt, imageQuality).setName(name);
    const file = folder.createFile(blob);
    file.setDescription("Project Savannah visual for " + scriptId + ", scene " + sceneNumber + ".");
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return fileResult_(file.getId(), sceneNumber, prompt, imageQuality);
  }

  function createImage_(prompt, imageQuality) {
    const apiKey = Secrets.getOpenAIApiKey();
    if (!apiKey) throw error_("OpenAI is not connected.");
    const response = UrlFetchApp.fetch(IMAGE_URL, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + apiKey },
      payload: JSON.stringify({ model: MODEL, prompt: prompt, size: "1024x1536", quality: imageQuality, n: 1 }),
      muteHttpExceptions: true
    });
    const status = response.getResponseCode();
    const body = response.getContentText();
    if (status < 200 || status >= 300) {
      throw error_("OpenAI image generation failed: " + String(body || "HTTP " + status).replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]").slice(0, 300));
    }
    const parsed = JSON.parse(body || "{}");
    const image = parsed.data && parsed.data[0] || {};
    if (image.b64_json) return Utilities.newBlob(Utilities.base64Decode(image.b64_json), "image/png");
    if (image.url) return UrlFetchApp.fetch(image.url).getBlob().setContentType("image/png");
    throw error_("OpenAI returned no image data.");
  }

  function folder_() {
    const folders = DriveApp.getFoldersByName(FOLDER_NAME);
    return folders.hasNext() ? folders.next() : DriveApp.createFolder(FOLDER_NAME);
  }
  function requireDriveScope_() { ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, ["https://www.googleapis.com/auth/drive"]); }
  function fileResult_(fileId, sceneNumber, prompt, imageQuality) {
    return { sceneNumber: sceneNumber, fileId: fileId, url: "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(fileId), prompt: prompt, model: MODEL, quality: imageQuality || Secrets.getProductionBranding().imageQuality };
  }
  function digest_(value) {
    return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value || ""), Utilities.Charset.UTF_8).slice(0, 6).map(function (byte) {
      const normalised = byte < 0 ? byte + 256 : byte;
      return ("0" + normalised.toString(16)).slice(-2);
    }).join("");
  }
  function safeName_(value) { return String(value || "script").replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 80); }
  function error_(message) { const error = new Error(message); error.name = "VisualAssetServiceError"; return error; }
  return { prepareSceneVisuals: prepareSceneVisuals, prepareSceneVisual: prepareSceneVisual };
})();
