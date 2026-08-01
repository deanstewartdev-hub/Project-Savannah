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
    const plan = ScenePlanService.create(script);
    const continuousAudio = VoiceoverService.prepareContinuousAudio(script);
    const visualFiles = VisualAssetService.prepareSceneVisuals(script, plan);
    const payload = buildPayload_(script, seoPack, continuousAudio, plan, visualFiles);
    const response = request_("post", "/v2/renders", {
      template_id: payload.template_id,
      modifications: payload.modifications,
      metadata: payload.metadata
    });
    const render = Array.isArray(response) ? response[0] : response;
    if (!render || !render.id) throw error_("Creatomate did not return a render ID.");
    return { render: render, payload: payload };
  }

  function getRender(renderId) {
    const id = String(renderId || "").trim();
    if (!id) throw error_("A render ID is required.");
    return request_("get", "/v2/renders/" + encodeURIComponent(id));
  }

  function buildPayload_(script, seoPack, continuousAudio, suppliedPlan, visualFiles) {
    if (!script || !script.id) throw error_("A valid script is required.");
    const plan = suppliedPlan || ScenePlanService.create(script);
    const modifications = {};
    const branding = Secrets.getProductionBranding();
    const scenes = plan.slots || [];
    const visualByScene = {};
    const continuousAudioUrl = String(continuousAudio && continuousAudio.url || "").trim();
    if (!continuousAudioUrl) throw error_("Continuous narration audio was not prepared.");
    modifications["Voiceover-1.source"] = continuousAudioUrl;
    modifications["Voiceover-1.time"] = 0;
    modifications["Voiceover-1.duration"] = "media";
    for (let voiceNumber = 2; voiceNumber <= 4; voiceNumber++) {
      modifications["Voiceover-" + voiceNumber + ".volume"] = 0;
    }
    (Array.isArray(visualFiles) ? visualFiles : []).forEach(function (file) {
      visualByScene[Number(file.sceneNumber)] = String(file.url || "").trim();
    });
    let currentTime = 0;
    for (let index = 0; index < 4; index++) {
      const scene = scenes[index] || {};
      const narration = String(scene.narration || "").trim();
      const onScreenText = String(scene.onScreenText || narration || "").trim();
      const number = index + 1;
      const visualUrl = visualByScene[number];
      if (!visualUrl) throw error_("Scene " + number + " has no topic-matched visual asset.");
      modifications["Image-" + number + ".source"] = visualUrl;
      if (onScreenText) modifications["Subtitles-" + number + ".text"] = onScreenText;
      modifications["Subtitles-" + number + ".fill_color"] = branding.primaryColor;
      modifications["Subtitles-" + number + ".time"] = currentTime;
      modifications["Subtitles-" + number + ".duration"] = Number(scene.expectedDurationSeconds || 0);
      currentTime += Number(scene.expectedDurationSeconds || 0);
    }
    modifications.duration = plan.expectedDurationSeconds;
    if (!Object.keys(modifications).some(function (key) { return /^Voiceover-/.test(key); })) {
      throw error_("Narration audio was not prepared.");
    }
    return {
      template_id: templateId_(),
      modifications: modifications,
      expectedDurationSeconds: plan.expectedDurationSeconds,
      scenePlan: plan,
      metadata: JSON.stringify({
        project: "Project Savannah",
        scriptId: script.id,
        seoPackId: seoPack && seoPack.id || "",
        expectedDurationSeconds: plan.expectedDurationSeconds,
        sourceSceneCount: plan.sourceSceneCount,
        visualAssetCount: Object.keys(visualByScene).length,
        visualModel: "gpt-image-2",
        narrationMode: "continuous",
        brandName: branding.brandName
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
  const script = {
    id: "SCR-TEST",
    voiceoverScript: [
      "A harmless habit could create an expensive surprise overseas.",
      "Local rules often hide behind routines that visitors never notice.",
      "Watch how residents behave before copying the crowd.",
      "Quiet public spaces can carry stronger expectations than signs suggest.",
      "Small observations prevent awkward mistakes and show genuine respect.",
      "The smartest travellers pause before acting in unfamiliar places.",
      "That habit matters more than memorising a hundred rules.",
      "Follow Savannah Atlas for smarter cultural shortcuts."
    ].join(" "),
    scenes: [
      { sceneNumber: 1, onScreenText: "Watch local habits", visualDirection: "Show a station." },
      { sceneNumber: 2, onScreenText: "Notice the silence", visualDirection: "Show a train." },
      { sceneNumber: 3, onScreenText: "Pause before acting", visualDirection: "Show a traveller." },
      { sceneNumber: 4, onScreenText: "Travel with respect", visualDirection: "Show a city." }
    ]
  };
  const plan = ScenePlanService.create(script);
  const payload = CreatomateService.buildPayload(script, { id: "SEO-TEST" },
    { url: "https://example.com/voiceover-continuous.mp3" }, plan, plan.slots.map(function (slot) {
      return { sceneNumber: slot.slotNumber, url: "https://example.com/visual-" + slot.slotNumber + ".png" };
    }));
  if (!payload.modifications["Voiceover-1.source"]) throw new Error("Voiceover modification was not created.");
  if (!payload.modifications["Image-1.source"]) throw new Error("Visual modification was not created.");
  if (payload.scenePlan.slotCount !== 4) throw new Error("Four-slot render plan was not created.");
  return { passed: true, modificationCount: Object.keys(payload.modifications).length };
}
