/****************************************************
 * Project Savannah v1.3 - frontend-safe SEO boundary.
 ****************************************************/
const SeoController = (() => {
  const VERSION = "seo-controller-v1.0";
  function listEligible() {
    const requestId = requestId_();
    try {
      const scripts = ScriptsRepository.getScriptsByStatus("APPROVED");
      return success_(requestId, "Approved scripts loaded.", { scripts: scripts.map(function (script) {
        const pack = SeoRepository.getByScriptId(script.id);
        return { id: script.id, ideaId: script.ideaId, title: script.title, hook: script.hook,
          estimatedDurationSeconds: script.estimatedDurationSeconds, updatedAt: script.updatedAt,
          hasSeoPack: !!pack, seoPackId: pack ? pack.id : "" };
      })});
    } catch (error) { return failure_(requestId, "Approved scripts could not be loaded.", error); }
  }
  function generate(request) {
    const requestId = requestId_();
    try {
      const scriptId = String(request && request.scriptId || "").trim();
      if (!scriptId) throw controllerError_("Script ID is required.");
      const result = SeoEngine.generate(scriptId);
      return success_(requestId, result.created ? "SEO pack generated." : "Existing SEO pack loaded.", result);
    } catch (error) { return failure_(requestId, "SEO generation failed.", error); }
  }
  function list() {
    const requestId = requestId_();
    try {
      const packs = SeoRepository.getAll().sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); });
      return success_(requestId, "SEO packs loaded.", { packs: packs, count: packs.length });
    } catch (error) { return failure_(requestId, "SEO packs could not be loaded.", error); }
  }
  function success_(id, message, data) { return { success: true, statusCode: 200, requestId: id, message: message,
    data: JSON.parse(JSON.stringify(data || {})), controllerVersion: VERSION }; }
  function failure_(id, message, error) {
    const safe = String(error && error.message || "Unknown error").replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]").slice(0, 500);
    Logger.log(JSON.stringify({ requestId: id, controller: "SeoController", errorName: error && error.name, errorMessage: safe }));
    return { success: false, statusCode: 400, requestId: id, message: message, data: null,
      error: { code: error && error.name || "SEO_REQUEST_FAILED", message: safe }, controllerVersion: VERSION };
  }
  function requestId_() { return "REQ-" + Utilities.getUuid().slice(0, 8).toUpperCase(); }
  function controllerError_(m) { const e = new Error(m); e.name = "SeoControllerError"; return e; }
  return { listEligible: listEligible, generate: generate, list: list };
})();
function seoListEligibleScripts() { return SeoController.listEligible(); }
function seoGenerate(request) { return SeoController.generate(request); }
function seoListPacks() { return SeoController.list(); }
function testSeoControllerInvalidRequest() {
  const result = SeoController.generate({});
  if (result.success || !result.error) throw new Error("SeoController accepted invalid input.");
  return { passed: true };
}
