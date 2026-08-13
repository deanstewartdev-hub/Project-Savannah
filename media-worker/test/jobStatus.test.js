import test from "node:test";
import assert from "node:assert/strict";
import { requireAuth } from "../src/lib/auth.js";
import { buildStatusResponse, isValidJobId } from "../src/lib/jobStatus.js";

const PROJECT = "savannah-media-worker";
const REGION = "europe-west2";
const JOB_NAME = "savannah-render-job";
const VALID_JOB_ID = "cr-c68c66f5-b646-4c1c-a88a-8748c5c0f1d9";
const VALID_OPERATION_NAME = `projects/${PROJECT}/locations/${REGION}/operations/abc123`;
const PASSING_PROBE = { passesResolutionGate: true, passesSilenceGate: true, passesBlackFrameGate: true };

function fakeReqRes(headers) {
  let statusCode = null;
  let jsonBody = null;
  let nextCalled = false;
  const req = { get: (name) => headers[name.toLowerCase()] };
  const res = {
    status(code) { statusCode = code; return this; },
    json(body) { jsonBody = body; return this; }
  };
  const next = () => { nextCalled = true; };
  return { req, res, next, result: () => ({ statusCode, jsonBody, nextCalled }) };
}

// 1. no Authorization header -> 401
test("requireAuth: missing header rejects with 401", () => {
  const { req, res, next, result } = fakeReqRes({});
  requireAuth("secret-value")(req, res, next);
  const r = result();
  assert.equal(r.statusCode, 401);
  assert.equal(r.jsonBody.error, "Unauthorized");
  assert.equal(r.nextCalled, false);
});

// 2. wrong bearer token -> 401
test("requireAuth: wrong bearer token rejects with 401", () => {
  const { req, res, next, result } = fakeReqRes({ authorization: "Bearer wrong-value" });
  requireAuth("secret-value")(req, res, next);
  const r = result();
  assert.equal(r.statusCode, 401);
  assert.equal(r.nextCalled, false);
});

test("requireAuth: correct bearer token calls next", () => {
  const { req, res, next, result } = fakeReqRes({ authorization: "Bearer secret-value" });
  requireAuth("secret-value")(req, res, next);
  assert.equal(result().nextCalled, true);
});

// 3. malformed jobId -> 400
test("buildStatusResponse: malformed jobId is rejected with 400", async () => {
  const result = await buildStatusResponse({
    jobId: "../../etc/passwd",
    operationName: null,
    project: PROJECT, region: REGION, jobName: JOB_NAME,
    artifactExists: false, probeReport: null,
    checkRunJobProgress: async () => { throw new Error("should not be called"); }
  });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /jobId/);
});

test("isValidJobId rejects path traversal and arbitrary strings", () => {
  assert.equal(isValidJobId("../../etc/passwd"), false);
  assert.equal(isValidJobId("cr-not-a-uuid"), false);
  assert.equal(isValidJobId(""), false);
  assert.equal(isValidJobId(null), false);
  assert.equal(isValidJobId(VALID_JOB_ID), true);
});

// 4. malformed operationName -> 400
test("buildStatusResponse: malformed operationName is rejected with 400", async () => {
  const result = await buildStatusResponse({
    jobId: VALID_JOB_ID,
    operationName: "not-an-operation-name",
    project: PROJECT, region: REGION, jobName: JOB_NAME,
    artifactExists: false, probeReport: null,
    checkRunJobProgress: async () => { throw new Error("should not be called"); }
  });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /operationName/);
});

