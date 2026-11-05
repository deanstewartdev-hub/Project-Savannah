// Fail-closed check that a finished video carries the whole narration (Issue #29: a potential cut-off of
// the voiceover). Everything here reads measured lengths and aligned word times. No paid call is made.
//
// What it refuses:
//   - a video or audio stream shorter than the narration file (speech would be cut off);
//   - a long stretch of narration after the last recognised word (speech may have been missed by alignment);
//   - too few recognised words for the script (alignment may have dropped speech).
// A refusal throws NarrationIncompleteError, so the job fails and nothing is delivered.

export const NARRATION_COMPLETENESS = Object.freeze({
  // Container and frame rounding: AAC frames are ~23 ms and video frames 33 ms at 30 fps.
  toleranceSeconds: 0.12,
  // Silence after the last recognised word that a normal script ends with (outro breath) is allowed up to this long.
  maxUnalignedTailSeconds: 3,
  // Recognised words must be at least this share of the script's words (tokenisation differences are small).
  minWordCoverage: 0.9
});

export class NarrationIncompleteError extends Error {
  constructor(problems) {
    super(`Narration may be incomplete, so this video is refused: ${problems.join(" ")}`);
    this.name = "NarrationIncompleteError";
    this.problems = problems;
  }
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function assertNarrationComplete({ narrationSeconds, videoSeconds, audioSeconds, alignedWords, scriptWordCount }) {
  const problems = [];
  const tol = NARRATION_COMPLETENESS.toleranceSeconds;

  if (!finite(narrationSeconds) || narrationSeconds <= 0) {
    problems.push("The narration length could not be measured.");
  } else {
    if (!finite(videoSeconds)) {
      problems.push("The video length could not be measured.");
    } else if (videoSeconds < narrationSeconds - tol) {
      problems.push(`The video is ${videoSeconds.toFixed(2)} s, shorter than the ${narrationSeconds.toFixed(2)} s narration.`);
    }
    if (!finite(audioSeconds)) {
      problems.push("The audio length could not be measured.");
    } else if (audioSeconds < narrationSeconds - tol) {
      problems.push(`The audio is ${audioSeconds.toFixed(2)} s, shorter than the ${narrationSeconds.toFixed(2)} s narration.`);
    }
  }

  const words = Array.isArray(alignedWords) ? alignedWords : [];
  if (words.length === 0) {
    problems.push("No words were recognised in the narration.");
  } else {
    const lastEnd = Math.max(...words.map((w) => w.end));
    if (finite(narrationSeconds) && narrationSeconds - lastEnd > NARRATION_COMPLETENESS.maxUnalignedTailSeconds) {
      problems.push(
        `${(narrationSeconds - lastEnd).toFixed(2)} s of narration follow the last recognised word, so speech may have been missed.`
      );
    }
    for (let i = 1; i < words.length; i += 1) {
      if (words[i].start < words[i - 1].start) {
        problems.push("The recognised words are out of order.");
        break;
      }
    }
  }

  if (finite(scriptWordCount) && scriptWordCount > 0) {
    const coverage = words.length / scriptWordCount;
    if (coverage < NARRATION_COMPLETENESS.minWordCoverage) {
      problems.push(
        `Only ${words.length} of ${scriptWordCount} script words were recognised (${Math.round(coverage * 100)}%), so speech may have been dropped.`
      );
    }
  }

  if (problems.length > 0) throw new NarrationIncompleteError(problems);
  return { ok: true };
}
