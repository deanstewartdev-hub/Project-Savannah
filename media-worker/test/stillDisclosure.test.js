import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Real FFmpeg, no provider calls. Checks what a viewer sees: the AI-still label is on the picture, and a long still
// keeps moving. The font is the one the CI installs (DejaVu) or a Windows font on a developer machine.
const FONT_CANDIDATES = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/arial.ttf"];
const font = FONT_CANDIDATES.find((file) => existsSync(file));
if (font) process.env.AI_STILL_LABEL_FONT ??= font;
for (const name of ["JOB_SUBMIT_SECRET", "OPENAI_API_KEY", "ELEVENLABS_API_KEY", "PEXELS_API_KEY"]) {
  process.env[name] ??= randomBytes(32).toString("hex");
}
process.env.ELEVENLABS_VOICE_ID ??= "test-voice";
process.env.GCS_BUCKET ??= "test-bucket";
const { normalizeBeatClip, stillLabelFilter } = await import("../src/pipeline/assemble.js");
const { config } = await import("../src/config.js");

const W = 1080;
const H = 1920;
const dir = mkdtempSync(path.join(os.tmpdir(), "still-disclosure-"));
const still = path.join(dir, "still.png");
// A flat blue picture: anything darker or brighter than the blue must be the label.
execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=0x2060a0:s=${W}x${H}:d=1`, "-frames:v", "1", still]);

// Raw RGB pixels of a region at a time: the picture's pixels, read back from the finished clip.
function rawFrame(file, seconds, crop) {
  const vf = crop ? `crop=${crop},` : "";
  return execFileSync("ffmpeg", ["-v", "error", "-ss", String(seconds), "-i", file, "-frames:v", "1", "-vf", vf.slice(0, -1) || "null", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 64 * 1024 * 1024 });
}

function luminance(buffer) {
  let sum = 0;
  let max = 0;
  for (let i = 0; i < buffer.length; i += 3) {
    const y = 0.299 * buffer[i] + 0.587 * buffer[i + 1] + 0.114 * buffer[i + 2];
    sum += y;
    if (y > max) max = y;
  }
  return { mean: sum / (buffer.length / 3), max };
}

test("an AI still carries its disclosure on the picture: a dark box with white text in the bottom third", async (t) => {
  if (!font) { t.skip("no font on this host; the CI installs DejaVu"); return; }
  const out = path.join(dir, "labelled.mp4");
  await normalizeBeatClip({ type: "still", path: still, synthetic: true }, 3, out);
  // A strip inside the box's top padding, above the letters: the dark box over the blue picture.
  const boxPad = luminance(rawFrame(out, 1.0, "280:8:400:1641"));
  const plain = luminance(rawFrame(out, 1.0, `${W}:80:0:100`));
  assert.ok(boxPad.mean < plain.mean * 0.6, `the label box darkens its padding (${boxPad.mean.toFixed(0)} vs ${plain.mean.toFixed(0)} on plain blue)`);
  const band = luminance(rawFrame(out, 1.0, `${W}:80:0:1640`));
  assert.ok(band.max > 200, `white label text is visible in the bottom band (brightest pixel ${band.max.toFixed(0)})`);
});

test("a long AI still keeps moving to the end of its beat (no frozen tail)", async (t) => {
  if (!font) { t.skip("no font on this host"); return; }
  const out = path.join(dir, "long.mp4");
  // A textured picture (ffmpeg's test pattern), so a slow zoom changes what is on screen. A flat colour would not show it.
  const textured = path.join(dir, "textured.png");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `testsrc=s=${W}x${H}:d=1`, "-frames:v", "1", textured]);
  await normalizeBeatClip({ type: "still", path: textured, synthetic: true }, 9, out);
  const early = rawFrame(out, 5.0);
  const late = rawFrame(out, 8.5);
  let diff = 0;
  for (let i = 0; i < early.length; i += 3) diff += Math.abs(early[i] - late[i]) + Math.abs(early[i + 1] - late[i + 1]) + Math.abs(early[i + 2] - late[i + 2]);
  const meanDiff = diff / early.length;
  // The old zoom stopped after about 4 s, which left this comparison identical (the flat picture plus a fixed label).
  assert.ok(meanDiff > 1, `the picture still changes between 5 s and 8.5 s (mean difference ${meanDiff.toFixed(2)})`);
});

test("without a usable font no AI still is rendered: the label filter refuses", () => {
  assert.throws(
    () => stillLabelFilter({ fontFile: path.join(dir, "missing.ttf"), text: "AI-GENERATED ILLUSTRATION" }),
    /refusing to render an unlabelled AI still/
  );
  assert.match(config.aiStillLabel.text, /AI-GENERATED ILLUSTRATION/);
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
