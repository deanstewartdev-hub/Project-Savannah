/****************************************************
 * Project Savannah v1.3 - Creatomate render job.
 ****************************************************/
const RenderJobModel = (() => {
  const VERSION = "render-job-model-v1.0";
  const STATUS = Object.freeze({
    QUEUED: "QUEUED",
    PLANNED: "PLANNED",
    RENDERING: "RENDERING",
    SUCCEEDED: "SUCCEEDED",
    FAILED: "FAILED",
    CANCELLED: "CANCELLED"
  });

  function create(data) {
    const source = clone_(data || {});
    const now = new Date().toISOString();
    const job = {
      id: text_(source.id) || "RND-" + Utilities.getUuid().slice(0, 8).toUpperCase(),
      renderId: text_(source.renderId),
      scriptId: required_(source.scriptId, "Script ID"),
      seoPackId: text_(source.seoPackId),
      templateId: required_(source.templateId, "Template ID"),
      status: status_(source.status || STATUS.QUEUED),
      progress: progress_(source.progress),
      videoUrl: text_(source.videoUrl),
      snapshotUrl: text_(source.snapshotUrl),
      errorMessage: text_(source.errorMessage).slice(0, 500),
      requestPayload: object_(source.requestPayload),
      providerResponse: object_(source.providerResponse),
      createdAt: date_(source.createdAt) || now,
      updatedAt: date_(source.updatedAt) || now,
      version: integer_(source.version, 1),
      modelVersion: VERSION
    };
    if ([STATUS.PLANNED, STATUS.RENDERING, STATUS.SUCCEEDED].indexOf(job.status) !== -1 && !job.renderId) {
      throw error_("A provider render ID is required after submission.");
    }
    return job;
  }

  function update(job, changes) {
    const merged = Object.assign({}, toObject(job), clone_(changes || {}));
    merged.id = job.id;
    merged.scriptId = job.scriptId;
    merged.createdAt = job.createdAt;
    merged.updatedAt = new Date().toISOString();
    merged.version = Number(job.version) + 1;
    return create(merged);
  }

  function toObject(job) { return clone_(create(job)); }
  function text_(value) { return value === undefined || value === null ? "" : String(value).trim(); }
  function required_(value, label) { const result = text_(value); if (!result) throw error_(label + " is required."); return result; }
  function object_(value) { return value && typeof value === "object" && !Array.isArray(value) ? clone_(value) : {}; }
  function status_(value) {
    const result = text_(value).toUpperCase();
    const allowed = Object.keys(STATUS).map(function (key) { return STATUS[key]; });
    if (allowed.indexOf(result) === -1) throw error_("Invalid render status: " + result + ".");
    return result;
  }
  function progress_(value) {
    if (value === undefined || value === null || value === "") return 0;
    const result = Number(value);
    if (!isFinite(result) || result < 0 || result > 100) throw error_("Render progress must be between 0 and 100.");
    return result;
  }
  function date_(value) {
    if (!value) return "";
    const result = new Date(value);
    if (isNaN(result.getTime())) throw error_("Invalid render timestamp.");
    return result.toISOString();
  }
  function integer_(value, fallback) {
    const result = value === undefined ? fallback : Number(value);
    if (!Number.isInteger(result) || result < 1) throw error_("Render version must be positive.");
    return result;
  }
  function clone_(value) { return JSON.parse(JSON.stringify(value)); }
  function error_(message) { const error = new Error(message); error.name = "RenderJobModelError"; return error; }

  return {
    create: create,
    update: update,
    toObject: toObject,
    getStatuses: function () { return clone_(STATUS); }
  };
})();

function testRenderJobModel() {
  const job = RenderJobModel.create({ scriptId: "SCR-TEST", templateId: "template-test" });
  if (job.status !== "QUEUED" || job.progress !== 0) throw new Error("Render job defaults are invalid.");
  return { passed: true };
}
