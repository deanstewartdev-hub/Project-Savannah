// Pure visual-selection logic: builds short location-specific search queries, checks Pexels
// results for relevance, and plans one clip (or a labelled still) per beat. No network, no
// filesystem, so it can be tested without secrets. Pexels metadata is supporting evidence
// only: a title or uploader name that mentions the place does not prove the footage was
// filmed there, so every chosen clip still needs a human shot-list review.
//
// This file plans the footage for a job and is the single import point for visual selection. The
// supporting logic lives in focused modules beside it, re-exported here so every importer is unchanged:
//   visualQueries.js      search queries and the labelled-still prompt
//   clipSelection.js      judging and choosing one clip
//   montageRules.js       montage and scene-control rules
//   footagePreflight.js   the unpaid footage preflight

import { buildSearchQueries, stillPrompt } from "./visualQueries.js";
import { selectClip } from "./clipSelection.js";
import { montagePartBeat, isMontage, approvedSet, approvedCandidates } from "./montageRules.js";

export { tokenize, deriveKeywords, shotWordsFor, buildSearchQueries, stillPrompt } from "./visualQueries.js";
export {
  MAX_CROP_UPSCALE, MIN_KEPT_WIDTH_FRACTION, slugTokens, evidenceFor, judgeVideo, landscapeCropFile, selectClip
} from "./clipSelection.js";
export {
  MONTAGE_MIN_PARTS, MONTAGE_MAX_PARTS, montagePartBeat, isMontage, approvedSet, approvedCandidates,
  montageError, approvedClipsError, beatControlsError
} from "./montageRules.js";
export { coverageCandidates, unsupportedBeats, matchedFlags, maxDistinctAssignment } from "./footagePreflight.js";

export class VisualCoverageError extends Error {
  constructor(message, beatIndex) {
    super(message);
    this.name = "VisualCoverageError";
    this.code = "PRODUCTION_VISUAL_COVERAGE";
    this.beatIndex = beatIndex;
  }
}

// Pure helper: the piece lengths that cover `durationSeconds` from the source clips, in order.
// The beat is shared evenly across the clips, so no cut is a short tail; a clip shorter than
// its share gives its whole length and the rest is spread over the others. Each piece is no
// longer than its source. Returns null when the sources are too short, so the caller reports
// a gap instead of looping a clip.
export function segmentLengths(sourceDurations, durationSeconds) {
  const lengths = sourceDurations.map(() => 0);
  let active = sourceDurations.map((_, index) => index);
  let remaining = durationSeconds;
  while (remaining > 0.001 && active.length > 0) {
    const share = remaining / active.length;
    for (const index of active) {
      const add = Math.min(share, sourceDurations[index] - lengths[index]);
      lengths[index] += add;
      remaining -= add;
    }
    active = active.filter((index) => sourceDurations[index] - lengths[index] > 0.001);
  }
  return remaining <= 0.001 ? lengths : null;
}

// A beat may need several clips (cuts, not loops). Each clip is used once in the job.
const MAX_SEGMENTS_PER_BEAT = 3;
// A cut shorter than this reads as a flash, so a beat prefers one clip over a short tail.
const MIN_CUT_SECONDS = 2.5;

// Uploaders used by the most recent planned scene, so the next scene prefers different footage sources.
export function previousUploaders(plan) {
  const last = plan && plan.length ? plan[plan.length - 1] : null;
  const names = (last && last.segments ? last.segments : []).map((segment) => segment.uploader).filter(Boolean);
  return new Set(names);
}

// Descriptive words of the most recent planned scene's clips (from their URL slugs).
export function previousTokens(plan) {
  const last = plan && plan.length ? plan[plan.length - 1] : null;
  const words = (last && last.segments ? last.segments : []).flatMap((segment) => segment.tokens || []);
  return new Set(words);
}

