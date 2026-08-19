import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { assertSecretFormat } from "../src/lib/secretFormat.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLEAN_TOKEN = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789";

test("1. a clean token passes", () => {
  assert.doesNotThrow(() => assertSecretFormat("OPENAI_API_KEY", CLEAN_TOKEN));
});

test("2. a trailing LF fails", () => {
  assert.throws(() => assertSecretFormat("OPENAI_API_KEY", CLEAN_TOKEN + "\n"), /LF/);
});

test("3. a trailing CRLF fails", () => {
  assert.throws(() => assertSecretFormat("OPENAI_API_KEY", CLEAN_TOKEN + "\r\n"), /CR/);
});

test("4. leading whitespace fails", () => {
  assert.throws(() => assertSecretFormat("OPENAI_API_KEY", " " + CLEAN_TOKEN), /leading whitespace/);
});

test("5. trailing space fails", () => {
  assert.throws(() => assertSecretFormat("OPENAI_API_KEY", CLEAN_TOKEN + " "), /trailing whitespace/);
});

test("6. an embedded TAB or control character fails", () => {
  assert.throws(() => assertSecretFormat("OPENAI_API_KEY", "sk-proj-abc\tdef"), /TAB/);
  assert.throws(() => assertSecretFormat("OPENAI_API_KEY", "sk-proj-abc\x01def"), /control character/);
});

test("7. the safe error includes the variable name", () => {
  assert.throws(() => assertSecretFormat("PEXELS_API_KEY", CLEAN_TOKEN + "\n"), /PEXELS_API_KEY/);
});

test("8. the safe error never includes the credential value", () => {
  const secretValue = "sk-proj-SUPER-SECRET-DO-NOT-LEAK-THIS-VALUE";
  try {
    assertSecretFormat("OPENAI_API_KEY", secretValue + "\n");
    assert.fail("expected assertSecretFormat to throw");
  } catch (error) {
    assert.equal(error.message.includes(secretValue), false, "error message must not contain the credential value");
    assert.equal(error.message.includes("SUPER-SECRET"), false, "error message must not contain any substring of the credential");
  }
});

test("9. normal non-secret config fields are not run through this validator", () => {
  // Scope check: assertSecretFormat/requiredSecret/optionalSecret must be wired only
  // to the security-sensitive token fields, never to identifiers, paths, or numbers -
  // checked from source rather than by importing config.js, since that module throws
  // at import time unless every required env var is already set in this process.
  const configSource = readFileSync(join(__dirname, "..", "src", "config.js"), "utf8");
  const dispatcherConfigSource = readFileSync(join(__dirname, "..", "src", "dispatcherConfig.js"), "utf8");

  const mustBeValidated = ["OPENAI_API_KEY", "ELEVENLABS_API_KEY", "PEXELS_API_KEY", "JOB_SUBMIT_SECRET"];
  mustBeValidated.forEach((name) => {
    const inConfig = configSource.includes(`requiredSecret("${name}")`) || configSource.includes(`optionalSecret("${name}")`);
    const inDispatcherConfig = dispatcherConfigSource.includes(`optionalSecret("${name}")`);
    assert.equal(
      inConfig || inDispatcherConfig,
      true,
      `${name} must be loaded through requiredSecret/optionalSecret in config.js or dispatcherConfig.js`
    );
  });

  const mustNotBeValidated = ["PORT", "GCS_BUCKET", "ELEVENLABS_VOICE_ID", "DEFAULT_MUSIC_TRACK_PATH", "CLOUD_RUN_PROJECT", "CLOUD_RUN_REGION", "RENDER_JOB_NAME"];
  mustNotBeValidated.forEach((name) => {
    const inConfig = configSource.includes(`requiredSecret("${name}")`) || configSource.includes(`optionalSecret("${name}")`);
    const inDispatcherConfig = dispatcherConfigSource.includes(`requiredSecret("${name}")`) || dispatcherConfigSource.includes(`optionalSecret("${name}")`);
    assert.equal(inConfig || inDispatcherConfig, false, `${name} is not a credential and must not be run through the secret-format validator`);
  });
});

test("additional: an empty value fails explicitly rather than being silently accepted", () => {
  assert.throws(() => assertSecretFormat("OPENAI_API_KEY", ""), /empty/);
});

test("additional: a non-string value fails explicitly", () => {
  assert.throws(() => assertSecretFormat("OPENAI_API_KEY", undefined), /must be a string/);
});
