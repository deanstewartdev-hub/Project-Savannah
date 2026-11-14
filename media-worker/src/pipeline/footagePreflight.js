// The unpaid footage preflight: which clips could serve each beat, which beats have none, and how many
// beats can each be given a different clip. Uses the same queries and checks as the planner.
// Split out of visualSelection.js (modular refactor, November 2026); the code is unchanged.
// Import from visualSelection.js, which re-exports this module's public names.
import { buildSearchQueries } from "./visualQueries.js";
import { judgeVideo, framingFor } from "./clipSelection.js";
import { isMontage, montagePartBeat, approvedSet } from "./montageRules.js";

// Unpaid preflight, run before any narration. A beat is unsupported when none of its query variants returns a
// clip that passes the relevance and crop checks. That does not depend on the narration length, so it is never
// a guess: such a beat would need a still whatever the timing turns out to be. Beats that do have a candidate
// may still fail the duration check later, after narration. Uses the same queries and checks as the planner.
export async function coverageCandidates(beats, search, options = {}) {
  const landscapeFallback = options.landscapeFallback === true;
  const cache = new Map();
  const cachedSearch = async (query, orientation) => {
    const key = orientation + "|" + query;
    if (!cache.has(key)) cache.set(key, (await search(query, orientation)) || []);
    return cache.get(key);
  };
  const coverage = [];
  for (let index = 0; index < beats.length; index += 1) {
    const beat = beats[index];
    if (beat.labelledStill === true) {
      // A labelled still uses no footage, so it can never be matched to a clip: it is always a still.
      coverage.push({ beatIndex: index, queriesTried: [], candidateIds: new Set(), labelledStill: true });
      continue;
    }
    if (isMontage(beat)) {
      // A montage needs one distinct clip per part, so each part keeps its own candidate set. The preflight matches
      // those sets separately. candidateIds is empty when any part is missing, so the beat counts as unsupported.
      const subs = await coverageCandidates(beat.montage.map(montagePartBeat), search, options);
      const complete = subs.every((sub) => sub.candidateIds.size > 0);
      const union = new Set();
      for (const sub of subs) for (const id of sub.candidateIds) union.add(id);
      coverage.push({
        beatIndex: index,
        queriesTried: subs.flatMap((sub) => sub.queriesTried),
        candidateIds: complete ? union : new Set(),
        montage: true,
        parts: subs.map((sub) => sub.candidateIds)
      });
      continue;
    }
    const tried = [];
    const candidateIds = new Set();
    const allowed = approvedSet(beat.approvedClips);
    for (const query of buildSearchQueries(beat)) {
      tried.push(query);
      const videos = [
        ...(await cachedSearch(query, "portrait")),
        ...(landscapeFallback ? await cachedSearch(query, "landscape") : [])
      ];
      for (const video of videos) {
        if (allowed && !allowed.has(video.id)) continue;
        if (judgeVideo(video, beat).accepted && framingFor(video, landscapeFallback) !== null) candidateIds.add(video.id);
      }
    }
    coverage.push({
      beatIndex: index,
      queriesTried: tried,
      candidateIds
    });
  }
  return coverage;
}

// Beats with no candidate clip in any query variant or orientation.
export async function unsupportedBeats(beats, search, options = {}) {
  const coverage = await coverageCandidates(beats, search, options);
  return coverage
    .filter((entry) => entry.candidateIds.size === 0)
    .map((entry) => ({ beatIndex: entry.beatIndex, queriesTried: entry.queriesTried }));
}

// Largest number of beats that can each be given a different clip (bipartite matching, augmenting paths).
// Each beat with footage needs at least one clip and no clip is shared, so (beats − this) is a lower bound on
// the stills the planner must generate, whatever the narration timing.
// Which units can each be given a different clip, in priority order: a unit listed earlier keeps its clip (Kuhn's
// augmenting paths never unmatch a unit once matched). Returns one boolean per unit.
export function matchedFlags(candidateSets) {
  const beatOfClip = new Map();
  const tryBeat = (beat, visited) => {
    for (const clip of candidateSets[beat]) {
      if (visited.has(clip)) continue;
      visited.add(clip);
      if (!beatOfClip.has(clip) || tryBeat(beatOfClip.get(clip), visited)) {
        beatOfClip.set(clip, beat);
        return true;
      }
    }
    return false;
  };
  return candidateSets.map((_, beat) => tryBeat(beat, new Set()));
}

export function maxDistinctAssignment(candidateSets) {
  return matchedFlags(candidateSets).filter(Boolean).length;
}