// Footage for one beat, from the queries in order. `candidates(query, allowLandscape)` returns the Pexels
// results for a query. Pass one takes a single clip long enough for the beat; pass two collects several
// clips (each at least MIN_CUT_SECONDS, except the last). Clips already used by earlier beats are skipped.
async function collectFootage(beat, queries, needed, ctx) {
  const { usedIds, usedBefore, candidates, avoid, avoidWords, allowLandscape, tried } = ctx;
  const segments = [];
  let covered = 0;

  if (needed === 0) {
    for (const query of queries) {
      tried.push(query);
      const chosen = selectClip(await candidates(query, allowLandscape), beat, usedIds, 0, avoid, avoidWords, allowLandscape);
      if (chosen) {
        chosen.query = query;
        segments.push(chosen);
        usedIds.add(chosen.pexelsId);
        break;
      }
    }
    return { segments, covered };
  }

  // First choice: one clip long enough for the whole beat, so the beat needs no cut.
  for (const query of queries) {
    tried.push(query);
    const chosen = selectClip(await candidates(query, allowLandscape), beat, usedIds, needed, avoid, avoidWords, allowLandscape);
    if (chosen) {
      chosen.query = query;
      segments.push(chosen);
      usedIds.add(chosen.pexelsId);
      covered = chosen.sourceDurationSeconds;
      break;
    }
  }
  if (covered >= needed) return { segments, covered };

  // Otherwise, several clips.
  segments.length = 0;
  usedIds.clear();
  for (const id of usedBefore) usedIds.add(id);
  covered = 0;
  for (const query of queries) {
    while (segments.length < MAX_SEGMENTS_PER_BEAT && covered < needed) {
      const chosen = selectClip(await candidates(query, allowLandscape), beat, usedIds, MIN_CUT_SECONDS, avoid, avoidWords, allowLandscape);
      if (!chosen) break;
      chosen.query = query;
      segments.push(chosen);
      usedIds.add(chosen.pexelsId);
      covered += chosen.sourceDurationSeconds;
    }
    if (!tried.includes(query)) tried.push(query);
    if (covered >= needed) break;
  }
  return { segments, covered };
}

// The first relevant, unused clip for a part, long enough for its share. Clips are checked in query order.
async function pickOneClip(partBeat, queries, share, ctx) {
  const { usedIds, candidates, avoid, avoidWords, tried, allowLandscape } = ctx;
  for (const query of queries) {
    tried.push(query);
    const chosen = selectClip(await candidates(query, allowLandscape), partBeat, usedIds, share, avoid, avoidWords, allowLandscape);
    if (chosen) {
      chosen.query = query;
      usedIds.add(chosen.pexelsId);
      return chosen;
    }
  }
  return null;
}

async function collectMontage(beat, ctx) {
  const { usedIds, candidates, avoid, avoidWords, tried, landscapeFallback } = ctx;
  const parts = beat.montage;
  const share = (beat.coverSeconds || 0) / parts.length;
  const segments = [];
  for (const [index, part] of parts.entries()) {
    const partBeat = montagePartBeat(part);
    const queries = buildSearchQueries(partBeat);
    const partCandidates = approvedCandidates(candidates, approvedSet(part.approvedClips));
    let chosen = await pickOneClip(partBeat, queries, share, { usedIds, candidates: partCandidates, avoid, avoidWords, tried, allowLandscape: false });
    if (!chosen && landscapeFallback) {
      chosen = await pickOneClip(partBeat, queries, share, { usedIds, candidates: partCandidates, avoid, avoidWords, tried, allowLandscape: true });
    }
    if (!chosen) {
      releaseSegments(segments, usedIds);
      return { segments: [], covered: 0, ok: false, missingPart: index };
    }
    segments.push(chosen);
  }
  return {
    segments,
    covered: segments.reduce((sum, s) => sum + s.sourceDurationSeconds, 0),
    ok: true,
    missingPart: null
  };
}

function footageCovers(found, needed) {
  if (typeof found.ok === "boolean") return found.ok;
  if (needed === 0) return found.segments.length > 0;
  return segmentLengths(found.segments.map((s) => s.sourceDurationSeconds), needed) !== null;
}

function releaseSegments(segments, usedIds) {
  for (const segment of segments) usedIds.delete(segment.pexelsId);
}

