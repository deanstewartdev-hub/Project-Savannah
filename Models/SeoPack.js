/****************************************************
 * Project Savannah v1.3 - canonical Short metadata.
 ****************************************************/
const SeoPackModel = (() => {
  const VERSION = "seo-pack-model-v1.0";
  const STATUS = Object.freeze({ GENERATED: "GENERATED", READY_FOR_PRODUCTION: "READY_FOR_PRODUCTION", ARCHIVED: "ARCHIVED" });
  function create(data) {
    const s = clone_(data || {}), now = new Date().toISOString();
    const pack = {
      id: text_(s.id) || "SEO-" + Utilities.getUuid().slice(0, 8).toUpperCase(),
      scriptId: required_(s.scriptId, "Script ID"), ideaId: text_(s.ideaId),
      titleOptions: list_(s.titleOptions), description: required_(s.description, "Description"),
      tags: list_(s.tags), hashtags: list_(s.hashtags), keywords: list_(s.keywords),
      thumbnailText: required_(s.thumbnailText, "Thumbnail text"),
      pinnedComment: required_(s.pinnedComment, "Pinned comment"),
      status: status_(s.status || STATUS.GENERATED), promptVersion: text_(s.promptVersion),
      aiModel: text_(s.aiModel), metadata: object_(s.metadata),
      createdAt: date_(s.createdAt) || now, updatedAt: date_(s.updatedAt) || now,
      version: integer_(s.version, 1), modelVersion: VERSION
    };
    if (pack.titleOptions.length < 2) throw error_("At least two title options are required.");
    if (!pack.tags.length || !pack.hashtags.length || !pack.keywords.length) throw error_("Tags, hashtags and keywords are required.");
    return pack;
  }
  function update(pack, changes) {
    const merged = Object.assign({}, toObject(pack), clone_(changes || {}));
    merged.id = pack.id; merged.scriptId = pack.scriptId; merged.createdAt = pack.createdAt;
    merged.updatedAt = new Date().toISOString(); merged.version = Number(pack.version) + 1;
    return create(merged);
  }
  function toObject(pack) { return clone_(create(pack)); }
  function text_(v) { return v === undefined || v === null ? "" : String(v).trim(); }
  function required_(v, label) { const r = text_(v); if (!r) throw error_(label + " is required."); return r; }
  function list_(v) {
    const a = Array.isArray(v) ? v : text_(v).split(",");
    return a.map(text_).filter(function (item, i, all) { return item && all.indexOf(item) === i; });
  }
  function object_(v) { return v && typeof v === "object" && !Array.isArray(v) ? clone_(v) : {}; }
  function status_(v) {
    const r = text_(v).toUpperCase(), allowed = Object.keys(STATUS).map(function (k) { return STATUS[k]; });
    if (allowed.indexOf(r) === -1) throw error_("Invalid SEO pack status: " + r + "."); return r;
  }
  function date_(v) { if (!v) return ""; const d = new Date(v); if (isNaN(d.getTime())) throw error_("Invalid SEO pack date."); return d.toISOString(); }
  function integer_(v, f) { const r = v === undefined ? f : Number(v); if (!Number.isInteger(r) || r < 1) throw error_("SEO pack version must be positive."); return r; }
  function clone_(v) { return JSON.parse(JSON.stringify(v)); }
  function error_(m) { const e = new Error(m); e.name = "SeoPackModelError"; return e; }
  return { create: create, update: update, toObject: toObject, getStatuses: function () { return clone_(STATUS); } };
})();
function testSeoPackModelRejectsInvalidData() {
  try { SeoPackModel.create({ scriptId: "SCRIPT-TEST" }); }
  catch (error) { if (error.name === "SeoPackModelError") return { passed: true }; throw error; }
  throw new Error("SeoPackModel accepted invalid data.");
}
