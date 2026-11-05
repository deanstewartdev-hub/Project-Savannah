import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { computeBeatTimings } from "../src/pipeline/beatTiming.js";

// Real ffmpeg integration test for the narration-completeness defect (Issue #29).
// Synthetic "speech" is tone bursts at exact word times, so the timing is known and the pipeline's own
// assembly and probe run end to end. No paid API is called: alignment is supplied directly.

// config.js requires several secrets at import time. Give this test random, test-only values.
for (const name of ["JOB_SUBMIT_SECRET", "OPENAI_API_KEY", "ELEVENLABS_API_KEY", "PEXELS_API_KEY"]) {
  process.env[name] ??= randomBytes(32).toString("hex");
}
process.env.ELEVENLABS_VOICE_ID ??= "test-voice";
process.env.GCS_BUCKET ??= "test-bucket";
const { assembleVideo } = await import("../src/pipeline/assemble.js");
const { ffprobe } = await import("../src/lib/ffmpeg.js");
const { probeVideo } = await import("../src/pipeline/probe.js");
const { assertNarrationComplete } = await import("../src/pipeline/narrationCompleteness.js");

const run = promisify(execFile);
const SAMPLE_RATE = 44100;

// Six beats of four words: 0.5 s per word, 0.15 s between words in a beat, a 2.4 s pause between beats,
// a 0.8 s lead-in and a 1.5 s tail.
function buildSyntheticSpeech() {
  const words = [];
  const beats = [];
  let t = 0.8;
  for (let b = 0; b < 6; b += 1) {
    const texts = [];
    for (let w = 0; w < 4; w += 1) {
      words.push({ word: ` w${b}${w}`, start: t, end: t + 0.5 });
      texts.push(`w${b}${w}`);
      t += 0.65;
    }
    beats.push({ text: texts.join(" ") });
    t += 2.4 - 0.15;
  }
  return { words, beats, totalSeconds: words[words.length - 1].end + 1.5 };
}

function wavBuffer(totalSeconds, toneWindows, { frequency = 330, amplitude = 0.4 } = {}) {
  const samples = Math.round(totalSeconds * SAMPLE_RATE);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    const time = i / SAMPLE_RATE;
    const on = toneWindows.some(([s, e]) => time >= s && time < e);
    const value = on ? Math.round(amplitude * 32767 * Math.sin(2 * Math.PI * frequency * time)) : 0;
    data.writeInt16LE(value, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function wavToMp3(dir, name, wav) {
  const wavPath = path.join(dir, `${name}.wav`);
  const mp3Path = path.join(dir, `${name}.mp3`);
  await writeFile(wavPath, wav);
  await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", wavPath, "-c:a", "libmp3lame", "-b:a", "128k", mp3Path]);
  return mp3Path;
}

async function still(dir, name, color) {
  const out = path.join(dir, `${name}.png`);
  await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${color}:s=1080x1920`, "-frames:v", "1", out]);
  return { type: "still", path: out };
}

const workDirFor = (dir) => ({ path: (...segments) => path.join(dir, ...segments) });

// Builds the synthetic narration, runs the real assembleVideo on it, and returns what the job would measure.
async function buildFinished(dir) {
  const speech = buildSyntheticSpeech();
  const windows = speech.words.map((w) => [w.start, w.end]);
  const narrationPath = await wavToMp3(dir, "narration", wavBuffer(speech.totalSeconds, windows));
  const musicPath = await wavToMp3(dir, "music", wavBuffer(45, [[0, 45]], { frequency: 220, amplitude: 0.05 }));
  const colors = ["0x3366cc", "0xcc6633", "0x33cc66", "0x993399", "0x339999", "0x999933"];
  const visuals = [];
  for (let i = 0; i < 6; i += 1) visuals.push(await still(dir, `beat${i}`, colors[i]));

  const narrationSeconds = Number((await ffprobe(narrationPath)).format.duration);
  const timedBeats = computeBeatTimings(speech.beats, speech.words);
  const result = await assembleVideo({ timedBeats, visuals, narrationPath, narrationSeconds, musicPath, workDir: workDirFor(dir) });
  return { speech, narrationSeconds, outPath: result.outPath };
}

test("narration is not cut off: the finished video and audio cover the whole narration, pauses included", { timeout: 300000 }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "narration-repro-"));
  try {
    const { narrationSeconds, outPath } = await buildFinished(dir);
    const finished = await ffprobe(outPath);
    const audio = finished.streams.find((s) => s.codec_type === "audio");
    const video = finished.streams.find((s) => s.codec_type === "video");
    const videoSeconds = Number(video.duration || finished.format.duration);
    const audioSeconds = Number(audio.duration || finished.format.duration);
    console.log(`narration ${narrationSeconds.toFixed(2)} s, video ${videoSeconds.toFixed(2)} s, audio ${audioSeconds.toFixed(2)} s`);
    assert.ok(videoSeconds >= narrationSeconds - 0.12, `video (${videoSeconds.toFixed(2)} s) ends before the narration (${narrationSeconds.toFixed(2)} s)`);
    assert.ok(audioSeconds >= narrationSeconds - 0.12, `audio (${audioSeconds.toFixed(2)} s) is cut before the narration (${narrationSeconds.toFixed(2)} s)`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the completeness gate, on the real probe, accepts the finished video and refuses a copy cut short", { timeout: 300000 }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "narration-gate-"));
  try {
    const { speech, narrationSeconds, outPath } = await buildFinished(dir);
    const alignedWords = speech.words.map((w) => ({ word: w.word, start: w.start, end: w.end }));
    const scriptWordCount = speech.beats.reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0);

    const probe = await probeVideo(outPath);
    assert.deepEqual(
      assertNarrationComplete({
        narrationSeconds,
        videoSeconds: probe.videoDurationSeconds ?? probe.durationSeconds,
        audioSeconds: probe.audioDurationSeconds,
        alignedWords,
        scriptWordCount
      }),
      { ok: true }
    );

    // The same video with its last ~14 s cut off, as the reported defect would leave it.
    const cutPath = path.join(dir, "cut.mp4");
    await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", outPath, "-t", "14.7", "-c", "copy", cutPath]);
    const cutProbe = await probeVideo(cutPath);
    assert.throws(
      () =>
        assertNarrationComplete({
          narrationSeconds,
          videoSeconds: cutProbe.videoDurationSeconds ?? cutProbe.durationSeconds,
          audioSeconds: cutProbe.audioDurationSeconds,
          alignedWords,
          scriptWordCount
        }),
      /shorter than the 29\.00 s narration/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