// Plans every beat in order. `search(query, orientation)` resolves to Pexels video objects, with orientation
// "portrait" or "landscape". Clips are de-duplicated across the whole job. A beat with `coverSeconds` collects
// clips until their durations cover it. Portrait footage is tried first. Only when that fails, and only when
// options.landscapeFallback is true, landscape footage is tried too, centre-cropped and checked for crop quality.
// When a beat still cannot be covered with relevant footage, the plan either falls back to a labelled AI still
// (allowAiStills) or fails with a visual-coverage error.
export async function planBeatVisuals(beats, search, options = {}) {
  const usedIds = new Set();
  const cache = new Map();
  const cachedSearch = async (query, orientation) => {
    const key = orientation + "|" + query;
    if (!cache.has(key)) cache.set(key, await search(query, orientation));
    return cache.get(key);
  };
  const candidates = async (query, allowLandscape) => {
    const portrait = (await cachedSearch(query, "portrait")) || [];
    if (!allowLandscape) return portrait;
    const landscape = (await cachedSearch(query, "landscape")) || [];
    const ids = new Set(portrait.map((video) => video.id));
    return [...portrait, ...landscape.filter((video) => !ids.has(video.id))];
  };
  const landscapeFallback = options.landscapeFallback === true;

  const plan = [];
  for (let index = 0; index < beats.length; index += 1) {
    const beat = beats[index];
    const avoid = previousUploaders(plan);
    const avoidWords = previousTokens(plan);
    const needed = beat.coverSeconds || 0;
    // A labelled still was asked for by the script: no footage is searched, and it is planned as a labelled AI still.
    if (beat.labelledStill === true) {
      if (!options.allowAiStills) {
        throw new VisualCoverageError(
          `Beat ${index + 1} is a labelled still, but AI stills are not allowed for this job. Nothing was generated.`,
          index
        );
      }
      plan.push({
        beatIndex: index,
        type: "still",
        synthetic: true,
        label: "AI-generated illustration, not authentic footage",
        prompt: stillPrompt(beat),
        queriesTried: [],
        reason: "labelled still requested by the script"
      });
      continue;
    }

    const queries = buildSearchQueries(beat);
    const tried = [];
    const usedBefore = new Set(usedIds);
    const beatCandidates = approvedCandidates(candidates, approvedSet(beat.approvedClips));
    const pass = (allowLandscape) => collectFootage(beat, queries, needed, {
      usedIds, usedBefore, candidates: beatCandidates, avoid, avoidWords, allowLandscape, tried
    });

    let found;
    if (isMontage(beat)) {
      found = await collectMontage(beat, { usedIds, candidates, avoid, avoidWords, tried, landscapeFallback });
      // Fail closed: a montage with a missing place is never turned into a still, whatever allowAiStills says.
      if (!found.ok) {
        const place = beat.montage[found.missingPart].location;
        throw new VisualCoverageError(
          `Montage beat ${index + 1}: no distinct relevant clip for place ${found.missingPart + 1} (${place}). A montage is never turned into a still; nothing was generated.`,
          index
        );
      }
    } else {
      found = await pass(false);
      if (!footageCovers(found, needed) && landscapeFallback) {
        releaseSegments(found.segments, usedIds);
        found = await pass(true);
      }
    }
    if (footageCovers(found, needed)) {
      plan.push({
        beatIndex: index,
        type: "video",
        segments: found.segments,
        queriesTried: tried,
        reason: found.segments.map((s) => s.reason).join(" / ")
      });
      continue;
    }

    // Release clips picked for this beat: the beat is not using them.
    releaseSegments(found.segments, usedIds);
    if (!options.allowAiStills) {
      throw new VisualCoverageError(
        "No relevant footage covering " + needed.toFixed(1) + " s for beat " + (index + 1) + " after queries: " + tried.join(" | "),
        index
      );
    }
    plan.push({
      beatIndex: index,
      type: "still",
      synthetic: true,
      label: "AI-generated illustration, not authentic footage",
      prompt: stillPrompt(beat),
      queriesTried: tried,
      reason: "no relevant footage found; labelled AI still used"
    });
  }
  return plan;
}

// One Pexels search per (query, orientation) for the whole job: the unpaid preflight and the planner share the
// results, so the same query is never requested twice. Concurrent callers share one in-flight request.
export function memoizeSearch(search) {
  const cache = new Map();
  let calls = 0;
  const memo = (query, orientation = "portrait") => {
    const key = orientation + "|" + query;
    if (!cache.has(key)) {
      calls += 1;
      cache.set(key, Promise.resolve().then(() => search(query, orientation)));
    }
    return cache.get(key);
  };
  memo.calls = () => calls;
  return memo;
}
