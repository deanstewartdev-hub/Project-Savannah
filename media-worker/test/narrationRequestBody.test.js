import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

// config.js reads secrets at import time. Give it random, test-only values (no paid call is made here).
for (const name of ["JOB_SUBMIT_SECRET", "OPENAI_API_KEY", "ELEVENLABS_API_KEY", "PEXELS_API_KEY"]) {
  process.env[name] ??= randomBytes(32).toString("hex");
}
process.env.ELEVENLABS_VOICE_ID ??= "test-voice";
process.env.GCS_BUCKET ??= "test-bucket";
const { narrationRequestBody } = await import("../src/pipeline/narration.js");

// The request production has always sent. The defaults must reproduce it exactly.
const PREVIOUS_BODY = {
  text: "A test passage.",
  model_id: "eleven_multilingual_v2",
  voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true }
};

test("with the default configuration the request is byte-for-byte what production has always sent", () => {
  const body = narrationRequestBody("A test passage.", {
    modelId: "eleven_multilingual_v2",
    stability: 0.5,
    similarityBoost: 0.75,
    style: 0.3,
    useSpeakerBoost: true
  });
  assert.equal(JSON.stringify(body), JSON.stringify(PREVIOUS_BODY));
});

test("the model and voice settings come from configuration, so a voice or model change needs no code edit", () => {
  const body = narrationRequestBody("A test passage.", {
    modelId: "some_other_model",
    stability: 0.6,
    similarityBoost: 0.8,
    style: 0,
    useSpeakerBoost: false
  });
  assert.equal(body.model_id, "some_other_model");
  assert.deepEqual(body.voice_settings, { stability: 0.6, similarity_boost: 0.8, style: 0, use_speaker_boost: false });
  assert.equal(body.text, "A test passage.");
});

test("the default configuration loaded at start-up matches the previous request", async () => {
  const { config } = await import("../src/config.js");
  assert.equal(config.narration.modelId, "eleven_multilingual_v2");
  assert.equal(config.narration.stability, 0.5);
  assert.equal(config.narration.similarityBoost, 0.75);
  assert.equal(config.narration.style, 0.3);
  assert.equal(config.narration.useSpeakerBoost, true);
});
