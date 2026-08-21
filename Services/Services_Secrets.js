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
  },

  setProductionBranding(settings) {
    const source = settings || {};
    const brandName = String(source.brandName || "Savannah Atlas").trim();
    const primaryColor = String(source.primaryColor || "#0f766e").trim();
    const voice = String(source.voice || "alloy").trim().toLowerCase();
    const speechSpeed = Number(source.speechSpeed || 1);
    const imageQuality = String(source.imageQuality || "high").trim().toLowerCase();
    const voiceInstructions = String(source.voiceInstructions ||
      "Speak as an engaging travel storyteller: warm, confident and energetic, with natural pacing, crisp pronunciation and brief dramatic emphasis on the opening hook. Avoid an exaggerated advertising delivery.").trim();
    const allowedVoices = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"];
    const allowedImageQualities = ["low", "medium", "high"];
    if (!brandName) throw new Error("Brand name is required.");
    if (!/^#[0-9a-f]{6}$/i.test(primaryColor)) throw new Error("Brand colour must be a six-digit hex value.");
    if (allowedVoices.indexOf(voice) === -1) throw new Error("Unsupported OpenAI voice.");
    if (allowedImageQualities.indexOf(imageQuality) === -1) throw new Error("Unsupported image quality.");
    if (!voiceInstructions || voiceInstructions.length > 500) {
      throw new Error("Narration style must contain between 1 and 500 characters.");
    }
    if (!isFinite(speechSpeed) || speechSpeed < 0.75 || speechSpeed > 1.25) {
      throw new Error("Speech speed must be between 0.75 and 1.25.");
    }
    PropertiesService.getScriptProperties().setProperties({
      PRODUCTION_BRAND_NAME: brandName,
      PRODUCTION_PRIMARY_COLOR: primaryColor,
      PRODUCTION_VOICE: voice,
      PRODUCTION_SPEECH_SPEED: String(speechSpeed),
      PRODUCTION_IMAGE_QUALITY: imageQuality,
      PRODUCTION_VOICE_INSTRUCTIONS: voiceInstructions
    });
  },

  getProductionBranding() {
    const properties = PropertiesService.getScriptProperties();
    return {
      brandName: properties.getProperty("PRODUCTION_BRAND_NAME") || "Savannah Atlas",
      primaryColor: properties.getProperty("PRODUCTION_PRIMARY_COLOR") || "#0f766e",
      voice: properties.getProperty("PRODUCTION_VOICE") || "alloy",
      speechSpeed: Number(properties.getProperty("PRODUCTION_SPEECH_SPEED") || 1),
      imageQuality: properties.getProperty("PRODUCTION_IMAGE_QUALITY") || "high",
      voiceInstructions: properties.getProperty("PRODUCTION_VOICE_INSTRUCTIONS") ||
        "Speak as an engaging travel storyteller: warm, confident and energetic, with natural pacing, crisp pronunciation and brief dramatic emphasis on the opening hook. Avoid an exaggerated advertising delivery."
    };
  },

  // savannah-media-worker connection (see media-worker/README.md for the job contract).
  setMediaWorkerUrl(url) {
    const value = String(url || "").trim().replace(/\/$/, "");
    if (!/^https:\/\//i.test(value)) throw new Error("The media worker URL must be an https:// Cloud Run URL.");
    PropertiesService.getScriptProperties().setProperty("MEDIA_WORKER_URL", value);
  },

  getMediaWorkerUrl() {
    return PropertiesService.getScriptProperties().getProperty("MEDIA_WORKER_URL");
  },

  setMediaWorkerSharedSecret(secret) {
    const value = String(secret || "").trim();
    if (!value) throw new Error("The media worker shared secret cannot be empty.");
    PropertiesService.getScriptProperties().setProperty("MEDIA_WORKER_SHARED_SECRET", value);
  },

  getMediaWorkerSharedSecret() {
    return PropertiesService.getScriptProperties().getProperty("MEDIA_WORKER_SHARED_SECRET");
  },

  // The production /exec base URL the media worker's callback must always target,
  // regardless of whether the render was submitted from a /dev test session or the
  // production deployment - ScriptApp.getService().getUrl() returns whichever URL the
  // current execution happens to be running under, which is /dev during testing.
  setMediaWorkerCallbackUrl(url) {
    const value = String(url || "").trim().replace(/\/$/, "");
    if (!/^https:\/\/script\.google\.com\/.*\/exec$/i.test(value)) {
      throw new Error("The media worker callback URL must be the production https://script.google.com/.../exec URL.");
    }
    PropertiesService.getScriptProperties().setProperty("MEDIA_WORKER_CALLBACK_URL", value);
  },

  getMediaWorkerCallbackUrl() {
    return PropertiesService.getScriptProperties().getProperty("MEDIA_WORKER_CALLBACK_URL");
  },

  // "cloud-run" (default) or "creatomate", see Production/VideoProcessingProvider.js.
  setVideoProvider(name) {
    const value = String(name || "").trim().toLowerCase();
    if (["cloud-run", "creatomate"].indexOf(value) === -1) {
      throw new Error("Video provider must be 'cloud-run' or 'creatomate'.");
    }
    PropertiesService.getScriptProperties().setProperty("VIDEO_PROVIDER", value);
  },

  getVideoProvider() {
    return PropertiesService.getScriptProperties().getProperty("VIDEO_PROVIDER") || "cloud-run";
  }

};