// 5. historical request with no operationName -> safe response, no lookup attempted
test("buildStatusResponse: no operationName returns a safe response without a status lookup", async () => {
  let lookupCalled = false;
  const result = await buildStatusResponse({
    jobId: VALID_JOB_ID,
    operationName: null,
    project: PROJECT, region: REGION, jobName: JOB_NAME,
    artifactExists: false, probeReport: null,
    checkRunJobProgress: async () => { lookupCalled = true; return {}; }
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.state, "UNKNOWN");
  assert.equal(result.body.operationName, null);
  assert.equal(lookupCalled, false);
});

// 6. valid artifact path only uses the supplied normalized jobId (dispatcher.js builds
// the GCS path directly from jobId; this confirms the validator that gates that path
// construction cannot be bypassed with a crafted value).
test("isValidJobId rejects values that would escape the renders/<jobId>/ prefix", () => {
  assert.equal(isValidJobId(`${VALID_JOB_ID}/../other-job`), false);
  assert.equal(isValidJobId(`${VALID_JOB_ID}\n/etc/passwd`), false);
});

// 7. final.mp4 absent -> artifactExists false
test("buildStatusResponse: artifactExists false is passed through unchanged", async () => {
  const result = await buildStatusResponse({
    jobId: VALID_JOB_ID, operationName: null,
    project: PROJECT, region: REGION, jobName: JOB_NAME,
    artifactExists: false, probeReport: null,
    checkRunJobProgress: async () => ({})
  });
  assert.equal(result.body.artifactExists, false);
});

// 8. final.mp4 present -> artifactExists true
test("buildStatusResponse: artifactExists true is passed through unchanged", async () => {
  const result = await buildStatusResponse({
    jobId: VALID_JOB_ID, operationName: null,
    project: PROJECT, region: REGION, jobName: JOB_NAME,
    artifactExists: true, probeReport: PASSING_PROBE,
    checkRunJobProgress: async () => ({})
  });
  assert.equal(result.body.artifactExists, true);
});

// 9. valid passing probe -> probePassed true, probeExists true
test("buildStatusResponse: all three quality gates passing yields probePassed/probeExists true", async () => {
  const result = await buildStatusResponse({
    jobId: VALID_JOB_ID, operationName: null,
    project: PROJECT, region: REGION, jobName: JOB_NAME,
    artifactExists: true, probeReport: PASSING_PROBE,
    checkRunJobProgress: async () => ({})
  });
  assert.equal(result.body.probeExists, true);
  assert.equal(result.body.probePassed, true);
});

test("buildStatusResponse: a failing gate yields probePassed false but probeExists true", async () => {
  const result = await buildStatusResponse({
    jobId: VALID_JOB_ID, operationName: null,
    project: PROJECT, region: REGION, jobName: JOB_NAME,
    artifactExists: true, probeReport: { ...PASSING_PROBE, passesSilenceGate: false },
    checkRunJobProgress: async () => ({})
  });
  assert.equal(result.body.probeExists, true);
  assert.equal(result.body.probePassed, false);
});

test("buildStatusResponse: no probe report yields probeExists false and probePassed false", async () => {
  const result = await buildStatusResponse({
    jobId: VALID_JOB_ID, operationName: null,
    project: PROJECT, region: REGION, jobName: JOB_NAME,
    artifactExists: false, probeReport: null,
    checkRunJobProgress: async () => ({})
  });
  assert.equal(result.body.probeExists, false);
  assert.equal(result.body.probePassed, false);
});

// 10. terminal external result + valid artifact -> facts only, no inferred verdict.
// The dispatcher cannot know whether Savannah already received a callback, so it must
// never decide "recovery required" itself - it only reports state + artifact facts and
// leaves that judgment to Apps Script reconciliation, which has that context.
test("buildStatusResponse: FAILED execution with an existing passing artifact reports facts only, no recoveryRequired field", async () => {
  const result = await buildStatusResponse({
    jobId: VALID_JOB_ID, operationName: VALID_OPERATION_NAME,
    project: PROJECT, region: REGION, jobName: JOB_NAME,
    artifactExists: true, probeReport: PASSING_PROBE,
    checkRunJobProgress: async () => ({
      done: true,
      metadata: { name: `projects/${PROJECT}/locations/${REGION}/jobs/${JOB_NAME}/executions/savannah-render-job-abc12` },
      result: { failedCount: 1, conditions: [{ type: "Completed", state: "CONDITION_FAILED", message: "signBlob denied" }] }
    })
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.state, "FAILED");
  assert.equal(result.body.artifactExists, true);
  assert.equal(result.body.probeExists, true);
  assert.equal(result.body.probePassed, true);
  assert.equal(result.body.failureDetail, "signBlob denied");
  assert.equal("recoveryRequired" in result.body, false, "the endpoint must not decide recovery itself");
});

test("buildStatusResponse: PENDING state is reported as a fact, still with no recoveryRequired field", async () => {
  const result = await buildStatusResponse({
    jobId: VALID_JOB_ID, operationName: VALID_OPERATION_NAME,
    project: PROJECT, region: REGION, jobName: JOB_NAME,
    artifactExists: true, probeReport: PASSING_PROBE,
    checkRunJobProgress: async () => ({
      done: false,
      metadata: { name: `projects/${PROJECT}/locations/${REGION}/jobs/${JOB_NAME}/executions/savannah-render-job-abc12` }
    })
  });
  assert.equal(result.body.state, "PENDING");
  assert.equal("recoveryRequired" in result.body, false);
});

// 11. transient provider error is NOT converted to FAILED
test("buildStatusResponse: a non-NOT_FOUND lookup error becomes UNKNOWN, never FAILED", async () => {
  const result = await buildStatusResponse({
    jobId: VALID_JOB_ID, operationName: VALID_OPERATION_NAME,
    project: PROJECT, region: REGION, jobName: JOB_NAME,
    artifactExists: false, probeReport: null,
    checkRunJobProgress: async () => { const e = new Error("UNAVAILABLE: connection reset"); e.code = 14; throw e; }
  });
  assert.equal(result.body.state, "UNKNOWN");
  assert.notEqual(result.body.state, "FAILED");
});

test("buildStatusResponse: a genuine NOT_FOUND (code 5) maps to NOT_FOUND, not FAILED", async () => {
  const result = await buildStatusResponse({
    jobId: VALID_JOB_ID, operationName: VALID_OPERATION_NAME,
    project: PROJECT, region: REGION, jobName: JOB_NAME,
    artifactExists: false, probeReport: null,
    checkRunJobProgress: async () => { const e = new Error("Operation not found"); e.code = 5; throw e; }
  });
  assert.equal(result.body.state, "NOT_FOUND");
});

// 12. supplied foreign project/region operationName is rejected
test("buildStatusResponse: an operationName from a foreign project is rejected with 400", async () => {
  const result = await buildStatusResponse({
    jobId: VALID_JOB_ID,
    operationName: "projects/some-other-project/locations/europe-west2/operations/abc123",
    project: PROJECT, region: REGION, jobName: JOB_NAME,
    artifactExists: false, probeReport: null,
    checkRunJobProgress: async () => { throw new Error("should not be called"); }
  });
  assert.equal(result.status, 400);
});

test("buildStatusResponse: an operationName from a foreign region is rejected with 400", async () => {
  const result = await buildStatusResponse({
    jobId: VALID_JOB_ID,
    operationName: `projects/${PROJECT}/locations/us-central1/operations/abc123`,
    project: PROJECT, region: REGION, jobName: JOB_NAME,
    artifactExists: false, probeReport: null,
    checkRunJobProgress: async () => { throw new Error("should not be called"); }
  });
  assert.equal(result.status, 400);
});

// The operation resource name alone only proves project/region, never which Job
// triggered it - an authenticated caller (anyone holding the shared bearer secret)
// could otherwise supply a real, valid operation belonging to a DIFFERENT Cloud Run Job
// in the same project/region and read its status through this endpoint. This proves
// that same-project/different-job case is caught by the post-lookup correlation against
// the resulting Execution's own name (which DOES encode its Job), and that no state or
// artifact details leak into the rejection response.
test("buildStatusResponse: an Execution belonging to a different Job in the same project/region is rejected, no details leaked", async () => {
  const result = await buildStatusResponse({
    jobId: VALID_JOB_ID, operationName: VALID_OPERATION_NAME,
    project: PROJECT, region: REGION, jobName: JOB_NAME,
    artifactExists: true, probeReport: PASSING_PROBE,
    checkRunJobProgress: async () => ({
      done: true,
      metadata: { name: `projects/${PROJECT}/locations/${REGION}/jobs/some-other-job/executions/some-other-job-xyz` },
      result: { succeededCount: 1 }
    })
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.state, undefined, "a rejected cross-job lookup must not report a state");
  assert.equal(result.body.artifactExists, undefined, "a rejected cross-job lookup must not report artifact facts");
});

// Reject-by-default: if a resolved operation can't be attached to ANY execution name at
// all, treat it the same as a failed correlation rather than assuming it's ours.
// Empirically this session's own dryRun submission already had the execution name
// populated immediately, so a legitimately-ours operation should never hit this path.
test("buildStatusResponse: an operation that resolves with no execution name at all is rejected, not trusted", async () => {
  const result = await buildStatusResponse({
    jobId: VALID_JOB_ID, operationName: VALID_OPERATION_NAME,
    project: PROJECT, region: REGION, jobName: JOB_NAME,
    artifactExists: false, probeReport: null,
    checkRunJobProgress: async () => ({ done: true, metadata: {}, result: { succeededCount: 1 } })
  });
  assert.equal(result.status, 400);
});
