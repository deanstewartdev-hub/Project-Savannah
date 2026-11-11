// Pure visual-selection logic: builds short location-specific search queries, checks Pexels
// results for relevance, and plans one clip (or a labelled still) per beat. No network, no
// filesystem, so it can be tested without secrets. Pexels metadata is supporting evidence
// only: a title or uploader name that mentions the place does not prove the footage was
// filmed there, so every chosen clip still needs a human shot-list review.

// Camera and grammar words that describe a shot rather than what is in it.
const NON_SUBJECT_WORDS = new Set([
  "a", "an", "and", "the", "of", "with", "then", "from", "to", "in", "on", "at", "by", "for",
  "shot", "wide", "medium", "close", "up", "slow", "pan", "view", "views", "across", "past",
  "below", "above", "leading", "climbing", "someone", "touching", "walking", "passing", "lined"
]);

// Shot words name how a clip was filmed (camera type or motion). They never decide whether a clip is
// relevant: the place and the subject do. A clip that also shows the shot gets a small preference.
const SHOT_WORDS = new Set(["drone", "aerial", "sweeping", "overhead", "flyover", "flying", "timelapse"]);
// The shot words worth adding to a search query. Motion words such as "sweeping" are weak search terms.
const QUERY_SHOT_WORDS = ["drone", "aerial", "overhead", "flyover"];

const MAX_KEYWORDS = 4;
const MAX_QUERY_WORDS = 4;

// Landscape footage (16:9) is centre-cropped to 9:16 by the assembler. Its effective resolution is the
// width of that crop in source pixels, scaled up to the 1080-pixel output width. A crop that would need
// more than MAX_CROP_UPSCALE times upscaling (for example 720p source) is refused.
const OUTPUT_WIDTH = 1080;
export const MAX_CROP_UPSCALE = 1.8;
const LANDSCAPE_ASPECT_MIN = 1.7;
// 1.95:1 admits 2048x1080 (1.90:1) footage from Pexels. The 9:16 centre crop keeps (9/16) / aspect of the
// frame's width: 28.8% at 1.95:1. A crop keeping less than MIN_KEPT_WIDTH_FRACTION cuts out too much of the
// frame, so it is refused.
const LANDSCAPE_ASPECT_MAX = 1.95;
export const MIN_KEPT_WIDTH_FRACTION = 0.28;
// A landscape clip must be clearly more relevant than a portrait one to be chosen over it.
const LANDSCAPE_PENALTY = 3;

export class VisualCoverageError extends Error {
  constructor(message, beatIndex) {
    super(message);
    this.name = "VisualCoverageError";
    this.code = "PRODUCTION_VISUAL_COVERAGE";
    this.beatIndex = beatIndex;
  }
}

export function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1);
}

// The text a beat's keywords come from: an explicit list from the script, otherwise the scene direction.
function keywordSource(beat) {
  const explicit = Array.isArray(beat.searchKeywords)
    ? beat.searchKeywords.join(" ")
    : String(beat.searchKeywords || "");
  return explicit.trim() || String(beat.visualQuery || beat.imagePrompt || "");
}

// Keywords for search: an explicit list from the script wins; otherwise the subject words of
// the scene direction, with camera, grammar and shot words removed.
export function deriveKeywords(beat) {
  const words = [];
  for (const word of tokenize(keywordSource(beat))) {
    if (NON_SUBJECT_WORDS.has(word) || SHOT_WORDS.has(word) || words.includes(word)) continue;
    words.push(word);
    if (words.length === MAX_KEYWORDS) break;
  }
  return words;
}

// Shot words named in the beat (for example "drone" or "sweeping"), in the order they appear.
export function shotWordsFor(beat) {
  const words = [];
  for (const word of tokenize(keywordSource(beat))) {
    if (SHOT_WORDS.has(word) && !words.includes(word)) words.push(word);
  }
  return words;
}

function location(beat) {
  return tokenize(beat.location).join(" ");
}

