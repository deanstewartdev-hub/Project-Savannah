// Groups timed words into short caption chunks for vertical video. A chunk is what is on screen at
// once, so it must be readable on a phone: few words, few characters, and a break at a clear pause.
// Pure functions only, so the grouping can be tested without rendering anything.

export const CAPTION_LIMITS = Object.freeze({
  maxWords: 3,
  maxCharacters: 18,
  maxSeconds: 1.6,
  pauseBreakSeconds: 0.35
});

// words: [{ word, start, end }] in time order. Returns [{ text, start, end, words }].
export function groupCaptionChunks(words, limits = CAPTION_LIMITS) {
  const usable = (words || []).filter((w) => w && typeof w.word === "string" && w.word.trim() !== "");
  const chunks = [];
  let current = null;
  for (const word of usable) {
    const text = word.word.trim().replace(/[{}]/g, "");
    const start = Number(word.start);
    const end = Number(word.end);
    if (!current) {
      current = { words: [text], start, end };
      continue;
    }
    const candidate = current.words.concat(text).join(" ");
    const pause = start - current.end;
    const wouldExceed = current.words.length + 1 > limits.maxWords ||
      candidate.length > limits.maxCharacters ||
      end - current.start > limits.maxSeconds;
    if (wouldExceed || pause >= limits.pauseBreakSeconds) {
      chunks.push(finish(current));
      current = { words: [text], start, end };
    } else {
      current.words.push(text);
      current.end = end;
    }
  }
  if (current) chunks.push(finish(current));
  return chunks;
}

function finish(chunk) {
  return { text: chunk.words.join(" ").toUpperCase(), start: chunk.start, end: chunk.end, words: chunk.words.length };
}

// Caption text must stay inside the frame: a chunk longer than the limits is a bug in grouping.
export function chunkWithinLimits(chunk, limits = CAPTION_LIMITS) {
  return chunk.words <= limits.maxWords && chunk.text.length <= limits.maxCharacters + 4 &&
    chunk.end - chunk.start <= limits.maxSeconds + 0.01;
}
