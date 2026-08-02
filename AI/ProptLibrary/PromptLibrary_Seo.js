/****************************************************
 * Project Savannah v1.3 - YouTube Shorts SEO prompts.
 ****************************************************/
const SeoPromptLibrary = (() => {
  const VERSION = "seo-prompt-v1.0";
  function build(script) {
    if (!script || !String(script.voiceoverScript || "").trim()) throw new Error("A complete approved script is required.");
    return [
      "Create a YouTube Shorts metadata package for the approved script below.",
      "Write 3 accurate curiosity-driven title options under 70 characters.",
      "Write a concise description with a natural call to action.",
      "Return 8-15 tags, 3-5 hashtags, 5-10 search keywords,",
      "thumbnail text of no more than 5 words, and one pinned comment.",
      "Do not invent facts or use misleading clickbait.",
      "", "TITLE: " + String(script.title || ""), "HOOK: " + String(script.hook || ""),
      "VOICEOVER: " + String(script.voiceoverScript || ""), "CTA: " + String(script.callToAction || "")
    ].join("\n");
  }
  function getSchema() {
    const strings = { type: "array", items: { type: "string" } };
    return { type: "json_schema", name: "project_savannah_seo_pack", strict: true, schema: {
      type: "object", additionalProperties: false,
      properties: { titleOptions: strings, description: { type: "string" }, tags: strings,
        hashtags: strings, keywords: strings, thumbnailText: { type: "string" }, pinnedComment: { type: "string" } },
      required: ["titleOptions", "description", "tags", "hashtags", "keywords", "thumbnailText", "pinnedComment"]
    }};
  }
  return { build: build, getSchema: getSchema, getPromptVersion: function () { return VERSION; } };
})();