// Ordered query variants: place plus subject first, then place plus a shot word (for example "drone"),
// then place plus a second subject pair, then the place alone. Place words are removed from the subject
// words so a query never repeats the place. Without a location, only subject-only variants are used.
export function buildSearchQueries(beat) {
  const place = location(beat);
  const placeWords = tokenize(beat.location);
  const keywords = deriveKeywords(beat).filter((word) => !placeWords.includes(word));
  const queryShots = shotWordsFor(beat).filter((word) => QUERY_SHOT_WORDS.includes(word));
  const candidates = [];
  if (place) {
    candidates.push(place + " " + keywords.slice(0, 2).join(" "));
    if (queryShots.length) candidates.push(place + " " + queryShots[0]);
    candidates.push(place + " " + keywords.slice(2, 4).join(" "));
    candidates.push(place);
  }
  candidates.push(keywords.slice(0, 3).join(" "));
  candidates.push(keywords.slice(0, 2).join(" "));

  const queries = [];
  for (const candidate of candidates) {
    const query = candidate.trim().split(/\s+/).slice(0, MAX_QUERY_WORDS).join(" ");
    if (query && !queries.includes(query)) queries.push(query);
  }
  return queries;
}

// Pexels video URLs end in "<slug>-<id>", e.g. ".../charming-streets-of-chefchaouen-34499594".
export function slugTokens(url) {
  const path = String(url || "").split("?")[0].replace(/\/+$/, "");
  const slug = path.split("/").pop().replace(/-\d+$/, "");
  return tokenize(slug.replace(/-/g, " "));
}

export function evidenceFor(video, beat) {
  const tokens = new Set([...slugTokens(video.url), ...tokenize(video.user && video.user.name)]);
  const place = tokenize(beat.location);
  const keywords = deriveKeywords(beat);
  const locationMatch = place.length === 0 ? null : place.every((word) => tokens.has(word));
  const matchedKeywords = keywords.filter((word) => tokens.has(word));
  const shotMatches = shotWordsFor(beat).filter((word) => tokens.has(word)).length;
  return { locationMatch, matchedKeywords, keywordCount: keywords.length, shotMatches };
}

// Decides whether one Pexels result is acceptable for a beat. A location is required when
// the beat names one; otherwise at least two subject words must appear in the metadata.
export function judgeVideo(video, beat) {
  const evidence = evidenceFor(video, beat);
  const hasPlace = evidence.locationMatch !== null;
  const subjectHits = evidence.matchedKeywords.length;
  const subjectNeeded = Math.min(2, evidence.keywordCount);
  // The first keyword is the scene's main subject (for example "blue"). Matching only a
  // secondary word such as "street" lets in clips of the wrong subject, so a clip must match
  // the main subject or at least two subject words.
  const primaryHit = evidence.keywordCount > 0 && evidence.matchedKeywords.includes(deriveKeywords(beat)[0]);
  const accepted = hasPlace
    ? evidence.locationMatch && (evidence.keywordCount === 0 || primaryHit || subjectHits >= 2)
    : subjectHits >= subjectNeeded && subjectNeeded > 0;
  return { accepted, evidence, reason: explain(evidence, hasPlace, accepted, beat) };
}

function explain(evidence, hasPlace, accepted, beat) {
  const place = hasPlace
    ? (evidence.locationMatch ? "place name found" : "place name missing")
    : "no place required";
  const subject = evidence.matchedKeywords.length + " of " + evidence.keywordCount + " subject words found";
  const verdict = accepted ? "accepted" : "rejected";
  return verdict + ": " + place + "; " + subject + " (Pexels metadata is supporting evidence, not proof of location)";
}

function portraitFile(video) {
  const files = (video.video_files || [])
    .filter((f) => f.height > f.width && f.file_type === "video/mp4")
    .sort((a, b) => a.width - b.width);
  return files.find((f) => f.width >= 1080) || files[files.length - 1] || null;
}

