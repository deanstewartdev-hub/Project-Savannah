import test from "node:test";
import assert from "node:assert/strict";
import { postCallback, postCallbackWithRetry } from "../src/lib/callback.js";

// The callback secret moves out of the callback URL and into the JSON body as
// `callbackSecret`. These tests pin that: the URL the worker posts to never carries the
// secret, the body does when one is supplied, and a request without one is sent unchanged
// so renders submitted before this change keep working.

const SYNTHETIC_SECRET = "f2c1a9e0-DO-NOT-LEAK-BODY-SYNTHETIC-SECRET";
const URL_WITHOUT_SECRET = "https://script.google.com/macros/s/fake-deployment-id/exec?route=media-worker-callback";
const PAYLOAD = { jobId: "cr-c68c66f5-b646-4c1c-a88a-8748c5c0f1d9", status: "failed", error: { message: "boom" } };

function recordingFetch(responses) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const next = responses.shift() || { ok: true, status: 200, text: '{"success":true}' };
    return { ok: next.ok ?? true, status: next.status ?? 200, text: async () => next.text ?? '{"success":true}' };
  };
  return { calls, restore: () => { globalThis.fetch = originalFetch; } };
}

test("1. with a secret, the secret is in the JSON body and never in the URL", async () => {
  const fake = recordingFetch([]);
  try {
    await postCallback(URL_WITHOUT_SECRET, PAYLOAD, SYNTHETIC_SECRET);
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0].url, URL_WITHOUT_SECRET);
    assert.ok(!fake.calls[0].url.includes(SYNTHETIC_SECRET), "the secret must not appear in the URL");
    assert.equal(fake.calls[0].body.callbackSecret, SYNTHETIC_SECRET);
    assert.equal(fake.calls[0].body.jobId, PAYLOAD.jobId);
  } finally {
    fake.restore();
  }
});

test("2. without a secret, the body is exactly the payload (back-compatible with URL-secret renders)", async () => {
  const fake = recordingFetch([]);
  try {
    await postCallback(URL_WITHOUT_SECRET, PAYLOAD);
    assert.deepEqual(fake.calls[0].body, PAYLOAD);
    assert.equal("callbackSecret" in fake.calls[0].body, false);
  } finally {
    fake.restore();
  }
});

test("3. the retry path carries the secret into every attempt", async () => {
  const fake = recordingFetch([
    { ok: false, status: 503, text: "temporarily unavailable" },
    { ok: true, status: 200, text: '{"success":true}' }
  ]);
  try {
    await postCallbackWithRetry(URL_WITHOUT_SECRET, PAYLOAD, {
      callbackSecret: SYNTHETIC_SECRET,
      delaysMs: [0],
      sleep: async () => {},
      log: () => {}
    });
    assert.equal(fake.calls.length, 2);
    for (const call of fake.calls) {
      assert.equal(call.body.callbackSecret, SYNTHETIC_SECRET);
      assert.ok(!call.url.includes(SYNTHETIC_SECRET));
    }
  } finally {
    fake.restore();
  }
});

test("4. a failure never leaks the secret into the thrown error", async () => {
  const fake = recordingFetch([{ ok: false, status: 401, text: '{"success":false,"error":"Unauthorized."}' }]);
  try {
    await assert.rejects(
      postCallback(URL_WITHOUT_SECRET, PAYLOAD, SYNTHETIC_SECRET),
      (error) => {
        assert.ok(!String(error.message).includes(SYNTHETIC_SECRET), "the thrown message must not contain the secret");
        return true;
      }
    );
  } finally {
    fake.restore();
  }
});
