/****************************************************
 * Project Savannah v1.3 - YouTube publishing job.
 ****************************************************/
const PublishingJobModel = (() => {
  const VERSION = "publishing-job-model-v1.0";
  const STATUS = Object.freeze({
    UPLOADING: "UPLOADING",
    PUBLISHED: "PUBLISHED",
    FAILED: "FAILED"
  });

  function create(data) {
    const source = clone_(data || {});
    const now = new Date().toISOString();
    return {
      id: text_(source.id) || "PUB-" + Utilities.getUuid().slice(0, 8).toUpperCase(),
      renderJobId: required_(source.renderJobId, "Render job ID"),
      scriptId: required_(source.scriptId, "Script ID"),
      seoPackId: text_(source.seoPackId),
      youtubeVideoId: text_(source.youtubeVideoId),
      youtubeUrl: text_(source.youtubeUrl),
      title: required_(source.title, "Video title").slice(0, 100),
      description: text_(source.description).slice(0, 5000),
      tags: array_(source.tags).slice(0, 30),
      privacyStatus: privacy_(source.privacyStatus || "private"),
      status: status_(source.status || STATUS.UPLOADING),
      errorMessage: text_(source.errorMessage).slice(0, 500),
      providerResponse: object_(source.providerResponse),
      createdAt: date_(source.createdAt) || now,
      updatedAt: date_(source.updatedAt) || now,
      version: integer_(source.version, 1),
      modelVersion: VERSION
    };
  }

  function update(job, changes) {
    const merged = Object.assign({}, create(job), clone_(changes || {}));
    merged.id = job.id;
    merged.renderJobId = job.renderJobId;
    merged.scriptId = job.scriptId;
    merged.createdAt = job.createdAt;
    merged.updatedAt = new Date().toISOString();
    merged.version = Number(job.version) + 1;
    return create(merged);
  }

  function text_(value) { return value === undefined || value === null ? "" : String(value).trim(); }
  function required_(value, label) { const result = text_(value); if (!result) throw error_(label + " is required."); return result; }
  function array_(value) { return Array.isArray(value) ? value.map(text_).filter(Boolean) : []; }
  function object_(value) { return value && typeof value === "object" && !Array.isArray(value) ? clone_(value) : {}; }
  function privacy_(value) {
    const result = text_(value).toLowerCase();
    if (["private", "unlisted", "public"].indexOf(result) === -1) throw error_("Invalid YouTube privacy status.");
    return result;
  }
  function status_(value) {
    const result = text_(value).toUpperCase();
    if (Object.keys(STATUS).map(function (key) { return STATUS[key]; }).indexOf(result) === -1) {
      throw error_("Invalid publishing status.");
    }
    return result;
  }
  function date_(value) {
    if (!value) return "";
    const result = new Date(value);
    if (isNaN(result.getTime())) throw error_("Invalid publishing timestamp.");
    return result.toISOString();
  }
  function integer_(value, fallback) {
    const result = value === undefined ? fallback : Number(value);
    if (!Number.isInteger(result) || result < 1) throw error_("Publishing version must be positive.");
    return result;
  }
  function clone_(value) { return JSON.parse(JSON.stringify(value)); }
  function error_(message) { const error = new Error(message); error.name = "PublishingJobModelError"; return error; }

  return { create: create, update: update, getStatuses: function () { return clone_(STATUS); } };
})();

function testPublishingJobModel() {
  const job = PublishingJobModel.create({
    renderJobId: "RND-TEST", scriptId: "SCR-TEST", title: "Test Short"
  });
  if (job.status !== "UPLOADING" || job.privacyStatus !== "private") {
    throw new Error("Publishing job defaults are invalid.");
  }
  return { passed: true };
}
