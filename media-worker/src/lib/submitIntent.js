// Cross-submission idempotency. The jobId reservation (jobState.js) stops one jobId being started twice, but two
// separate submissions get two jobIds. On 10 November two accepted submissions for one script each started a
// render, because the second click had a new jobId. This module adds two create-only claims, checked before any
// job is reserved:
//
//   1. submitIntentId: one owner action (for example one click, or one request that is retried after a lost reply).
//      Replaying the same intent returns the job that intent created, and starts nothing.
//   2. scriptId + renderVersion: one render version of one script can be submitted once. A fresh tab, a refresh, a
//      second session, or a new intent for the same version is refused, whatever state the earlier job is in. A
//      failed or uncertain job is not blanket permission to pay again; a new version is a new claim.
//
// Both claims use the same create-only write as the jobId reservation, so only one caller can win. A storage error
// on either claim refuses the submission (fail closed). Nothing here releases a claim automatically.

export const INTENT_ID_PATTERN = /^[A-Za-z0-9-]{8,80}$/;
export const SCRIPT_ID_PATTERN = /^[A-Za-z0-9_-]{3,80}$/;

export function intentPath(submitIntentId) {
  return `submit-intents/${submitIntentId}.json`;
}

export function renderVersionPath(scriptId, renderVersion) {
  return `renders-by-version/${scriptId}/v${renderVersion}.json`;
}

// Returns an error message, or null. Absent fields are allowed unless the deployment requires them.
export function validateIntentFields(body, { requireIntent = false } = {}) {
  const { submitIntentId, scriptId, renderVersion } = body || {};
  if (submitIntentId !== undefined && (typeof submitIntentId !== "string" || !INTENT_ID_PATTERN.test(submitIntentId))) {
    return "submitIntentId must be 8 to 80 letters, digits or hyphens.";
  }
  if (scriptId !== undefined && (typeof scriptId !== "string" || !SCRIPT_ID_PATTERN.test(scriptId))) {
    return "scriptId must be 3 to 80 letters, digits, hyphens or underscores.";
  }
  if (renderVersion !== undefined && (!Number.isInteger(renderVersion) || renderVersion < 1 || renderVersion > 1000)) {
    return "renderVersion must be a whole number from 1 to 1000.";
  }
  if (renderVersion !== undefined && scriptId === undefined) return "renderVersion needs a scriptId.";
  if (requireIntent && (submitIntentId === undefined || scriptId === undefined || renderVersion === undefined)) {
    return "This deployment requires submitIntentId, scriptId and renderVersion for every render.";
  }
  return null;
}

// Claims the submission. Returns { status: "claimed" } or { status: "duplicate", reason, existingJobId, sameIntent }.
// Throws when the claim cannot be confirmed; the caller must then refuse the submission.
export async function claimSubmission(store, { submitIntentId, scriptId, renderVersion, jobId, now }) {
  if (scriptId !== undefined && renderVersion !== undefined) {
    const path = renderVersionPath(scriptId, renderVersion);
    const created = await store.createIfAbsent(path, { scriptId, renderVersion, jobId, submitIntentId: submitIntentId || null, claimedAt: now });
    if (!created.ok) {
      const existing = await store.read(path);
      const existingIntent = existing && existing.value ? existing.value.submitIntentId : null;
      return {
        status: "duplicate",
        reason: "This render version of the script was already submitted.",
        existingJobId: existing && existing.value ? existing.value.jobId : null,
        sameIntent: Boolean(submitIntentId) && existingIntent === submitIntentId
      };
    }
  }
  if (submitIntentId !== undefined) {
    const path = intentPath(submitIntentId);
    const created = await store.createIfAbsent(path, { submitIntentId, scriptId: scriptId || null, renderVersion: renderVersion || null, jobId, claimedAt: now });
    if (!created.ok) {
      const existing = await store.read(path);
      return {
        status: "duplicate",
        reason: "This submission was already made.",
        existingJobId: existing && existing.value ? existing.value.jobId : null,
        sameIntent: true
      };
    }
  }
  return { status: "claimed" };
}
