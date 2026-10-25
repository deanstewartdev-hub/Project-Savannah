import test from "node:test";
import assert from "node:assert/strict";
import { requireAuth } from "../src/lib/auth.js";
import { optionalSecretEnv, requireSecretEnv } from "../src/lib/secretFormat.js";

// SAV-13: POST /jobs must never become unauthenticated because JOB_SUBMIT_SECRET is
// missing. Two layers are tested here: requireSecretEnv (config.js/dispatcherConfig.js
// must refuse to load with a missing/empty secret) and requireAuth itself (must fail
// closed - reject every request - even if it were ever somehow constructed with a
// falsy secret anyway).

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

const ENV_VAR = "JOB_SUBMIT_SECRET_TEST_VAR";

test("1. missing JOB_SUBMIT_SECRET fails", () => {
  delete process.env[ENV_VAR];
  assert.throws(() => requireSecretEnv(ENV_VAR), /Missing required environment variable: JOB_SUBMIT_SECRET_TEST_VAR/);
});

test("2. empty JOB_SUBMIT_SECRET fails", () => {
  process.env[ENV_VAR] = "";
  try {
    assert.throws(() => requireSecretEnv(ENV_VAR), /Missing required environment variable/);
  } finally {
    delete process.env[ENV_VAR];
  }
});

test("3. a valid secret passes", () => {
  process.env[ENV_VAR] = "a-clean-shared-secret-value";
  try {
    assert.equal(requireSecretEnv(ENV_VAR), "a-clean-shared-secret-value");
  } finally {
    delete process.env[ENV_VAR];
  }
});

test("4. missing Authorization header -> 401", () => {
  const { req, res, next, result } = fakeReqRes({});
  requireAuth("secret-value")(req, res, next);
  const r = result();
  assert.equal(r.statusCode, 401);
  assert.equal(r.jsonBody.error, "Unauthorized");
  assert.equal(r.nextCalled, false);
});

test("5. incorrect bearer -> 401", () => {
  const { req, res, next, result } = fakeReqRes({ authorization: "Bearer wrong-value" });
  requireAuth("secret-value")(req, res, next);
  const r = result();
  assert.equal(r.statusCode, 401);
  assert.equal(r.nextCalled, false);
});

test("6. valid bearer -> next()", () => {
  const { req, res, next, result } = fakeReqRes({ authorization: "Bearer secret-value" });
  requireAuth("secret-value")(req, res, next);
  const r = result();
  assert.equal(r.nextCalled, true);
  assert.equal(r.statusCode, null);
});

test("6b. requireAuth fails closed when constructed with an empty secret (defense in depth)", () => {
  const withoutHeader = fakeReqRes({});
  requireAuth("")(withoutHeader.req, withoutHeader.res, withoutHeader.next);
  assert.equal(withoutHeader.result().statusCode, 401);
  assert.equal(withoutHeader.result().nextCalled, false);

  // Even a request that supplies SOME bearer token must still be rejected - there is
  // no secret to check it against, so "no secret configured" must never become "any
  // token is accepted".
  const withHeader = fakeReqRes({ authorization: "Bearer anything-at-all" });
  requireAuth("")(withHeader.req, withHeader.res, withHeader.next);
  assert.equal(withHeader.result().statusCode, 401);
  assert.equal(withHeader.result().nextCalled, false);
});

test("7. errors do not contain the secret value", () => {
  const realSecret = "sk-shared-DO-NOT-LEAK-THIS-SECRET";
  const { req, res, next } = fakeReqRes({ authorization: "Bearer wrong-guess" });
  requireAuth(realSecret)(req, res, next);
  const jsonString = JSON.stringify(res);
  assert.equal(jsonString.includes(realSecret), false, "requireAuth's 401 response must not echo the configured secret");

  try {
    requireSecretEnv("JOB_SUBMIT_SECRET_DOES_NOT_EXIST_ANYWHERE");
    assert.fail("expected requireSecretEnv to throw");
  } catch (error) {
    assert.equal(error.message.includes(realSecret), false);
  }
});

// Zero-downtime JOB_SUBMIT_SECRET rotation: the dispatcher accepts [current, previous]
// while JOB_SUBMIT_SECRET_PREVIOUS is set, so Apps Script can be switched over after the
// new value is live without any request being rejected in between.
function authResult(secrets, header) {
  const { req, res, next, result } = fakeReqRes(header === undefined ? {} : { authorization: header });
  requireAuth(secrets)(req, res, next);
  return result();
}

test("8. rotation overlap: both the current and the previous secret are accepted", () => {
  assert.equal(authResult(["new-secret-value", "old-secret-value"], "Bearer new-secret-value").nextCalled, true);
  assert.equal(authResult(["new-secret-value", "old-secret-value"], "Bearer old-secret-value").nextCalled, true);
  assert.equal(authResult(["new-secret-value", "old-secret-value"], "Bearer other-value").statusCode, 401);
});

test("9. outside a rotation (previous unset) only the current secret is accepted", () => {
  assert.equal(authResult(["new-secret-value", null], "Bearer new-secret-value").nextCalled, true);
  const r = authResult(["new-secret-value", null], "Bearer old-secret-value");
  assert.equal(r.statusCode, 401);
  assert.equal(r.nextCalled, false);
});

test("10. a list with no usable secret still fails closed, even for an empty bearer", () => {
  for (const secrets of [[], [null, null], ["", undefined]]) {
    assert.equal(authResult(secrets, "Bearer ").statusCode, 401);
    assert.equal(authResult(secrets, "Bearer anything").nextCalled, false);
    assert.equal(authResult(secrets).statusCode, 401);
  }
});

test("11. prefixes, case changes and non-Bearer schemes of a valid secret are rejected", () => {
  for (const header of ["Bearer new-secret-valu", "Bearer new-secret-value2", "Bearer NEW-SECRET-VALUE", "Basic new-secret-value", "new-secret-value"]) {
    assert.equal(authResult(["new-secret-value", "old-secret-value"], header).nextCalled, false, header);
  }
});

test("12. JOB_SUBMIT_SECRET_PREVIOUS is optional but must be well-formed when present", () => {
  const name = "JOB_SUBMIT_SECRET_PREVIOUS_TEST_VAR";
  try {
    delete process.env[name];
    assert.equal(optionalSecretEnv(name), null);
    process.env[name] = "";
    assert.equal(optionalSecretEnv(name), null);
    process.env[name] = "a-clean-previous-value";
    assert.equal(optionalSecretEnv(name), "a-clean-previous-value");
    process.env[name] = "SECRET-WITH-NEWLINE\n";
    assert.throws(() => optionalSecretEnv(name), (error) => /embedded LF/.test(error.message) && !error.message.includes("SECRET-WITH-NEWLINE"));
  } finally {
    delete process.env[name];
  }
});
