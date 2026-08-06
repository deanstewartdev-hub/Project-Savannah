function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Maps each beat's narration text onto a [start, end] window in the aligned word
// timeline, by walking the flat Whisper word list in order and consuming as many words
// as each beat's own text implies. Whisper's tokenization won't match a naive split()
// exactly in every case (numbers, contractions), so the last beat absorbs any leftover
// words rather than leaving a gap at the end of the video.
export function computeBeatTimings(beats, alignedWords) {
  let cursor = 0;
  const timings = beats.map((beat, index) => {
    const isLast = index === beats.length - 1;
    const count = isLast ? alignedWords.length - cursor : wordCount(beat.text);
    const slice = alignedWords.slice(cursor, cursor + count);
    cursor += count;

    if (slice.length === 0) {
      throw new Error(`Beat ${index} ("${beat.text.slice(0, 30)}...") aligned to zero words`);
    }

    return {
      ...beat,
      start: slice[0].start,
      end: slice[slice.length - 1].end,
      words: slice
    };
  });

  return timings;
}