// The best 16:9 landscape file that can be centre-cropped to 9:16 without exceeding MAX_CROP_UPSCALE.
// Returns null when no file qualifies (wrong aspect ratio, or too low a resolution for a clean crop).
export function landscapeCropFile(video) {
  let best = null;
  for (const file of video.video_files || []) {
    if (file.file_type !== "video/mp4" || !(file.width > file.height)) continue;
    const aspect = file.width / file.height;
    if (aspect < LANDSCAPE_ASPECT_MIN || aspect > LANDSCAPE_ASPECT_MAX) continue;
    const cropWidth = (file.height * 9) / 16; // source pixels in the 9:16 centre crop
    const upscale = OUTPUT_WIDTH / cropWidth;
    if (upscale > MAX_CROP_UPSCALE) continue;
    const keptWidthFraction = (9 / 16) / aspect;
    if (keptWidthFraction < MIN_KEPT_WIDTH_FRACTION) continue;
    if (!best || upscale < best.upscale) best = { file, upscale, cropWidth, keptWidthFraction };
  }
  return best;
}

// How a clip can be used: portrait as it is, or (only when allowed) a landscape clip centre-cropped.
function framingFor(video, allowLandscape) {
  const portrait = portraitFile(video);
  if (portrait) return { file: portrait, framing: "portrait", cropUpscale: null };
  if (!allowLandscape) return null;
  const landscape = landscapeCropFile(video);
  return landscape
    ? { file: landscape.file, framing: "landscape-crop", cropUpscale: landscape.upscale, keptWidthFraction: landscape.keptWidthFraction }
    : null;
}

