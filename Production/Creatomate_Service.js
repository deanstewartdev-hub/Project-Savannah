/****************************************************
 * Project Savannah v1.3 - Creatomate API boundary.
 ****************************************************/
const CreatomateService = (() => {
  const API_BASE = "https://api.creatomate.com";

  function testConnection() {
    const templateId = templateId_();
    const response = request_("get", "/v1/templates/" + encodeURIComponent(templateId));
    return {
      connected: true,
      templateId: templateId,
      templateName: String(response.name || response.template_name || "")
    };
  }

  function createRender(script, seoPack) {
    const audioFiles = VoiceoverService.prepareSceneAudio(script);
    const payload = buildPayload_(script, seoPack, audioFiles);
    const response = request_("post", "/v2/renders", payload);
    const render = Array.isArray(response) ? response[0] : response;
    if (!render || !render.id) throw error_("Creatomate did not return a render ID.");
    return { render: render, payload: payload };
  }

  function getRender(renderId) {
    const id = String(renderId || "").trim();
    if (!id) throw error_("A render ID is required.");
    return request_("get", "/v2/renders/" + encodeURIComponent(id));
  }

  function buildPayload_(script, seoPack, audioFiles) {
    if (!script || !script.id) throw error_("A valid script is required.");
    const modifications = {};
    const scenes = Array.isArray(script.scenes) ? script.scenes.slice(0, 4) : [];
    const audioByScene = {};
    (Array.isArray(audioFiles) ? audioFiles : []).forEach(function (file) {
      audioByScene[Number(file.sceneNumber)] = String(file.url || "").trim();
    });
    for (let index = 0; index < 4; index++) {
      const scene = scenes[index] || {};
      const narration = String(scene.narration || "").trim();
      const onScreenText = String(scene.onScreenText || narration || "").trim();
      const audioUrl = audioByScene[index + 1];
      if (audioUrl) modifications["Voiceover-" + (index + 1) + ".source"] = audioUrl;
      if (onScreenText) modifications["Subtitles-" + (index + 1) + ".text"] = onScreenText;
    }
    if (!Object.keys(modifications).some(function (key) { return /^Voiceover-/.test(key); })) {
      throw error_("Narration audio was not prepared.");
    }
    return {
      template_id: templateId_(),
      modifications: modifications,
      metadata: JSON.stringify({
        project: "Project Savannah",
        scriptId: script.id,
        seoPackId: seoPack && seoPack.id || ""
      })
    };
  }

  function request_(method, path, payload) {
    const options = {
      method: method,
      muteHttpExceptions: true,
      headers: {
        Authorization: "Bearer " + apiKey_(),
        Accept: "application/json"
      }
    };
    if (payload !== undefined) {
      options.contentType = "application/json";
      options.payload = JSON.stringify(payload);
    }
    const response = UrlFetchApp.fetch(API_BASE + path, options);
    const status = response.getResponseCode();
    const body = response.getContentText();
    let parsed = {};
    try { parsed = body ? JSON.parse(body) : {}; } catch (parseError) { parsed = {}; }
    if (status < 200 || status >= 300) {
      const detail = String(parsed.message || parsed.error || "HTTP " + status).slice(0, 300);
      throw error_("Creatomate request failed: " + detail);
    }
    return parsed;
  }

  function apiKey_() {
    const value = Secrets.getCreatomateApiKey();
    if (!value) throw error_("Creatomate is not connected.");
    return value;
  }
  function templateId_() {
    const value = Secrets.getCreatomateTemplateId();
    if (!value) throw error_("A Creatomate template is not configured.");
    return value;
  }
  function error_(message) { const error = new Error(message); error.name = "CreatomateServiceError"; return error; }

  return { testConnection: testConnection, createRender: createRender, getRender: getRender, buildPayload: buildPayload_ };
})();

function testCreatomatePayload() {
  const payload = CreatomateService.buildPayload({
    id: "SCR-TEST",
    voiceoverScript: "Fallback narration",
    scenes: [{ narration: "Opening narration", onScreenText: "Opening text" }]
  }, { id: "SEO-TEST" }, [{ sceneNumber: 1, url: "https://example.com/voiceover.mp3" }]);
  if (!payload.modifications["Voiceover-1.source"]) throw new Error("Voiceover modification was not created.");
  return { passed: true, modificationCount: Object.keys(payload.modifications).length };
}
