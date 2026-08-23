import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { postCallback } from "../src/lib/callback.js";

// SAV-17: Apps Script's ContentService answers a real doPost() with a 302 redirect to a
// one-time script.googleusercontent.com/macros/echo?... URL that must be re-fetched with
// GET to obtain the already-computed JSON result - the POST body is only consumed on the
// first hop. This proves the REAL global fetch used by postCallback() (no mocking) follows
// that exact POST -> 302 -> GET -> JSON shape, against a real local HTTP server.

const SYNTHETIC_SECRET = "9f2c6a1e-DO-NOT-LEAK-THIS-SYNTHETIC-SECRET";

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

test("SAV-17.1 postCallback follows a real POST -> 302 -> GET redirect and resolves on {success:true}", async () => {
  const observed = { endpointAMethod: null, endpointABody: null, endpointBMethod: null };

  const serverB = await startServer((req, res) => {
    observed.endpointBMethod = req.method;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true }));
  });
  const portB = serverB.address().port;

  const serverA = await startServer(async (req, res) => {
    observed.endpointAMethod = req.method;
    observed.endpointABody = await readBody(req);
    res.writeHead(302, { Location: `http://127.0.0.1:${portB}/b` });
    res.end();
  });
  const portA = serverA.address().port;

  try {
    const payload = { jobId: "cr-redirect-test-positive", status: "completed" };
    const callbackUrl = `http://127.0.0.1:${portA}/a?route=media-worker-callback&secret=${SYNTHETIC_SECRET}`;

    await postCallback(callbackUrl, payload);

    assert.equal(observed.endpointAMethod, "POST", "Endpoint A must receive the initial POST");
    assert.deepEqual(JSON.parse(observed.endpointABody), payload, "Endpoint A must receive the exact JSON payload");
    assert.equal(observed.endpointBMethod, "GET", "the redirected resource must be fetched with GET, matching Apps Script's echo proxy");
  } finally {
    await stopServer(serverA);
    await stopServer(serverB);
  }
});

test("SAV-17.2 postCallback follows the same redirect and rejects sanitized on {success:false}", async () => {
  const observed = { endpointBMethod: null };

  const serverB = await startServer((req, res) => {
    observed.endpointBMethod = req.method;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: "synthetic rejection" }));
  });
  const portB = serverB.address().port;

  const serverA = await startServer(async (req, res) => {
    await readBody(req);
    res.writeHead(302, { Location: `http://127.0.0.1:${portB}/b` });
    res.end();
  });
  const portA = serverA.address().port;

  try {
    const payload = { jobId: "cr-redirect-test-negative", status: "completed" };
    const callbackUrl = `http://127.0.0.1:${portA}/a?route=media-worker-callback&secret=${SYNTHETIC_SECRET}`;

    await assert.rejects(
      () => postCallback(callbackUrl, payload),
      (error) => {
        assert.match(error.message, /was not accepted/);
        assert.match(error.message, /synthetic rejection/);
        assert.equal(error.message.includes(SYNTHETIC_SECRET), false, "must not leak the secret value");
        assert.match(error.message, /secret=<redacted>/, "must still identify the callback URL, secret redacted");
        return true;
      }
    );
    assert.equal(observed.endpointBMethod, "GET", "the redirected resource must still be fetched with GET on the rejection path");
  } finally {
    await stopServer(serverA);
    await stopServer(serverB);
  }
});
