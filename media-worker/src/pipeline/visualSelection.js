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

const MAX_KEYWORDS = 4;
const MAX_QUERY_WORDS = 4;

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

// Keywords for search: an explicit list from the script wins; otherwise the subject words of
// the scene direction, with camera and grammar words removed.
export function deriveKeywords(beat) {
  const explicit = Array.isArray(beat.searchKeywords)
    ? beat.searchKeywords.join(" ")
    : String(beat.searchKeywords || "");
  const source = explicit.trim() || String(beat.visualQuery || beat.imagePrompt || "");
  const words = [];
  for (const word of tokenize(source)) {
    if (NON_SUBJECT_WORDS.has(word) || words.includes(word)) continue;
    words.push(word);
    if (words.length === MAX_KEYWORDS) break;
  }
  return words;
}

function location(beat) {
  return tokenize(beat.location).join(" ");
}

// Ordered query variants: place plus subject first, then place plus a second subject, then
// the place alone. Without a location, only subject-only variants are used.
export function buildSearchQueries(beat) {
  const place = location(beat);
  const keywords = deriveKeywords(beat);
  const candidates = [];
  if (place) {
    candidates.push(place + " " + keywords.slice(0, 2).join(" "));
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
  return { locationMatch, matchedKeywords, keywordCount: keywords.length };
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

// Chooses the best acceptable, not-yet-used clip from one query's results. Returns null when
// nothing qualifies, which makes the caller try the next query variant.
// avoidUploaders: uploaders of the previous scene's footage. A clip from the same uploader is only
// chosen when nothing else qualifies, so consecutive scenes come from different sources.
export function selectClip(videos, beat, usedIds, minSeconds = 0, avoidUploaders = null, avoidTokens = null) {
  let best = null;
  for (const video of videos || []) {
    if (usedIds.has(video.id)) continue;
    if (Number(video.duration) < minSeconds) continue;
    const file = portraitFile(video);
    if (!file) continue;
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
    const score = (judgement.evidence.locationMatch ? 10 : 0) + judgement.evidence.matchedKeywords.length -
      (nearDuplicate ? 4 : 0) -
      (repeatsUploader ? 5 : 0);
    if (!best || score > best.score) {
      best = { score, video, file, uploader, reason: judgement.reason };
    }
  }
  if (!best) return null;
  return {
    type: "video",
    pexelsId: best.video.id,
    link: best.file.link,
    sourceUrl: best.video.url,
    sourceDurationSeconds: best.video.duration,
    uploader: best.uploader,
    tokens: slugTokens(best.video.url),
    reason: best.reason
  };
}

// Plans every beat in order. `search(query)` resolves to Pexels video objects. Clips are
// de-duplicated across the whole job. When no clip qualifies for a beat, the plan either
// falls back to a labelled AI still (allowAiStills) or fails with a visual-coverage error.
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

// Plans every beat in order. `search(query)` resolves to Pexels video objects. A beat with
// `coverSeconds` collects clips until their durations cover it. When a beat cannot be covered
// with relevant footage, the plan either falls back to a labelled AI still (allowAiStills)
// or fails with a visual-coverage error.
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

export async function planBeatVisuals(beats, search, options = {}) {
  const usedIds = new Set();
  const cache = new Map();
  const cachedSearch = async (query) => {
    if (!cache.has(query)) cache.set(query, await search(query));
    return cache.get(query);
  };

  const plan = [];
  for (let index = 0; index < beats.length; index += 1) {
    const beat = beats[index];
    const avoid = previousUploaders(plan);
    const avoidWords = previousTokens(plan);
    const needed = beat.coverSeconds || 0;
    const queries = buildSearchQueries(beat);
    const tried = [];
    const segments = [];
    const usedBeforeBeat = new Set(usedIds);
    let covered = 0;

    // First choice: one clip long enough for the whole beat, so the beat needs no cut.
    if (needed > 0) {
      for (const query of queries) {
        tried.push(query);
        const chosen = selectClip(await cachedSearch(query), beat, usedIds, needed, avoid, avoidWords);
        if (chosen) {
          chosen.query = query;
          segments.push(chosen);
          usedIds.add(chosen.pexelsId);
          covered = chosen.sourceDurationSeconds;
          break;
        }
      }
    }

    // Otherwise, several clips. Every cut except one that finishes the beat must be at least
    // MIN_CUT_SECONDS long, so the video has no flashes of a fraction of a second.
    if (needed > 0 && covered < needed) {
      segments.length = 0;
      usedIds.clear();
      for (const id of usedBeforeBeat) usedIds.add(id);
      covered = 0;
      for (const query of queries) {
        while (segments.length < MAX_SEGMENTS_PER_BEAT && covered < needed) {
          const chosen = selectClip(await cachedSearch(query), beat, usedIds, MIN_CUT_SECONDS, avoid, avoidWords);
          if (!chosen) break;
          chosen.query = query;
          segments.push(chosen);
          usedIds.add(chosen.pexelsId);
          covered += chosen.sourceDurationSeconds;
        }
        if (!tried.includes(query)) tried.push(query);
        if (covered >= needed) break;
      }
    }

    if (needed === 0) {
      for (const query of queries) {
        tried.push(query);
        const chosen = selectClip(await cachedSearch(query), beat, usedIds, 0, avoid, avoidWords);
        if (chosen) {
          chosen.query = query;
          segments.push(chosen);
          usedIds.add(chosen.pexelsId);
          break;
        }
      }
    }

    const coverageOk = needed === 0
      ? segments.length > 0
      : segmentLengths(segments.map((s) => s.sourceDurationSeconds), needed) !== null;
    if (coverageOk) {
      plan.push({
        beatIndex: index,
        type: "video",
        segments,
        queriesTried: tried,
        reason: segments.map((s) => s.reason).join(" / ")
      });
      continue;
    }

    // Release clips picked for this beat: the beat is not using them.
    for (const segment of segments) usedIds.delete(segment.pexelsId);
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
