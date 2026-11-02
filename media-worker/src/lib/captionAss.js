// Builds the ASS caption document for vertical video. Pure (no config, no files) so layout and
// timing can be tested directly. Phrases come from captionChunks.js.
import { groupCaptionChunks } from "./captionChunks.js";

// Shorts overlays (title, channel, buttons) cover the top and bottom of a 9:16 frame, so captions
// sit above the bottom band and inside side margins.
export const SAFE_MARGIN_X = (width) => Math.round(width * 0.085);
export const SAFE_MARGIN_BOTTOM = (height) => Math.round(height * 0.24);

export function toAssTimestamp(seconds) {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const cs = Math.round((clamped - Math.floor(clamped)) * 100);
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${h}:${pad2(m)}:${pad2(s)}.${pad2(cs)}`;
}

export function buildCaptionHeader(width, height) {
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: WordPop,Arial,${Math.round(height * 0.055)},&H00FFFFFF,&H00000000,&H80000000,-1,0,1,3,0,2,${SAFE_MARGIN_X(width)},${SAFE_MARGIN_X(width)},${SAFE_MARGIN_BOTTOM(height)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
}

// words: [{ word, start, end }]. Returns the full ASS document text.
export function buildCaptionAss(words, { width, height }) {
  const lines = groupCaptionChunks(words).map((chunk) =>
    `Dialogue: 0,${toAssTimestamp(chunk.start)},${toAssTimestamp(chunk.end)},WordPop,,0,0,0,,{\\fad(60,60)}${chunk.text}`
  );
  return buildCaptionHeader(width, height) + lines.join("\n") + "\n";
}
