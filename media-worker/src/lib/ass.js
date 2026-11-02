import { writeFile } from "node:fs/promises";
import { config } from "../config.js";
import { buildCaptionAss } from "./captionAss.js";

// Short phrases on screen at once, timed from Whisper word timestamps (see captionAss.js for the
// layout and captionChunks.js for the grouping).
export async function writeWordPopAss(words, outPath) {
  const { width, height } = config.video;
  await writeFile(outPath, buildCaptionAss(words, { width, height }), "utf8");
  return outPath;
}
