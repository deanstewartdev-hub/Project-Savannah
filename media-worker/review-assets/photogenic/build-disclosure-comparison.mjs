#!/usr/bin/env node
// Builds a visual comparison of the AI-still disclosure label: the current position (as the worker draws it) beside a
// raised position, each over the same frame with a SIMULATED Shorts overlay. The overlay boxes are rough stand-ins for
// the platform's controls (top bar, right-hand action column, bottom title block, progress bar). They are NOT measured
// from YouTube's interface, and the picture is a test pattern, not a real Photogenic frame. Nothing is uploaded.
//
// Usage: node media-worker/review-assets/photogenic/build-disclosure-comparison.mjs <output.png>
// Needs ffmpeg on the PATH. The caption file comes from the worker's own caption builder, so caption position is real.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { buildCaptionAss } = await import(pathToFileURL(path.resolve(here, "..", "..", "src", "lib", "captionAss.js")).href);

const W = 1080;
const H = 1920;
const FONT_CANDIDATES = ["C:/Windows/Fonts/arialbd.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"];
const font = FONT_CANDIDATES.find((file) => existsSync(file));
if (!font) throw new Error("No bold font found for the simulation labels.");
// Filtergraph escaping: the filter string is parsed twice, so a colon in a path needs double escaping (two backslashes).
const fontArg = "fontfile=" + font.replace(/:/g, "\\\\:");

// Current label: the worker's own position (h-260, bottom third). Raised label: 1000 px from the top, between the caption
// band and the top of the frame, clear of the right-hand column (which starts at x 930).
const LABEL_TEXT = "AI-GENERATED ILLUSTRATION";
const labelFilter = (y) => "drawtext=" + fontArg + ":text='" + LABEL_TEXT + "':fontsize=44:fontcolor=white:" +
  "box=1:boxcolor=black@0.6:boxborderw=24:x=(w-text_w)/2:y=" + y;
const CURRENT_Y = "h-260";
const RAISED_Y = "1000";

// Simulated overlay: approximations only (see the header).
const overlay = [
  "drawbox=x=0:y=0:w=" + W + ":h=170:color=black@0.4:t=fill",
  "drawtext=" + fontArg + ":text='Shorts':fontsize=48:fontcolor=white:x=40:y=60",
  ...[1020, 1160, 1300, 1440].map((y) => "drawbox=x=930:y=" + y + ":w=120:h=120:color=white@0.35:t=fill"),
  "drawbox=x=0:y=1500:w=" + W + ":h=420:color=black@0.5:t=fill",
  "drawtext=" + fontArg + ":text='Simulated video title':fontsize=44:fontcolor=white:x=40:y=1540",
  "drawtext=" + fontArg + ":text='Simulated channel line':fontsize=36:fontcolor=white@0.8:x=40:y=1620",
  "drawbox=x=0:y=1900:w=" + W + ":h=8:color=white@0.7:t=fill"
];

function panel(workDir, name, labelY) {
  const out = path.join(workDir, name + ".png");
  // Captions are shown from the start; the frame is sampled at 0.8 s, after the caption fade-in.
  const words = ["Blue", "walls", "and", "quiet"].map((word, index) => ({ word, start: index * 0.5, end: index * 0.5 + 0.5 }));
  writeFileSync(path.join(workDir, "captions.ass"), buildCaptionAss(words, { width: W, height: H }), "utf8");
  const filters = ["subtitles=captions.ass", labelFilter(labelY), ...overlay, "trim=start=0.8"].join(",");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=" + W + "x" + H + ":d=2",
    "-vf", filters, "-frames:v", "1", out], { cwd: workDir });
  return out;
}

function main(outputFile) {
  const workDir = mkdtempSync(path.join(os.tmpdir(), "disclosure-comparison-"));
  try {
    const current = panel(workDir, "current", CURRENT_Y);
    const raised = panel(workDir, "raised", RAISED_Y);
    const legend = (text, x) => "drawtext=" + fontArg + ":text='" + text + "':fontsize=40:fontcolor=black:x=" + x + ":y=24";
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", current, "-i", raised,
      "-filter_complex", "[0][1]hstack=inputs=2,pad=" + (W * 2 + 40) + ":" + (H + 120) + ":0:120:white," +
        legend("A  current position (bottom third)", 30) + "," + legend("B  raised position (1000 px)", W + 70),
      "-frames:v", "1", outputFile]);
    console.log("wrote " + outputFile + " (simulated Shorts overlay; not measured from YouTube)");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  if (!process.argv[2]) {
    console.error("usage: node build-disclosure-comparison.mjs <output.png>");
    process.exit(2);
  }
  main(path.resolve(process.argv[2]));
}
