// Builds caption frames for the approved five Chefchaouen scenes with the real caption writer.
// Word timings are ESTIMATES (the probed narration length split by word count), because Whisper
// timings for this script are not stored. Frames show layout, spelling and margins, not sync.
// Usage: node scripts/caption-frames-sample.mjs <output-folder>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCaptionAss } from "../src/lib/captionAss.js";
import { groupCaptionChunks } from "../src/lib/captionChunks.js";

const here = dirname(fileURLToPath(import.meta.url));
const plan = JSON.parse(readFileSync(join(here, "..", "..", "tools", "first-video", "shot-plan.json"), "utf8"));
const out = process.argv[2];
if (!out) throw new Error("output folder required");
mkdirSync(out, { recursive: true });

const PROBED = 42.27;
const allWords = plan.scenes.flatMap((s) => s.narration.split(/\s+/).filter(Boolean));
const perWord = PROBED / allWords.length;
const words = allWords.map((word, i) => ({ word, start: i * perWord, end: (i + 1) * perWord }));

// Spelling and completeness: the caption words must equal the approved narration, in order.
const captioned = groupCaptionChunks(words).flatMap((c) => c.text.split(" "));
const approved = allWords.map((w) => w.toUpperCase().replace(/[{}]/g, ""));
const same = captioned.length === approved.length && captioned.every((w, i) => w === approved[i]);
console.log("caption words match approved narration:", same, captioned.length, "words");
if (!same) process.exit(1);

// The real writer's output, then the frames at each phrase's middle.
const ass = buildCaptionAss(words, { width: 1080, height: 1920 });
const chunks = groupCaptionChunks(words);
console.log("phrases:", chunks.length, "| longest phrase (chars):", Math.max(...chunks.map((c) => c.text.length)));
const assName = "caption-sample-tmp.ass";
writeFileSync(assName, ass);
const frames = chunks.filter((_, i) => i % 3 === 0).slice(0, 8);
try {
  frames.forEach((chunk, i) => {
    const t = ((chunk.start + chunk.end) / 2).toFixed(3);
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0x3a3a3a:size=1080x1920:duration=45",
      "-vf", `subtitles=${assName}`, "-ss", t, "-frames:v", "1", join(out, `frame-${String(i + 1).padStart(2, "0")}-${t}s.png`)]);
  });
} finally {
  execFileSync("node", ["-e", `require('fs').unlinkSync('${assName}')`]);
}
writeFileSync(join(out, "phrases.txt"), chunks.map((c, i) => `${i + 1}. [${c.start.toFixed(2)}-${c.end.toFixed(2)}] ${c.text}`).join("\n") + "\n");
console.log("frames written:", frames.length, "to", out);
