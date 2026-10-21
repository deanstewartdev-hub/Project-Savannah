import test from "node:test";
import assert from "node:assert/strict";
import { requireAuth } from "../src/lib/auth.js";
import { requireSecretEnv } from "../src/lib/secretFormat.js";

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
