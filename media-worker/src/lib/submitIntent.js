// Cross-submission idempotency. The jobId reservation (jobState.js) stops one jobId being started twice, but two
// separate submissions get two jobIds. On 10 November two accepted submissions for one script each started a
// render, because the second click had a new jobId. This module decides, before any job is reserved, whether a
// submission is new, a replay of an earlier one, or a refusal.
//
//   1. submitIntentId: one owner action. Its record is created first, and pins the script, the render version and
//      the original jobId. A replay adopts that original jobId.
//   2. scriptId + renderVersion: one render version of one script can be claimed once, by one intent.
//
// Why this is resumable: the two records are two separate writes, so a crash can land between them. The order is
// fixed so every interruption can be completed by a replay of the same intent, and none strands a version:
//   - intent written, version not yet written: a replay sees the same intent and writes the version (it adopts the
//     same jobId, so nothing is duplicated);
//   - both written, job not yet reserved: a replay adopts the jobId and the job reservation (create-only) decides.
// A replay never starts a render whose jobId already has a recorded state. A storage error at any step refuses the
// submission (fail closed). A version held by another intent is refused, whatever state its job is in.
// Nothing releases a claim automatically: a version whose intent is never replayed needs an operator release (not
// built yet).

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

function unreadable(what) {
  return new Error(`${what} is recorded but could not be read; no render was started.`);
}

// Decides what this submission is. Returns:
//   { status: "proceed", jobId, replay }   – start (or reserve) this jobId. replay is true when an earlier request
//                                            with the same intent already named it; the caller must then report the
//                                            job's state rather than assume a new start.
//   { status: "refused", reason, existingJobId }
// Throws when a claim cannot be confirmed; the caller must then refuse the submission.
export async function prepareSubmission(store, { submitIntentId, scriptId, renderVersion, jobId, now }) {
  let effectiveJobId = jobId;
  let replay = false;

  if (submitIntentId !== undefined) {
    const path = intentPath(submitIntentId);
    const created = await store.createIfAbsent(path, {
      submitIntentId, scriptId: scriptId ?? null, renderVersion: renderVersion ?? null, jobId, claimedAt: now
    });
    if (!created.ok) {
      const existing = await store.read(path);
      const record = existing && existing.value;
      if (!record || !record.jobId) throw unreadable("The submission record");
      const sameTarget = record.scriptId === (scriptId ?? null) && record.renderVersion === (renderVersion ?? null);
      if (!sameTarget) {
        return {
          status: "refused",
          reason: "This submission was already used for a different script or render version.",
          existingJobId: record.jobId
        };
      }
      effectiveJobId = record.jobId;
      replay = true;
    }
  }

  if (scriptId !== undefined && renderVersion !== undefined) {
    const path = renderVersionPath(scriptId, renderVersion);
    const created = await store.createIfAbsent(path, {
      scriptId, renderVersion, jobId: effectiveJobId, submitIntentId: submitIntentId ?? null, claimedAt: now
    });
    if (!created.ok) {
      const existing = await store.read(path);
      const record = existing && existing.value;
      if (!record || !record.jobId) throw unreadable("The render version record");
      const sameIntent = submitIntentId !== undefined && record.submitIntentId === submitIntentId;
      if (!sameIntent) {
        return {
          status: "refused",
          reason: "This render version of the script was already submitted.",
          existingJobId: record.jobId
        };
      }
      // The same intent already holds this version (an interrupted earlier attempt): it names the same job.
      effectiveJobId = record.jobId;
      replay = true;
    }
  }

  return { status: "proceed", jobId: effectiveJobId, replay };
}
