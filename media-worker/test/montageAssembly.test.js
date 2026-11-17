import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// config.js reads secrets at import time. Test-only values; nothing here calls a provider.
for (const name of ["JOB_SUBMIT_SECRET", "OPENAI_API_KEY", "ELEVENLABS_API_KEY", "PEXELS_API_KEY"]) {
  process.env[name] ??= randomBytes(32).toString("hex");
}
process.env.ELEVENLABS_VOICE_ID ??= "test-voice";
process.env.GCS_BUCKET ??= "test-bucket";
const { normalizeBeatClip } = await import("../src/pipeline/assemble.js");
const { segmentLengths } = await import("../src/pipeline/visualSelection.js");

// Real FFmpeg (free, local). Three solid-colour clips stand in for the three recap places: red, green, blue.
// Sampling the colour at each third of the output shows which clip played there, so order and equal shares are checked.
const dir = mkdtempSync(path.join(os.tmpdir(), "montage-asm-"));
const clip = (name, colour) => {
  const file = path.join(dir, name + ".mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=${colour}:s=540x960:d=9:r=30`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", file]);
  return { path: file, sourceDurationSeconds: 9 };
};

// The average colour of one frame, read as raw RGB from FFmpeg.
function colourAt(file, seconds) {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-ss", String(seconds), "-i", file, "-frames:v", "1",
    "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  return { r: raw[0], g: raw[1], b: raw[2] };
}

function dominant(c) {
  // FFmpeg's named colours are pure: red (255,0,0), green (0,128,0), blue (0,0,255). Allow for compression.
  if (c.r > 150 && c.g < 80 && c.b < 80) return "red";
  if (c.g > 100 && c.r < 60 && c.b < 60) return "green";
  if (c.b > 150 && c.r < 80 && c.g < 80) return "blue";
  return "other:" + JSON.stringify(c);
}

function durationOf(file) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  return Number(String(out).trim());
}

test("a montage of three clips renders to the timed length, in order, with equal thirds (real FFmpeg)", async () => {
  const red = clip("red", "red");
  const green = clip("green", "green");
  const blue = clip("blue", "blue");
  const total = 6.52;
  const out = path.join(dir, "montage.mp4");
  await normalizeBeatClip({ type: "video", segments: [red, green, blue] }, total, out);

  const duration = durationOf(out);
  assert.ok(Math.abs(duration - total) < 0.15, `rendered length ${duration.toFixed(2)} s is the timed ${total} s`);
  const third = total / 3;
  assert.equal(dominant(colourAt(out, third * 0.5)), "red", "first destination is the first clip");
  assert.equal(dominant(colourAt(out, third * 1.5)), "green", "second destination is the second clip");
  assert.equal(dominant(colourAt(out, third * 2.5)), "blue", "third destination is the third clip");
  // Equal shares: the assembler's own split of the three clips is the same third each.
  const lengths = segmentLengths([9, 9, 9], total);
  for (const length of lengths) assert.ok(Math.abs(length - third) < 1e-9, "each destination gets an equal third");
  rmSync(dir, { recursive: true, force: true });
});
