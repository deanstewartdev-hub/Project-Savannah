import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { postCallbackWithRetry, isRetryableCallbackError } from "../src/lib/callback.js";

// Callback delivery used to be a single attempt: a busy bridge lock, an Apps Script
// 5xx/429 or a network blip lost the callback and left the render needing manual
// delivery recovery. These tests drive postCallbackWithRetry() against a real local
// HTTP server with scripted responses, and an injected sleep so no real time passes.

const SECRET = "c0ffee-DO-NOT-LEAK-RETRY-SECRET";

async function withServer(responses, run) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      seen.push(body);
      const next = responses[Math.min(seen.length - 1, responses.length - 1)];
      res.writeHead(next.status || 200, { "Content-Type": next.type || "application/json" });
      res.end(typeof next.body === "string" ? next.body : JSON.stringify(next.body));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/exec?route=media-worker-callback&secret=${SECRET}`;
  try {
    return await run(url, seen);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function recorder() {
  const slept = [];
  const logs = [];
  return { slept, logs, options: { sleep: async (ms) => { slept.push(ms); }, log: (m) => logs.push(m), delaysMs: [5, 10, 20] } };
}

const payload = { jobId: "cr-retry", status: "completed", video: { url: "https://example.test/v.mp4" } };

test("succeeds first time without sleeping", async () => {
  const r = recorder();
  await withServer([{ body: { success: true, queued: true } }], async (url, seen) => {
    await postCallbackWithRetry(url, payload, r.options);
    assert.equal(seen.length, 1);
    assert.deepEqual(r.slept, []);
  });
});

test("retries a busy bridge lock, then succeeds with the same payload", async () => {
  const r = recorder();
  await withServer([
    { body: { success: false, error: "Render callback is busy; retry." } },
    { body: { success: true, queued: true } }
  ], async (url, seen) => {
    await postCallbackWithRetry(url, payload, r.options);
    assert.equal(seen.length, 2);
    assert.deepEqual(JSON.parse(seen[1]), payload, "Retry must resend the identical payload.");
    assert.deepEqual(r.slept, [5]);
  });
});

test("retries HTTP 503 and 429, and an Apps Script HTML error page", async () => {
  const r = recorder();
  await withServer([
    { status: 503, body: "Service Unavailable", type: "text/plain" },
    { status: 429, body: "Too Many Requests", type: "text/plain" },
    { body: "<html>Service invoked too many times</html>", type: "text/html" },
    { body: { success: true } }
  ], async (url, seen) => {
    await postCallbackWithRetry(url, payload, r.options);
    assert.equal(seen.length, 4);
    assert.deepEqual(r.slept, [5, 10, 20]);
  });
});

test("retries a legacy 'Render job was not found' (callback before persistence)", async () => {
  const r = recorder();
  await withServer([
    { body: { success: false, error: "Render job was not found." } },
    { body: { success: true } }
  ], async (url, seen) => {
    await postCallbackWithRetry(url, payload, r.options);
    assert.equal(seen.length, 2);
  });
});

for (const rejection of ["Unauthorized.", "Malformed render ID.", "Unknown or missing status.", "A jobId is required."]) {
  test(`does not retry a permanent rejection: ${rejection}`, async () => {
    const r = recorder();
    await withServer([{ body: { success: false, error: rejection } }], async (url, seen) => {
      await assert.rejects(() => postCallbackWithRetry(url, payload, r.options), /was not accepted/);
      assert.equal(seen.length, 1);
      assert.deepEqual(r.slept, []);
    });
  });
}

test("does not retry HTTP 404 or 401", async () => {
  for (const status of [404, 401]) {
    const r = recorder();
    await withServer([{ status, body: "nope", type: "text/plain" }], async (url, seen) => {
      await assert.rejects(() => postCallbackWithRetry(url, payload, r.options), new RegExp(`\\(${status}\\)`));
      assert.equal(seen.length, 1);
    });
  }
});

test("gives up after the bounded number of attempts and throws the last error", async () => {
  const r = recorder();
  await withServer([{ status: 500, body: "boom", type: "text/plain" }], async (url, seen) => {
    await assert.rejects(() => postCallbackWithRetry(url, payload, r.options), /\(500\)/);
    assert.equal(seen.length, 4, "Expected 1 attempt plus 3 retries.");
    assert.deepEqual(r.slept, [5, 10, 20]);
  });
});

test("retries a network failure (nothing listening)", async () => {
  const r = recorder();
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  await assert.rejects(
    () => postCallbackWithRetry(`http://127.0.0.1:${port}/exec?secret=${SECRET}`, payload, r.options),
    /could not be sent/
  );
  assert.deepEqual(r.slept, [5, 10, 20]);
});

test("retry logs and thrown errors never contain the callback secret", async () => {
  const r = recorder();
  await withServer([{ status: 502, body: `bad gateway secret=${SECRET}`, type: "text/plain" }], async (url) => {
    const error = await postCallbackWithRetry(url, payload, r.options).catch((e) => e);
    assert.ok(error instanceof Error);
    assert.equal(error.message.includes(SECRET), false);
    assert.equal(r.logs.length, 3);
    for (const line of r.logs) assert.equal(line.includes(SECRET), false, "Secret leaked into a retry log line.");
  });
});

test("classifier: unknown errors are retryable, tagged permanent ones are not", () => {
  assert.equal(isRetryableCallbackError(new Error("socket hang up")), true);
  assert.equal(isRetryableCallbackError(Object.assign(new Error("x"), { httpStatus: 400 })), false);
  assert.equal(isRetryableCallbackError(Object.assign(new Error("x"), { httpStatus: 502 })), true);
  assert.equal(isRetryableCallbackError(Object.assign(new Error("x"), { rejection: "Callback processing failed." })), true);
  assert.equal(isRetryableCallbackError(Object.assign(new Error("x"), { rejection: "Unauthorized." })), false);
  assert.equal(isRetryableCallbackError(null), false);
  // Contract with Production/MediaWorkerCallback_Service.js: a completed callback without
  // a deliverable video can never succeed on resend.
  assert.equal(isRetryableCallbackError(Object.assign(new Error("x"), { rejection: "Malformed callback: completed without an https video URL." })), false);
});
