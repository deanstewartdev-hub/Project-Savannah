/****************************************************
 * Project Savannah v1.3 - OpenAI narration audio.
 ****************************************************/
const VoiceoverService = (() => {
  const SPEECH_URL = "https://api.openai.com/v1/audio/speech";
  const FOLDER_NAME = "Project Savannah Render Audio";
  const MODEL = "tts-1";
  const VOICE = "alloy";

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
    const folder = folder_();
    const name = safeName_(scriptId) + "-scene-" + sceneNumber + ".mp3";
    const existing = folder.getFilesByName(name);
    if (existing.hasNext()) return fileResult_(existing.next(), sceneNumber);

    const audio = createSpeech_(narration);
    const file = folder.createFile(audio.setName(name));
    file.setDescription("Project Savannah narration for " + scriptId + ", scene " + sceneNumber + ".");
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return fileResult_(file, sceneNumber);
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

  function folder_() {
    const folders = DriveApp.getFoldersByName(FOLDER_NAME);
    return folders.hasNext() ? folders.next() : DriveApp.createFolder(FOLDER_NAME);
  }

  function fileResult_(file, sceneNumber) {
    return {
      sceneNumber: sceneNumber,
      fileId: file.getId(),
      url: "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(file.getId())
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
