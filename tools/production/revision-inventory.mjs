// Reachability and secret-reference assessment for the dispatcher's Cloud Run revisions. It is a pure function over a
// read-only inventory: a snapshot made with gcloud describe/list commands and Cloud Monitoring (see
// media-worker/test/fixtures/ and deployment-safety.md section 2a). It never reads a secret value.
//
// Reachable: a revision receives traffic (trafficPercent > 0) or has a tag. A tag gives a public URL even at 0%.
// Accepts the legacy value: the revision's JOB_SUBMIT_SECRET or JOB_SUBMIT_SECRET_PREVIOUS references the legacy version,
//   or references "latest" while the newest ENABLED version is the legacy one.
//
// Rule: a reachable revision that accepts the legacy value blocks deployment approval. Re-enabling a disabled legacy
// version is the documented undo step, so a disabled version does not make a revision safe.

export function assessRevisions(inventory, { legacyVersion = "1" } = {}) {
  const states = inventory.secretVersions || {};
  const enabled = Object.keys(states).filter((version) => states[version] === "enabled").map(Number);
  const newestEnabled = enabled.length ? String(Math.max(...enabled)) : null;
  const blockers = [];
  const notes = [];

  for (const revision of inventory.revisions || []) {
    const tags = revision.tags || [];
    const reachable = (revision.trafficPercent || 0) > 0 || tags.length > 0;
    const refs = (revision.secretRefs || []).filter((ref) => ref.name === "JOB_SUBMIT_SECRET" || ref.name === "JOB_SUBMIT_SECRET_PREVIOUS");
    const acceptsLegacy = refs.some((ref) =>
      ref.version === legacyVersion || (ref.version === "latest" && newestEnabled === legacyVersion));
    if (!acceptsLegacy) continue;

    const description = revision.name +
      (tags.length ? " (tags: " + tags.join(", ") + ")" : "") +
      ((revision.trafficPercent || 0) > 0 ? " (traffic " + revision.trafficPercent + "%)" : "");
    if (reachable) {
      blockers.push("reachable revision accepts the legacy secret: " + description);
    } else {
      notes.push("unreachable today, but references the legacy secret (reachable again if traffic or a tag is added): " + revision.name);
    }
  }

  return { safe: blockers.length === 0, blockers, notes };
}

// Deployment approval needs both: the rollout plan must pass its checks, and no reachable revision may accept the
// legacy value. Either alone is not enough. Returns the reasons so an approval note can record them.
export function approvalReady(planOutcome, assessment) {
  const reasons = [];
  if (!planOutcome.ok) reasons.push("the rollout plan does not pass: " + planOutcome.reason);
  if (!assessment.safe) reasons.push(...assessment.blockers.map((blocker) => "blocked: " + blocker));
  return { approved: reasons.length === 0, reasons };
}
