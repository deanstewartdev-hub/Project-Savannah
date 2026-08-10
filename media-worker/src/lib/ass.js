import { writeFile } from "node:fs/promises";
import { config } from "../config.js";

function toAssTimestamp(seconds) {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const cs = Math.round((clamped - Math.floor(clamped)) * 100);
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${h}:${pad2(m)}:${pad2(s)}.${pad2(cs)}`;
}

const HEADER = (width, height) => `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: WordPop,Arial,${Math.round(height * 0.055)},&H00FFFFFF,&H00000000,&H80000000,-1,0,1,3,0,2,80,80,${Math.round(height * 0.12)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

// One word on screen at a time ("word-pop" captions), timed from Whisper word timestamps.
// A short fade in/out avoids a hard flash on every cut.
export async function writeWordPopAss(words, outPath) {
  const { width, height } = config.video;
  const lines = words.map((word) => {
    const start = toAssTimestamp(word.start);
    const end = toAssTimestamp(word.end);
    const text = word.word.trim().toUpperCase().replace(/[{}]/g, "");
    return `Dialogue: 0,${start},${end},WordPop,,0,0,0,,{\\fad(50,50)}${text}`;
  });
  await writeFile(outPath, HEADER(width, height) + lines.join("\n") + "\n", "utf8");
  return outPath;
}