// Chooses the best acceptable, not-yet-used clip from one query's results. Returns null when
// nothing qualifies, which makes the caller try the next query variant.
// avoidUploaders: uploaders of the previous scene's footage. A clip from the same uploader is only
// chosen when nothing else qualifies, so consecutive scenes come from different sources.
// allowLandscape: also accept 16:9 clips that pass the crop checks (portrait clips are still preferred).
export function selectClip(videos, beat, usedIds, minSeconds = 0, avoidUploaders = null, avoidTokens = null, allowLandscape = false) {
  let best = null;
  for (const video of videos || []) {
    if (usedIds.has(video.id)) continue;
    if (Number(video.duration) < minSeconds) continue;
    const framing = framingFor(video, allowLandscape);
    if (!framing) continue;
    const judgement = judgeVideo(video, beat);
    if (!judgement.accepted) continue;
    const uploader = video.user && video.user.name ? String(video.user.name) : "";
    const repeatsUploader = avoidUploaders && uploader && avoidUploaders.has(uploader);
    // Near-identical footage: most of this clip's descriptive words also describe the previous scene.
    const tokens = slugTokens(video.url);
    const overlap = avoidTokens && tokens.length
      ? tokens.filter((t) => avoidTokens.has(t)).length / tokens.length
      : 0;
    const nearDuplicate = overlap >= 0.5;
    const score = (judgement.evidence.locationMatch ? 10 : 0) +
      judgement.evidence.matchedKeywords.length +
      judgement.evidence.shotMatches -
      (framing.framing === "landscape-crop" ? LANDSCAPE_PENALTY : 0) -
      (nearDuplicate ? 4 : 0) -
      (repeatsUploader ? 5 : 0);
    if (!best || score > best.score) {
      best = { score, video, framing, uploader, reason: judgement.reason };
    }
  }
  if (!best) return null;
  const reason = best.framing.framing === "landscape-crop"
    ? best.reason + "; landscape footage centre-cropped to 9:16 (crop upscale " + best.framing.cropUpscale.toFixed(2) + "x, keeps " +
      Math.round(best.framing.keptWidthFraction * 100) + "% of the width)"
    : best.reason;
  return {
    type: "video",
    pexelsId: best.video.id,
    link: best.framing.file.link,
    sourceUrl: best.video.url,
    sourceDurationSeconds: best.video.duration,
    uploader: best.uploader,
    tokens: slugTokens(best.video.url),
    framing: best.framing.framing,
    cropUpscale: best.framing.cropUpscale,
    reason
  };
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

// Prompt for a labelled AI still. It always names the beat's location (a still for a Burano line must show
// Burano, not a generic town) and asks for one real scene, so the image cannot become a collage or a title card.
export function stillPrompt(beat) {
  const subject = String(beat.imagePrompt || beat.visualQuery || "").trim();
  const place = String(beat.location || "").trim();
  const parts = [];
  if (place && !subject.toLowerCase().includes(place.toLowerCase())) parts.push("Location: " + place);
  if (subject) parts.push(subject);
  parts.push("One real scene, a single vertical 9:16 photograph, realistic. No collage, no split screen, no text, no logos.");
  return parts.join(". ");
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

// A montage beat lists parts, each with its own place and keywords. Every part gets its own clip, with an equal
// share of the beat's seconds. A beat whose parts lack a clip fails, and then becomes a still as usual.
export function montagePartBeat(part) {
  const keywords = String(part.searchKeywords || "").trim();
  const place = String(part.location || "").trim();
  return {
    location: place,
    searchKeywords: keywords,
    visualQuery: keywords || place,
    imagePrompt: keywords || place
  };
}

async function collectMontage(beat, ctx) {
  const { usedIds, candidates, avoid, avoidWords, tried, landscapeFallback } = ctx;
  const parts = beat.montage;
  const share = (beat.coverSeconds || 0) / parts.length;
  const segments = [];
  for (const part of parts) {
    const partBeat = montagePartBeat(part);
    const queries = buildSearchQueries(partBeat);
    const partUsedBefore = new Set(usedIds);
    const pass = (allowLandscape) => collectFootage(partBeat, queries, share, {
      usedIds, usedBefore: partUsedBefore, candidates, avoid, avoidWords, allowLandscape, tried
    });
    let found = await pass(false);
    if (!footageCovers(found, share) && landscapeFallback) {
      releaseSegments(found.segments, usedIds);
      found = await pass(true);
    }
    if (!footageCovers(found, share)) {
      releaseSegments(found.segments, usedIds);
      releaseSegments(segments, usedIds);
      return { segments: [], covered: 0, ok: false };
    }
    segments.push(...found.segments);
  }
  return { segments, covered: segments.reduce((sum, s) => sum + s.sourceDurationSeconds, 0), ok: true };
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
    const queries = buildSearchQueries(beat);
    const tried = [];
    const usedBefore = new Set(usedIds);
    const pass = (allowLandscape) => collectFootage(beat, queries, needed, {
      usedIds, usedBefore, candidates, avoid, avoidWords, allowLandscape, tried
    });

    let found;
    if (Array.isArray(beat.montage) && beat.montage.length > 0) {
      found = await collectMontage(beat, { usedIds, candidates, avoid, avoidWords, tried, landscapeFallback });
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
    if (Array.isArray(beat.montage) && beat.montage.length > 0) {
      // A montage needs a clip for every part. Missing one part makes the whole beat unsupported.
      const subs = await coverageCandidates(beat.montage.map(montagePartBeat), search, options);
      const union = new Set();
      for (const sub of subs) for (const id of sub.candidateIds) union.add(id);
      const complete = subs.every((sub) => sub.candidateIds.size > 0);
      coverage.push({
        beatIndex: index,
        queriesTried: subs.flatMap((sub) => sub.queriesTried),
        candidateIds: complete ? union : new Set()
      });
      continue;
    }
    const tried = [];
    const candidateIds = new Set();
    for (const query of buildSearchQueries(beat)) {
      tried.push(query);
      const videos = [
        ...(await cachedSearch(query, "portrait")),
        ...(landscapeFallback ? await cachedSearch(query, "landscape") : [])
      ];
      for (const video of videos) {
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
export function maxDistinctAssignment(candidateSets) {
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
  let matched = 0;
  for (let beat = 0; beat < candidateSets.length; beat += 1) {
    if (tryBeat(beat, new Set())) matched += 1;
  }
  return matched;
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
