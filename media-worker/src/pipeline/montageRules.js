// Montage and scene-control rules: what a montage part looks like as a beat, the human-approved clip
// lists, and the request checks shared with the worker's request validation. Pure.
// Split out of visualSelection.js (modular refactor, November 2026); the code is unchanged.
// Import from visualSelection.js, which re-exports this module's public names.

// A montage beat lists parts, each with its own place and keywords. Every part gets its own clip, with an equal
// share of the beat's seconds. A beat whose parts lack a clip fails, and then becomes a still as usual.
export function montagePartBeat(part) {
  const keywords = String(part.searchKeywords || "").trim();
  const place = String(part.location || "").trim();
  return {
    location: place,
    searchKeywords: keywords,
    visualQuery: keywords || place,
    imagePrompt: keywords || place,
    approvedClips: Array.isArray(part.approvedClips) ? part.approvedClips : undefined
  };
}

// A montage takes exactly one clip per part, and each clip is at least that part's share long. One clip per part
// keeps the assembler's equal split exact: every segment gets the same length, so no destination takes longer.
export function isMontage(beat) {
  return Array.isArray(beat.montage) && beat.montage.length > 0;
}

// Human-reviewed clips for a beat or montage place. When a list is given, only those Pexels clips may be used, even if
// other results match the place. Absent or empty means no restriction (the place rule alone applies).
export function approvedSet(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  return new Set(list);
}

export function approvedCandidates(base, allowed) {
  if (!allowed) return base;
  return async (query, allowLandscape) => (await base(query, allowLandscape)).filter((video) => allowed.has(video.id));
}

export const MONTAGE_MIN_PARTS = 2;
export const MONTAGE_MAX_PARTS = 3;

// The montage rules, shared by the worker's request check. Returns an error message, or null when the montage is valid
// (or absent). Apps Script enforces the same rules when a script is validated and when its render is submitted.
export function montageError(montage) {
  if (montage === undefined || montage === null) return null;
  if (!Array.isArray(montage)) return "montage must be a list of places";
  if (montage.length < MONTAGE_MIN_PARTS || montage.length > MONTAGE_MAX_PARTS) {
    return `montage needs ${MONTAGE_MIN_PARTS} to ${MONTAGE_MAX_PARTS} places`;
  }
  for (const [index, part] of montage.entries()) {
    if (!part || typeof part !== "object" || typeof part.location !== "string" || !part.location.trim()) {
      return `montage place ${index + 1} needs a location`;
    }
    if (part.location.trim().length > 60) return `montage place ${index + 1} location is longer than 60 characters`;
    if (part.searchKeywords !== undefined && (typeof part.searchKeywords !== "string" || part.searchKeywords.length > 80)) {
      return `montage place ${index + 1} searchKeywords must be text of at most 80 characters`;
    }
    const clips = approvedClipsError(part.approvedClips, `montage place ${index + 1}`);
    if (clips) return clips;
  }
  return null;
}

// Human-reviewed clip IDs for a beat or montage place: at most 5 positive whole Pexels IDs.
export function approvedClipsError(list, label) {
  if (list === undefined) return null;
  if (!Array.isArray(list) || list.length > 5) return `${label} approvedClips must be a list of at most 5 Pexels clip IDs`;
  for (const id of list) {
    if (!Number.isInteger(id) || id <= 0) return `${label} approvedClips must contain positive whole numbers`;
  }
  return null;
}

// Scene-level controls: approved clips for a single-clip beat, and a labelled still. A labelled still uses no footage,
// so it cannot also name clips, and a montage cannot be a labelled still.
export function beatControlsError(beat) {
  const clips = approvedClipsError(beat.approvedClips, "beat");
  if (clips) return clips;
  if (beat.labelledStill !== undefined && typeof beat.labelledStill !== "boolean") return "labelledStill must be true or false";
  if (beat.labelledStill === true && Array.isArray(beat.approvedClips) && beat.approvedClips.length > 0) {
    return "a labelled still cannot also name approved clips";
  }
  if (beat.labelledStill === true && isMontage(beat)) return "a montage cannot be a labelled still";
  return null;
}
