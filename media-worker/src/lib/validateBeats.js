// Shared by both the legacy single-process server (routes/jobs.js) and the dispatcher
// (dispatcher.js) - identical validation either way, extracted so it's one implementation.
import { beatControlsError, montageError } from "../pipeline/visualSelection.js";

export function validateBeats(beats) {
  if (!Array.isArray(beats) || beats.length === 0) {
    return "beats must be a non-empty array";
  }
  for (const [index, beat] of beats.entries()) {
    if (!beat || typeof beat.text !== "string" || beat.text.trim().length === 0) {
      return `beats[${index}].text is required`;
    }
    if (typeof beat.visualQuery !== "string" || beat.visualQuery.trim().length === 0) {
      return `beats[${index}].visualQuery is required`;
    }
    const montage = montageError(beat.montage);
    if (montage) return `beats[${index}].${montage}`;
    const controls = beatControlsError(beat);
    if (controls) return `beats[${index}].${controls}`;
  }
  return null;
}
