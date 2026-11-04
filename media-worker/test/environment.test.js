import { test } from "node:test";
import assert from "node:assert/strict";
import { assertEnvironment, callbackAllowed, environmentOf } from "../src/lib/environment.js";

// A complete, valid staging environment. Each test changes one thing, so the refusal it names is the only one.
const STAGING = Object.freeze({
  SAVANNAH_ENVIRONMENT: "staging",
  CLOUD_RUN_PROJECT: "savannah-staging-worker",
  GCS_BUCKET: "savannah-staging-media",
  CALLBACK_URL_ALLOWLIST: "https://script.google.com/macros/s/STAGING/exec"
});
const with_ = (changes) => Object.assign({}, STAGING, changes);

test("production needs no environment settings and keeps the existing behaviour", () => {
  assert.deepEqual(assertEnvironment({ CLOUD_RUN_PROJECT: "savannah-media-worker", GCS_BUCKET: "savannah-media" }), {
    environment: "production", callbackAllowlist: []
  });
  assert.equal(environmentOf({}), "production");
});

test("production refuses a staging manifest, so a staging track cannot reach production", () => {
  assert.throws(() => assertEnvironment({ MUSIC_MANIFEST_PATH: "music/staging-manifest.json" }), /must use the verified manifest/);
});

test("a complete staging environment is accepted with its callback allowlist", () => {
  const result = assertEnvironment(STAGING);
  assert.equal(result.environment, "staging");
  assert.deepEqual(result.callbackAllowlist, ["https://script.google.com/macros/s/STAGING/exec"]);
});

test("staging refuses a project name that does not say staging", () => {
  assert.throws(() => assertEnvironment(with_({ CLOUD_RUN_PROJECT: "savannah-media-worker" })), /CLOUD_RUN_PROJECT/);
});

test("staging refuses a bucket name that does not say staging, so it cannot read production media", () => {
  assert.throws(() => assertEnvironment(with_({ GCS_BUCKET: "savannah-media" })), /GCS_BUCKET/);
});

test("staging refuses to start without an explicit callback allowlist", () => {
  assert.throws(() => assertEnvironment(with_({ CALLBACK_URL_ALLOWLIST: "" })), /CALLBACK_URL_ALLOWLIST/);
});

test("staging refuses every paid AI key, so no paid service can be called from it", () => {
  for (const name of ["OPENAI_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "PEXELS_API_KEY"]) {
    assert.throws(() => assertEnvironment(with_({ [name]: "present" })), new RegExp(name), name);
  }
});

test("an unknown environment name is refused, so a typo cannot fall through to production", () => {
  assert.throws(() => environmentOf({ SAVANNAH_ENVIRONMENT: "stagging" }), /production or staging/);
});

test("a callback is allowed only to an endpoint on the allowlist, and an empty allowlist means no restriction", () => {
  const allowlist = ["https://script.google.com/macros/s/STAGING/exec"];
  assert.equal(callbackAllowed("https://script.google.com/macros/s/STAGING/exec?route=media-worker-callback", allowlist), true);
  assert.equal(callbackAllowed("https://script.google.com/macros/s/PRODUCTION/exec?route=media-worker-callback", allowlist), false);
  assert.equal(callbackAllowed("https://attacker.example/exec", allowlist), false);
  assert.equal(callbackAllowed("https://anything.example/exec", []), true);
});
