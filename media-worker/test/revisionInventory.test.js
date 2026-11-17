import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assessRevisions, approvalReady } from "../../tools/production/revision-inventory.mjs";
import { runPlan, CONTROLLED_PLAN, TODAY } from "../../tools/production/rollout-guard.mjs";

// Regression: a reachable legacy revision must block deployment approval, even when the rollout plan itself passes.
// The snapshot is the read-only inventory taken on 17 November 2026 (names, tags, traffic, secret references and version
// states; no secret values).

const SNAPSHOT = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/dispatcher-revisions-2026-11-17.json", import.meta.url)), "utf8"));

const clone = (value) => JSON.parse(JSON.stringify(value));
const planPasses = runPlan(TODAY, CONTROLLED_PLAN);

test("the real snapshot is NOT SAFE: the tagged candidate revision 00009-man is reachable and references the legacy version", () => {
  const assessment = assessRevisions(SNAPSHOT);
  assert.equal(assessment.safe, false);
  assert.equal(assessment.blockers.length, 1, JSON.stringify(assessment.blockers));
  assert.match(assessment.blockers[0], /00009-man \(tags: candidate\)/);
});

test("the live revision 00030-wam is not the blocker: it references the current version and is not a legacy path", () => {
  const assessment = assessRevisions(SNAPSHOT);
  assert.ok(!assessment.blockers.some((blocker) => blocker.includes("00030-wam")));
});

test("a disabled legacy version does not make a reachable revision safe, because re-enabling it is the undo step", () => {
  assert.equal(SNAPSHOT.secretVersions["1"], "disabled");
  assert.equal(assessRevisions(SNAPSHOT).safe, false);
});

test("the unreachable legacy revision 00010-ndp is a note, not a blocker, while it has no tag or traffic", () => {
  const assessment = assessRevisions(SNAPSHOT);
  assert.ok(assessment.notes.some((note) => note.includes("00010-ndp")));
  assert.ok(!assessment.blockers.some((blocker) => blocker.includes("00010-ndp")));
});

test("removing the tag from the one reachable legacy revision clears that blocker (and only that)", () => {
  const snapshot = clone(SNAPSHOT);
  snapshot.revisions.find((r) => r.name === "00009-man").tags = [];
  const assessment = assessRevisions(snapshot);
  assert.equal(assessment.safe, true, JSON.stringify(assessment.blockers));
});

test("a live revision that references the legacy version blocks approval", () => {
  const snapshot = clone(SNAPSHOT);
  snapshot.revisions.find((r) => r.name === "00030-wam").secretRefs = [{ name: "JOB_SUBMIT_SECRET", version: "1" }];
  const assessment = assessRevisions(snapshot);
  assert.equal(assessment.safe, false);
  assert.ok(assessment.blockers.some((blocker) => blocker.includes("00030-wam") && blocker.includes("traffic 100%")));
});

test("a previous-secret reference to the legacy version blocks approval when the revision is reachable", () => {
  const snapshot = clone(SNAPSHOT);
  const revision = snapshot.revisions.find((r) => r.name === "00013-jin");
  revision.secretRefs = [{ name: "JOB_SUBMIT_SECRET", version: "2" }, { name: "JOB_SUBMIT_SECRET_PREVIOUS", version: "1" }];
  const assessment = assessRevisions(snapshot);
  assert.equal(assessment.safe, false);
  assert.ok(assessment.blockers.some((blocker) => blocker.includes("00013-jin")));
});

test("a 'latest' reference blocks approval when the newest enabled version is the legacy one", () => {
  const snapshot = clone(SNAPSHOT);
  snapshot.secretVersions = { "1": "enabled", "2": "disabled" };
  const latestRevision = snapshot.revisions.find((r) => r.name === "00008-btl");
  latestRevision.tags = ["probe"];
  const assessment = assessRevisions(snapshot);
  assert.equal(assessment.safe, false, "latest now resolves to the legacy value, so the tagged revision accepts it");
  assert.ok(assessment.blockers.some((blocker) => blocker.includes("00008-btl")));
});

test("the regression: even when the rollout plan passes, deployment approval is refused while a reachable legacy revision exists", () => {
  assert.equal(planPasses.ok, true, "the state-machine plan itself is consistent");
  const approval = approvalReady(planPasses, assessRevisions(SNAPSHOT));
  assert.equal(approval.approved, false);
  assert.ok(approval.reasons.some((reason) => reason.includes("00009-man")));
});

test("approval is granted only when the plan passes AND no reachable revision accepts the legacy value", () => {
  const snapshot = clone(SNAPSHOT);
  snapshot.revisions.find((r) => r.name === "00009-man").tags = [];
  const approval = approvalReady(planPasses, assessRevisions(snapshot));
  assert.equal(approval.approved, true, JSON.stringify(approval.reasons));
  const failingPlan = approvalReady({ ok: false, reason: "open is refused" }, assessRevisions(snapshot));
  assert.equal(failingPlan.approved, false);
});
