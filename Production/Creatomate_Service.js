/****************************************************
 * Project Savannah v1.3 - Creatomate API boundary.
 ****************************************************/
const CreatomateService = (() => {
  const API_BASE = "https://api.creatomate.com";
  // Paid Creatomate projects export the template's native 1080x1920 canvas at 1x.
  // Free trials clamp renders to low resolution regardless of this parameter.
  const PREMIUM_RENDER_SCALE = 1;

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
    const estimatedPlan = ScenePlanService.create(script);
    const audioFiles = VoiceoverService.prepareSceneAudio(script, estimatedPlan);
    const plan = ScenePlanService.fitToSlotDurations(estimatedPlan, audioFiles.map(function (file) {
      return file.durationSeconds;
    }));
    const visualFiles = VisualAssetService.prepareSceneVisuals(script, plan);
    const payload = buildPayload_(script, seoPack, audioFiles, plan, visualFiles, PREMIUM_RENDER_SCALE);
    const response = request_("post", "/v2/renders", {
      template_id: payload.template_id,
      modifications: payload.modifications,
      render_scale: payload.render_scale,
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

  function buildPayload_(script, seoPack, audioFiles, suppliedPlan, visualFiles, suppliedRenderScale) {
    if (!script || !script.id) throw error_("A valid script is required.");
    const plan = suppliedPlan || ScenePlanService.create(script);
    const modifications = {};
    const branding = Secrets.getProductionBranding();
    const scenes = plan.slots || [];
    const audioByScene = {};
    const visualByScene = {};
    (Array.isArray(audioFiles) ? audioFiles : []).forEach(function (file) {
      audioByScene[Number(file.sceneNumber)] = String(file.url || "").trim();
    });
    (Array.isArray(visualFiles) ? visualFiles : []).forEach(function (file) {
      visualByScene[Number(file.sceneNumber)] = String(file.url || "").trim();
    });
    for (let index = 0; index < 4; index++) {
      const scene = scenes[index] || {};
      const narration = String(scene.narration || "").trim();
      const onScreenText = String(scene.onScreenText || narration || "").trim();
      const number = index + 1;
      const visualUrl = visualByScene[number];
      const audioUrl = audioByScene[number];
      if (!visualUrl) throw error_("Scene " + number + " has no topic-matched visual asset.");
      if (!audioUrl) throw error_("Scene " + number + " has no narration audio.");
      modifications["Image-" + number + ".source"] = visualUrl;
      modifications["Scene-" + number + ".duration"] = Number(scene.expectedDurationSeconds || 0);
      modifications["Voiceover-" + number + ".source"] = audioUrl;
      modifications["Voiceover-" + number + ".time"] = 0;
      modifications["Voiceover-" + number + ".duration"] = "media";
      modifications["Voiceover-" + number + ".volume"] = 1;
      if (onScreenText) modifications["Subtitles-" + number + ".text"] = onScreenText;
      modifications["Subtitles-" + number + ".fill_color"] = branding.primaryColor;
      modifications["Subtitles-" + number + ".time"] = 0;
      modifications["Subtitles-" + number + ".duration"] = Number(scene.expectedDurationSeconds || 0);
    }
    modifications.duration = plan.expectedDurationSeconds;
    if (!Object.keys(modifications).some(function (key) { return /^Voiceover-/.test(key); })) {
      throw error_("Narration audio was not prepared.");
    }
    return {
      template_id: templateId_(),
      render_scale: Number(suppliedRenderScale || PREMIUM_RENDER_SCALE),
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
        narrationMode: "measured-scene-audio",
        renderScale: Number(suppliedRenderScale || PREMIUM_RENDER_SCALE),
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
    const maximumAttempts = String(method).toLowerCase() === "get" ? 3 : 1;
    let lastError = null;
    for (let attempt = 1; attempt <= maximumAttempts; attempt++) {
      try {
        const response = UrlFetchApp.fetch(API_BASE + path, options);
        const status = response.getResponseCode();
        const body = response.getContentText();
        let parsed = {};
        try { parsed = body ? JSON.parse(body) : {}; } catch (parseError) { parsed = {}; }
        if (status >= 200 && status < 300) return parsed;
        const detail = String(parsed.message || parsed.error || "HTTP " + status).slice(0, 300);
        lastError = error_("Creatomate request failed (HTTP " + status + "): " + detail);
        if ([408, 429, 500, 502, 503, 504].indexOf(status) === -1 || attempt >= maximumAttempts) throw lastError;
      } catch (caught) {
        lastError = caught;
        if (attempt >= maximumAttempts) throw caught;
      }
      Utilities.sleep(Math.min(2000, 400 * Math.pow(2, attempt - 1)));
    }
    throw lastError || error_("Creatomate request failed.");
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
    plan.slots.map(function (slot) {
      return { sceneNumber: slot.slotNumber, url: "https://example.com/voiceover-" + slot.slotNumber + ".mp3" };
    }), plan, plan.slots.map(function (slot) {
      return { sceneNumber: slot.slotNumber, url: "https://example.com/visual-" + slot.slotNumber + ".png" };
    }));
  if (!payload.modifications["Voiceover-1.source"]) throw new Error("Voiceover modification was not created.");
  if (!payload.modifications["Image-1.source"]) throw new Error("Visual modification was not created.");
  if (payload.scenePlan.slotCount !== 4) throw new Error("Four-slot render plan was not created.");
  if (payload.render_scale !== 1) throw new Error("Creatomate should render the paid template at native scale.");
  return { passed: true, modificationCount: Object.keys(payload.modifications).length };
}
