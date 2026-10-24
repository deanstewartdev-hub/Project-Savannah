import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Railway is retired. Storage must authenticate only as the attached Cloud Run service
// account (ADC); a leftover inline-key setting must stop the process instead of being
// silently used. Each case imports the real module in a fresh process with a controlled env.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const storageUrl = new URL("../src/lib/storage.js", import.meta.url).href;

function importStorage(extraEnv) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(storageUrl)}); console.log("loaded");`], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...extraEnv },
    encoding: "utf8",
    timeout: 30000
  });
}

test("storage loads with only GCS_BUCKET set (Application Default Credentials, no key)", () => {
  const result = importStorage({ GCS_BUCKET: "test-bucket" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /loaded/);
});

test("storage refuses a leftover GOOGLE_APPLICATION_CREDENTIALS_B64 inline key", () => {
  const fakeKey = Buffer.from(JSON.stringify({ type: "service_account", private_key: "FAKE-NOT-A-KEY" })).toString("base64");
  const result = importStorage({ GCS_BUCKET: "test-bucket", GOOGLE_APPLICATION_CREDENTIALS_B64: fakeKey });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /GOOGLE_APPLICATION_CREDENTIALS_B64 is no longer supported/);
  assert.equal(result.stderr.includes(fakeKey), false, "the key value must never be echoed");
  assert.equal(result.stderr.includes("FAKE-NOT-A-KEY"), false);
});

test("no source file constructs Storage with inline credentials, and the Railway config is gone", () => {
  const storageSource = readFileSync(path.join(root, "src/lib/storage.js"), "utf8");
  assert.doesNotMatch(storageSource, /new Storage\(\s*\{[^)]*credentials/);
  assert.doesNotMatch(readFileSync(path.join(root, "src/config.js"), "utf8"), /gcsCredentialsJson/);
  assert.equal(existsSync(path.join(root, "railway.json")), false);
});
