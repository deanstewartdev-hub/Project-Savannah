import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Real FFmpeg, no provider calls. Checks the final vertical layout of a short: the burned-in captions and the
// "AI-GENERATED ILLUSTRATION" label on an AI still must not overlap. Each element is rendered on a flat grey frame, so
// the rows that differ from the grey are exactly that element's band on the picture.
const FONT_CANDIDATES = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/arial.ttf"];
const font = FONT_CANDIDATES.find((file) => existsSync(file));
if (font) process.env.AI_STILL_LABEL_FONT ??= font;
for (const name of ["JOB_SUBMIT_SECRET", "OPENAI_API_KEY", "ELEVENLABS_API_KEY", "PEXELS_API_KEY"]) {
  process.env[name] ??= randomBytes(32).toString("hex");
}
process.env.ELEVENLABS_VOICE_ID ??= "test-voice";
process.env.GCS_BUCKET ??= "test-bucket";
const { stillLabelFilter } = await import("../src/pipeline/assemble.js");
const { buildCaptionAss } = await import("../src/lib/captionAss.js");

const W = 1080;
const H = 1920;
const GREY = 64;
const MIN_GAP_PX = 40;
const dir = mkdtempSync(path.join(os.tmpdir(), "caption-layout-"));
test.after(() => rmSync(dir, { recursive: true, force: true }));

// Words for one caption line, shown from the first tenth of a second.
const words = ["Blue", "walls", "and", "quiet"].map((word, index) => ({ word, start: index * 0.5, end: index * 0.5 + 0.5 }));
writeFileSync(path.join(dir, "caps.ass"), buildCaptionAss(words, { width: W, height: H }), "utf8");

function frame(vf) {
  const args = ["-v", "error", "-f", "lavfi", "-i", `color=c=0x${GREY.toString(16).repeat(3)}:s=${W}x${H}:d=2`];
  // Sample at 0.8 s, after the caption fade-in, with timestamps kept so the captions are on screen.
  args.push("-vf", [vf, "trim=start=0.8"].filter(Boolean).join(","));
  args.push("-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-");
  return execFileSync("ffmpeg", args, { cwd: dir, maxBuffer: 64 * 1024 * 1024 });
}

// Rows where any pixel differs from the grey background, as runs of consecutive rows.
function deviatingRuns(buffer) {
  const rows = [];
  for (let y = 0; y < H; y++) {
    let deviates = false;
    for (let x = 0; x < W && !deviates; x++) {
      const i = (y * W + x) * 3;
      if (Math.abs(buffer[i] - GREY) > 3 || Math.abs(buffer[i + 1] - GREY) > 3 || Math.abs(buffer[i + 2] - GREY) > 3) deviates = true;
    }
    rows.push(deviates);
  }
  const runs = [];
  let start = -1;
  for (let y = 0; y <= H; y++) {
    const on = y < H && rows[y];
    if (on && start < 0) start = y;
    if (!on && start >= 0) { runs.push({ top: start, bottom: y - 1 }); start = -1; }
  }
  return runs;
}

const captionsOnly = deviatingRuns(frame("subtitles=caps.ass"));
const labelOnly = deviatingRuns(frame(stillLabelFilter()));
const both = deviatingRuns(frame(`subtitles=caps.ass,${stillLabelFilter()}`));

test("the captions and the AI-still label each put picture on the frame", () => {
  assert.ok(captionsOnly.length >= 1, "captions are drawn: " + JSON.stringify(captionsOnly));
  assert.equal(labelOnly.length, 1, "the label is one band: " + JSON.stringify(labelOnly));
  assert.ok(captionsOnly.every((run) => run.bottom < H), "captions lie inside the frame");
});

test("with both on the frame, the captions and the label do not overlap, and keep a clear gap", () => {
  assert.equal(both.length, 2, "two separate bands (captions and label): " + JSON.stringify(both));
  const [upper, lower] = both;
  const gap = lower.top - upper.bottom - 1;
  assert.ok(gap >= MIN_GAP_PX, `gap of ${gap}px between captions (${upper.top}-${upper.bottom}) and label (${lower.top}-${lower.bottom})`);
});

test("the label band matches the disclosure geometry the worker draws (bottom third, above the frame edge)", () => {
  const label = labelOnly[0];
  assert.ok(label.top >= Math.round(H * 0.66), "label starts in the bottom third: top " + label.top);
  assert.ok(label.bottom <= H - 40, "label stays clear of the frame edge: bottom " + label.bottom);
});

// The measured bands, printed so a reviewer can read the real gap without re-running the render.
test("report: measured bands for the captions and the label", () => {
  console.log("LAYOUT " + JSON.stringify({ captionsOnly, labelOnly, both }));
});
