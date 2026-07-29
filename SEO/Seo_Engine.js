/****************************************************
 * Project Savannah v1.3 - approved script to SEO pack.
 ****************************************************/
const SeoEngine = (() => {
  const VERSION = "seo-engine-v1.0";
  function generate(scriptId) {
    const id = String(scriptId || "").trim();
    if (!id) throw error_("Script ID is required.");
    const script = ScriptsRepository.getScriptById(id);
    if (!script) throw error_("The approved script was not found.");
    if (script.status !== "APPROVED") throw error_("Only an approved script can generate SEO.");
    const existing = SeoRepository.getByScriptId(id);
    if (existing) return { pack: existing, created: false, engineVersion: VERSION };
    const response = AIService.generateStructuredContent(SeoPromptLibrary.build(script), SeoPromptLibrary.getSchema(), {
      temperature: 0.5, maxTokens: 1400,
      systemMessage: "You create accurate high-converting YouTube Shorts metadata. Return only the requested schema.",
      metadata: { action: "GENERATE_SEO_PACK", scriptId: id, engineVersion: VERSION }
    });
    if (!response || response.success !== true || !response.data) throw error_("The AI service did not return a valid SEO package.");
    const pack = SeoPackModel.create(Object.assign({}, response.data, { scriptId: script.id, ideaId: script.ideaId,
      promptVersion: SeoPromptLibrary.getPromptVersion(), aiModel: response.model || "",
      metadata: { scriptVersion: script.version, provider: response.provider || "" } }));
    return { pack: SeoRepository.save(pack), created: true, engineVersion: VERSION };
  }
  function error_(m) { const e = new Error(m); e.name = "SeoEngineError"; return e; }
  return { generate: generate, getEngineVersion: function () { return VERSION; } };
})();
