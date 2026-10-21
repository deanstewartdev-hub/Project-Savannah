import test from "node:test";
import assert from "node:assert/strict";
import { postCallback } from "../src/lib/callback.js";
import { redactSecretParams } from "../src/lib/sanitize.js";

// SAV-14: the Apps Script callback URL carries the shared callback secret in its own
// query string (?route=media-worker-callback&secret=...). postCallback() must never let
// that raw URL - or the secret value in any other form - reach a thrown Error's message,
// since job-runner.js and routes/jobs.js both console.error() whatever it throws.

const SYNTHETIC_SECRET = "bd6325bf-DO-NOT-LEAK-THIS-SYNTHETIC-SECRET";
const CALLBACK_URL = `https://script.google.com/macros/s/fake-deployment-id/exec?route=media-worker-callback&secret=${SYNTHETIC_SECRET}`;

function withMockedFetch(responseFactory, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => responseFactory();
  return run().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

function fakeResponse({ ok, status, text }) {
  return { ok, status, text: async () => text };
}

test("1. a non-2xx callback response throws, and the thrown error is useful and secret-free", async () => {
  await withMockedFetch(
    () => fakeResponse({ ok: false, status: 500, text: "Apps Script internal error" }),
    async () => {
      await assert.rejects(
        () => postCallback(CALLBACK_URL, { jobId: "cr-test" }),
        (error) => {
          assert.match(error.message, /failed \(500\)/);
          assert.match(error.message, /Apps Script internal error/);
          assert.equal(error.message.includes(SYNTHETIC_SECRET), false, "must not contain the secret value");
          assert.equal(error.message.includes("secret=" + SYNTHETIC_SECRET), false, "must not contain secret=<value>");
          assert.match(error.message, /secret=<redacted>/, "must still identify this as the callback URL, with the secret redacted");
          return true;
        }
      );
    }
  );
});

test("2. a non-JSON callback response throws, and the thrown error is useful and secret-free", async () => {
  await withMockedFetch(
    () => fakeResponse({ ok: true, status: 200, text: "<html>not json</html>" }),
    async () => {
      await assert.rejects(
        () => postCallback(CALLBACK_URL, { jobId: "cr-test" }),
        (error) => {
          assert.match(error.message, /non-JSON response/);
          assert.equal(error.message.includes(SYNTHETIC_SECRET), false);
          assert.equal(error.message.includes("secret=" + SYNTHETIC_SECRET), false);
          return true;
        }
      );
    }
  );
});

test("3. a {success:false} callback response throws, and the thrown error is useful and secret-free", async () => {
  await withMockedFetch(
    () => fakeResponse({ ok: true, status: 200, text: JSON.stringify({ success: false, error: "Unauthorized callback" }) }),
    async () => {
      await assert.rejects(
        () => postCallback(CALLBACK_URL, { jobId: "cr-test" }),
        (error) => {
          assert.match(error.message, /was not accepted/);
          assert.match(error.message, /Unauthorized callback/);
          assert.equal(error.message.includes(SYNTHETIC_SECRET), false);
          assert.equal(error.message.includes("secret=" + SYNTHETIC_SECRET), false);
          return true;
        }
      );
    }
  );
});

test("4. thrown errors retain enough context for diagnosis (host/path/route, not just a generic message)", async () => {
  await withMockedFetch(
    () => fakeResponse({ ok: false, status: 403, text: "forbidden" }),
    async () => {
      await assert.rejects(() => postCallback(CALLBACK_URL, {}), (error) => {
        assert.match(error.message, /script\.google\.com/);
        assert.match(error.message, /route=media-worker-callback/);
        assert.match(error.message, /403/);
        return true;
      });
    }
  );
});

test("5 & 6. a network-level fetch failure also never leaks the secret", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error(`connect ECONNREFUSED while calling ${CALLBACK_URL}`);
  };
  try {
    await assert.rejects(() => postCallback(CALLBACK_URL, {}), (error) => {
      assert.equal(error.message.includes(SYNTHETIC_SECRET), false);
      assert.equal(error.message.includes("secret=" + SYNTHETIC_SECRET), false);
      assert.match(error.message, /secret=<redacted>/);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("7. redactSecretParams (shared by recover-delivery.js) redacts secret= query params", () => {
  assert.equal(
    redactSecretParams(`Callback to ${CALLBACK_URL} failed`),
    `Callback to https://script.google.com/macros/s/fake-deployment-id/exec?route=media-worker-callback&secret=<redacted> failed`
  );
  assert.equal(redactSecretParams(""), "");
  assert.equal(redactSecretParams(null), "");
  assert.equal(redactSecretParams("no secret here"), "no secret here");
});
