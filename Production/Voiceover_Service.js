/****************************************************
 * Project Savannah v1.3 - OpenAI narration audio.
 ****************************************************/
const VoiceoverService = (() => {
  const SPEECH_URL = "https://api.openai.com/v1/audio/speech";
  const FOLDER_NAME = "Project Savannah Render Audio";
  const MODEL = "tts-1";
  const VOICE = "alloy";
  const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
  const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
  const FOLDER_PROPERTY = "SAVANNAH_RENDER_AUDIO_FOLDER_ID";

  function prepareSceneAudio(script) {
    if (!script || !script.id) throw error_("A valid script is required.");
    const scenes = Array.isArray(script.scenes) ? script.scenes.slice(0, 4) : [];
    if (!scenes.length) throw error_("The script has no scenes to narrate.");

    return scenes.map(function (scene, index) {
      const narration = String(scene && scene.narration || "").trim();
      if (!narration) throw error_("Scene " + (index + 1) + " has no narration.");
      return getOrCreateAudio_(script.id, index + 1, narration);
    });
  }

  function getOrCreateAudio_(scriptId, sceneNumber, narration) {
    const name = safeName_(scriptId) + "-scene-" + sceneNumber + ".mp3";
    const audio = createSpeech_(narration);
    const fileId = uploadAudio_(audio, {
      name: name,
      description: "Project Savannah narration for " + scriptId + ", scene " + sceneNumber + ".",
      parents: [folderId_()]
    });
    shareByLink_(fileId);
    return fileResult_(fileId, sceneNumber);
  }

  function createSpeech_(text) {
    const apiKey = Secrets.getOpenAIApiKey();
    if (!apiKey) throw error_("OpenAI is not connected.");
    const response = UrlFetchApp.fetch(SPEECH_URL, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + apiKey },
      payload: JSON.stringify({
        model: MODEL,
        voice: VOICE,
        input: text,
        response_format: "mp3"
      }),
      muteHttpExceptions: true
    });
    const status = response.getResponseCode();
    if (status < 200 || status >= 300) {
      const detail = String(response.getContentText() || "HTTP " + status)
        .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]").slice(0, 300);
      throw error_("OpenAI speech generation failed: " + detail);
    }
    return response.getBlob().setContentType("audio/mpeg");
  }

  function folderId_() {
    const properties = PropertiesService.getScriptProperties();
    const stored = properties.getProperty(FOLDER_PROPERTY);
    if (stored) return stored;
    const folder = driveJsonRequest_("post", DRIVE_API, {
      name: FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder"
    });
    if (!folder.id) throw error_("Google Drive did not return an audio folder ID.");
    properties.setProperty(FOLDER_PROPERTY, folder.id);
    return folder.id;
  }

  function uploadAudio_(audio, metadata) {
    const boundary = "savannah_" + Utilities.getUuid().replace(/-/g, "");
    const prefix = "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify(metadata) + "\r\n--" + boundary + "\r\nContent-Type: audio/mpeg\r\n\r\n";
    const suffix = "\r\n--" + boundary + "--";
    const bytes = Utilities.newBlob(prefix).getBytes();
    appendBytes_(bytes, audio.getBytes());
    appendBytes_(bytes, Utilities.newBlob(suffix).getBytes());
    const response = UrlFetchApp.fetch(DRIVE_UPLOAD_API, {
      method: "post",
      contentType: "multipart/related; boundary=" + boundary,
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
      payload: Utilities.newBlob(bytes).getBytes(),
      muteHttpExceptions: true
    });
    const body = parseDriveResponse_(response, "Audio upload");
    if (!body.id) throw error_("Google Drive did not return an audio file ID.");
    return body.id;
  }

  function shareByLink_(fileId) {
    driveJsonRequest_("post", DRIVE_API + "/" + encodeURIComponent(fileId) + "/permissions", {
      type: "anyone",
      role: "reader"
    });
  }

  function driveJsonRequest_(method, url, payload) {
    const response = UrlFetchApp.fetch(url, {
      method: method,
      contentType: "application/json",
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
      payload: JSON.stringify(payload || {}),
      muteHttpExceptions: true
    });
    return parseDriveResponse_(response, "Google Drive request");
  }

  function parseDriveResponse_(response, label) {
    const status = response.getResponseCode();
    const text = response.getContentText();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch (parseError) { body = {}; }
    if (status < 200 || status >= 300) {
      const detail = String(body.error && body.error.message || "HTTP " + status).slice(0, 300);
      throw error_(label + " failed: " + detail);
    }
    return body;
  }

  function appendBytes_(target, source) {
    for (let index = 0; index < source.length; index++) target.push(source[index]);
  }

  function fileResult_(fileId, sceneNumber) {
    return {
      sceneNumber: sceneNumber,
      fileId: fileId,
      url: "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(fileId)
    };
  }

  function safeName_(value) {
    return String(value || "script").replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 80);
  }
  function error_(message) {
    const error = new Error(message);
    error.name = "VoiceoverServiceError";
    return error;
  }

  return { prepareSceneAudio: prepareSceneAudio };
})();
