import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import OpenAI from "openai";

// config.js reads secrets at import time. Test-only values. Every OpenAI request in this file goes to a local
// server, so no paid image is generated.
for (const name of ["JOB_SUBMIT_SECRET", "OPENAI_API_KEY", "ELEVENLABS_API_KEY", "PEXELS_API_KEY"]) {
  process.env[name] ??= randomBytes(32).toString("hex");
}
process.env.ELEVENLABS_VOICE_ID ??= "test-voice";
process.env.GCS_BUCKET ??= "test-bucket";
const { generateStillWithClient, IMAGE_REQUEST_OPTIONS } = await import("../src/pipeline/visuals.js");

// A local server that fails every request with a retryable server error, and counts the requests it receives.
function startFailingServer(respond) {
  let count = 0;
  const server = http.createServer((req, res) => {
    count += 1;
    respond(res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        baseURL: `http://127.0.0.1:${port}/v1`,
        requests: () => count,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

const serverError = (res) => {
  res.writeHead(500, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { message: "server error", type: "server_error" } }));
};

test("the image request options turn automatic retries off", () => {
  assert.equal(IMAGE_REQUEST_OPTIONS.maxRetries, 0);
  assert.equal(Object.isFrozen(IMAGE_REQUEST_OPTIONS), true);
});

test("control: a client with default settings retries a failing request (proves the test would catch a retry)", async () => {
  const srv = await startFailingServer(serverError);
  try {
    const client = new OpenAI({ apiKey: "test-key", baseURL: srv.baseURL, timeout: 10000 });
    await assert.rejects(client.images.generate({ model: "gpt-image-2", prompt: "x", size: "1024x1536" }));
    assert.equal(srv.requests(), 3, "the default client should make one attempt plus two retries");
  } finally {
    await srv.close();
  }
});

test("an AI still request makes exactly one attempt when the server fails, with no automatic retry", async () => {
  const srv = await startFailingServer(serverError);
  const dir = mkdtempSync(path.join(os.tmpdir(), "still-noretry-"));
  try {
    const client = new OpenAI({ apiKey: "test-key", baseURL: srv.baseURL, timeout: 10000 });
    await assert.rejects(generateStillWithClient(client, "a canyon", path.join(dir, "still.png")));
    assert.equal(srv.requests(), 1, "an image request must not be retried automatically");
  } finally {
    await srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a successful still is written to the file it was asked to write", async () => {
  const png = Buffer.from("fake-png-bytes");
  const srv = await startFailingServer((res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ created: 1, data: [{ b64_json: png.toString("base64") }] }));
  });
  const dir = mkdtempSync(path.join(os.tmpdir(), "still-ok-"));
  try {
    const client = new OpenAI({ apiKey: "test-key", baseURL: srv.baseURL, timeout: 10000 });
    const out = path.join(dir, "still.png");
    await generateStillWithClient(client, "a canyon", out);
    assert.equal(srv.requests(), 1);
    assert.equal(readFileSync(out).toString(), png.toString());
  } finally {
    await srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
