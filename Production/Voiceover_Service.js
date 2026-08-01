/****************************************************
 * Project Savannah v1.3 - OpenAI narration audio.
 ****************************************************/
const VoiceoverService = (() => {
  const SPEECH_URL = "https://api.openai.com/v1/audio/speech";
  const FOLDER_NAME = "Project Savannah Render Audio";
  const MODEL = "tts-1";

  function prepareContinuousAudio(script) {
    requireDriveScope_();
    if (!script || !script.id) throw error_("A valid script is required.");
    const narration = String(script.voiceoverScript || "").trim();
    if (!narration) throw error_("The script has no complete voiceover.");
    const name = safeName_(script.id) + "-continuous-" + digest_(narration) + ".mp3";
    const folder = folder_();
    const existing = folder.getFilesByName(name);
    if (existing.hasNext()) return continuousResult_(existing.next().getId());
    const file = folder.createFile(createSpeech_(narration).setName(name));
    file.setDescription("Project Savannah continuous narration for " + script.id + ".");
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return continuousResult_(file.getId());
  }

  function prepareSceneAudio(script, plan) {
    requireDriveScope_();
    if (!script || !script.id) throw error_("A valid script is required.");
    const renderPlan = plan || ScenePlanService.create(script);
    const scenes = renderPlan.slots || [];
    if (scenes.length !== 4) throw error_("The render plan must contain exactly four narration slots.");

    return scenes.map(function (scene, index) {
      const narration = String(scene && scene.narration || "").trim();
      if (!narration) throw error_("Scene " + (index + 1) + " has no narration.");
      return getOrCreateAudio_(script.id, index + 1, narration, scene.expectedDurationSeconds);
    });
  }

  function authoriseDrive() {
    requireDriveScope_();
    const folderId = folder_().getId();
    return {
      authorised: true,
      folderId: folderId,
      scope: "drive"
    };
  }

  function getOrCreateAudio_(scriptId, sceneNumber, narration, expectedDurationSeconds) {
    const name = safeName_(scriptId) + "-scene-" + sceneNumber + "-" + digest_(narration) + ".mp3";
    const folder = folder_();
    const existing = folder.getFilesByName(name);
    if (existing.hasNext()) {
      const existingFile = existing.next();
      return fileResult_(existingFile.getId(), sceneNumber, existingFile.getBlob());
    }
    const audio = createSpeech_(narration);
    const file = folder.createFile(audio.setName(name));
    file.setDescription("Project Savannah narration for " + scriptId + ", scene " + sceneNumber + ".");
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return fileResult_(file.getId(), sceneNumber, file.getBlob());
  }

  function createSpeech_(text) {
    const apiKey = Secrets.getOpenAIApiKey();
    if (!apiKey) throw error_("OpenAI is not connected.");
    const branding = Secrets.getProductionBranding();
    const response = UrlFetchApp.fetch(SPEECH_URL, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + apiKey },
      payload: JSON.stringify({
        model: MODEL,
        voice: branding.voice,
        speed: branding.speechSpeed,
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

  function requireDriveScope_() {
    ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, [
      "https://www.googleapis.com/auth/drive"
    ]);
  }

  function fileResult_(fileId, sceneNumber, blob) {
    return {
      sceneNumber: sceneNumber,
      fileId: fileId,
      url: "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(fileId),
      durationSeconds: mp3DurationSeconds_(blob)
    };
  }

  function continuousResult_(fileId) {
    const blob = DriveApp.getFileById(fileId).getBlob();
    return {
      fileId: fileId,
      url: "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(fileId),
      durationSeconds: mp3DurationSeconds_(blob),
      continuous: true
    };
  }

  function mp3DurationSeconds_(blob) {
    const bytes = blob.getBytes().map(function (value) { return value < 0 ? value + 256 : value; });
    let offset = 0;
    if (bytes.length >= 10 && bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51) {
      offset = 10 + ((bytes[6] & 127) << 21) + ((bytes[7] & 127) << 14) +
        ((bytes[8] & 127) << 7) + (bytes[9] & 127);
    }
    const mpeg1Layer3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
    const mpeg2Layer3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    for (let index = offset; index < bytes.length - 4; index++) {
      if (bytes[index] !== 255 || (bytes[index + 1] & 224) !== 224) continue;
      const versionBits = (bytes[index + 1] >> 3) & 3;
      const layerBits = (bytes[index + 1] >> 1) & 3;
      const bitrateIndex = (bytes[index + 2] >> 4) & 15;
      if (layerBits !== 1 || bitrateIndex === 0 || bitrateIndex === 15) continue;
      const bitrate = (versionBits === 3 ? mpeg1Layer3 : mpeg2Layer3)[bitrateIndex];
      if (!bitrate) continue;
      return Math.round(((bytes.length - offset) * 8 / (bitrate * 1000)) * 100) / 100;
    }
    throw error_("The narration MP3 duration could not be measured.");
  }

  function digest_(value) {
    const bytes = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      String(value || ""),
      Utilities.Charset.UTF_8
    );
    return bytes.slice(0, 6).map(function (byte) {
      const normalised = byte < 0 ? byte + 256 : byte;
      return ("0" + normalised.toString(16)).slice(-2);
    }).join("");
  }

  function safeName_(value) {
    return String(value || "script").replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 80);
  }
  function error_(message) {
    const error = new Error(message);
    error.name = "VoiceoverServiceError";
    return error;
  }

  return { prepareSceneAudio: prepareSceneAudio, prepareContinuousAudio: prepareContinuousAudio, authoriseDrive: authoriseDrive };
})();

function authorizeProductionDrive() {
  return VoiceoverService.authoriseDrive();
}
