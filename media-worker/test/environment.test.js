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

const STAGING_EXEC = "https://script.google.com/macros/s/STAGING/exec?route=media-worker-callback";

test("a callback is allowed only to the exact endpoint on the allowlist; an empty allowlist means no restriction", () => {
  const allowlist = [STAGING_EXEC];
  assert.equal(callbackAllowed(STAGING_EXEC, allowlist), true);
  assert.equal(callbackAllowed("https://script.google.com/macros/s/PRODUCTION/exec?route=media-worker-callback", allowlist), false);
  assert.equal(callbackAllowed("https://attacker.example/exec", allowlist), false);
  assert.equal(callbackAllowed("https://anything.example/exec", []), true);
});

test("deceptive hostnames are refused, because matching is exact and never a prefix", () => {
  const allowlist = [STAGING_EXEC];
  const deceptive = [
    "https://script.google.com.attacker.example/macros/s/STAGING/exec?route=media-worker-callback",
    "https://script.google.com.evil/macros/s/STAGING/exec?route=media-worker-callback",
    "https://evil-script.google.com/macros/s/STAGING/exec?route=media-worker-callback",
    "https://script.google.com@attacker.example/macros/s/STAGING/exec?route=media-worker-callback",
    "https://attacker.example/script.google.com/macros/s/STAGING/exec?route=media-worker-callback"
  ];
  for (const url of deceptive) assert.equal(callbackAllowed(url, allowlist), false, url);
});

test("path tricks are refused: dot segments, extended paths and a different deployment ID", () => {
  const allowlist = [STAGING_EXEC];
  const tricks = [
    "https://script.google.com/macros/s/STAGING/exec/../PRODUCTION/exec?route=media-worker-callback",
    "https://script.google.com/macros/s/STAGING/exec/extra?route=media-worker-callback",
    "https://script.google.com/macros/s/STAGING-OTHER/exec?route=media-worker-callback",
    "https://script.google.com/macros/s/STAGING/execute?route=media-worker-callback"
  ];
  for (const url of tricks) assert.equal(callbackAllowed(url, allowlist), false, url);
});

test("query, fragment, credential and scheme differences are refused", () => {
  const allowlist = [STAGING_EXEC];
  const differences = [
    "https://script.google.com/macros/s/STAGING/exec?route=other",
    "https://script.google.com/macros/s/STAGING/exec",
    "https://script.google.com/macros/s/STAGING/exec?route=media-worker-callback&extra=1",
    "https://script.google.com/macros/s/STAGING/exec?route=media-worker-callback#fragment",
    "https://user:secret@script.google.com/macros/s/STAGING/exec?route=media-worker-callback",
    "http://script.google.com/macros/s/STAGING/exec?route=media-worker-callback",
    "ftp://script.google.com/macros/s/STAGING/exec?route=media-worker-callback"
  ];
  for (const url of differences) assert.equal(callbackAllowed(url, allowlist), false, url);
});

test("malformed or unexpected input is refused", () => {
  const allowlist = [STAGING_EXEC];
  const malformed = [
    "", "   ", "not a url", "https://", "https://script.google.com/macros/s/STAGING/exec?route=media-worker-callback\n",
    "https://script.google.com\\macros\\s\\STAGING\\exec", "https://script.google.com/macros/s/STAGING/exec?route=media-worker-callback\u0000",
    undefined, null, 42, {}, ["https://script.google.com/macros/s/STAGING/exec?route=media-worker-callback"]
  ];
  for (const value of malformed) assert.equal(callbackAllowed(value, allowlist), false, String(value));
  assert.equal(callbackAllowed(STAGING_EXEC + "x".repeat(3000), allowlist), false, "over-long input is refused");
});

test("an equivalent spelling of the same endpoint is the same endpoint: case, default port and dot segments normalise", () => {
  const allowlist = [STAGING_EXEC];
  assert.equal(callbackAllowed("HTTPS://SCRIPT.GOOGLE.COM:443/macros/s/STAGING/exec?route=media-worker-callback", allowlist), true);
  // A dot segment that normalises to the same path is the same endpoint, so it is allowed; one that normalises to a
  // different path is a different endpoint, and is refused (see the path tricks test).
  assert.equal(callbackAllowed("https://script.google.com/macros/s/./STAGING/exec?route=media-worker-callback", allowlist), true);
});

test("an invalid allowlist entry is an error at startup, never a silent match", () => {
  assert.throws(() => assertEnvironment(with_({ CALLBACK_URL_ALLOWLIST: "https://script.google.com/a/b, http://example.com/exec" })),
    /must use https/);
  assert.throws(() => assertEnvironment(with_({ CALLBACK_URL_ALLOWLIST: "https://user:pw@script.google.com/exec" })), /credentials/);
  assert.throws(() => assertEnvironment(with_({ CALLBACK_URL_ALLOWLIST: "not a url" })), /whitespace|valid URL/);
  assert.throws(() => assertEnvironment({ CALLBACK_URL_ALLOWLIST: "https://script.google.com/exec#x" }), /fragment/);
});

test("the staging allowlist is canonicalised at startup, so a loose spelling in config still matches exactly", () => {
  const result = assertEnvironment(with_({ CALLBACK_URL_ALLOWLIST: "HTTPS://SCRIPT.GOOGLE.COM:443/macros/s/STAGING/exec?route=media-worker-callback" }));
  assert.deepEqual(result.callbackAllowlist, [STAGING_EXEC]);
  assert.equal(callbackAllowed(STAGING_EXEC, result.callbackAllowlist), true);
});

test("loopback http is accepted for local tests only", () => {
  assert.equal(callbackAllowed("http://127.0.0.1:18082/exec", ["http://127.0.0.1:18082/exec"]), true);
  assert.equal(callbackAllowed("http://example.com/exec", ["http://example.com/exec"]), false);
});
