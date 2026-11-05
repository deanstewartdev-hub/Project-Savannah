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

// Maps every beat onto the absolute narration timeline, so each beat's visual covers the speech AND the
// pauses that belong to it. Beat 0 starts at 0 (it also covers any lead-in before its first word); each
// later beat starts at its own first word; every beat ends where the next one starts, and the last beat
// ends at the end of the narration file. The durations therefore sum to narrationSeconds exactly, so the
// finished video cannot be shorter than the narration, and no silence is silently dropped.
export function beatVisualSpans(timedBeats, narrationSeconds) {
  if (!Number.isFinite(narrationSeconds) || narrationSeconds <= 0) {
    throw new Error("The narration length must be a positive number of seconds.");
  }
  if (timedBeats.length === 0) throw new Error("No beats to lay out on the narration timeline.");
  const lastEnd = timedBeats[timedBeats.length - 1].end;
  if (narrationSeconds + 0.01 < lastEnd) {
    throw new Error(`The narration (${narrationSeconds.toFixed(2)} s) ends before its last aligned word (${lastEnd.toFixed(2)} s).`);
  }

  let previousStart = 0;
  return timedBeats.map((beat, index) => {
    const start = index === 0 ? 0 : beat.start;
    const end = index === timedBeats.length - 1 ? narrationSeconds : timedBeats[index + 1].start;
    if (!(start >= previousStart) || !(end > start)) {
      throw new Error(`Beat ${index} does not fall in order on the narration timeline (${start.toFixed(2)} to ${end.toFixed(2)} s).`);
    }
    previousStart = start;
    return { start, end, duration: end - start };
  });
}
