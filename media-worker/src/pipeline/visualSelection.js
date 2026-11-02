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
  const accepted = hasPlace
    ? evidence.locationMatch && (evidence.keywordCount === 0 || subjectHits >= 1)
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
export function selectClip(videos, beat, usedIds) {
  let best = null;
  for (const video of videos || []) {
    if (usedIds.has(video.id)) continue;
    const file = portraitFile(video);
    if (!file) continue;
    const judgement = judgeVideo(video, beat);
    if (!judgement.accepted) continue;
    const score = (judgement.evidence.locationMatch ? 10 : 0) + judgement.evidence.matchedKeywords.length;
    if (!best || score > best.score) {
      best = { score, video, file, reason: judgement.reason };
    }
  }
  if (!best) return null;
  return {
    type: "video",
    pexelsId: best.video.id,
    link: best.file.link,
    sourceUrl: best.video.url,
    sourceDurationSeconds: best.video.duration,
    reason: best.reason
  };
}

// Plans every beat in order. `search(query)` resolves to Pexels video objects. Clips are
// de-duplicated across the whole job. When no clip qualifies for a beat, the plan either
// falls back to a labelled AI still (allowAiStills) or fails with a visual-coverage error.
export async function planBeatVisuals(beats, search, options = {}) {
  const usedIds = new Set();
  const plan = [];
  for (let index = 0; index < beats.length; index += 1) {
    const beat = beats[index];
    const queries = buildSearchQueries(beat);
    const tried = [];
    let chosen = null;
    for (const query of queries) {
      tried.push(query);
      const videos = await search(query);
      chosen = selectClip(videos, beat, usedIds);
      if (chosen) {
        chosen.query = query;
        break;
      }
    }
    if (chosen) {
      usedIds.add(chosen.pexelsId);
      plan.push({ beatIndex: index, ...chosen, queriesTried: tried });
      continue;
    }
    if (!options.allowAiStills) {
      throw new VisualCoverageError(
        "No relevant footage for beat " + (index + 1) + " after queries: " + tried.join(" | "),
        index
      );
    }
    plan.push({
      beatIndex: index,
      type: "still",
      synthetic: true,
      label: "AI-generated illustration, not authentic footage",
      prompt: beat.imagePrompt || beat.visualQuery || "",
      queriesTried: tried,
      reason: "no relevant footage found; labelled AI still used"
    });
  }
  return plan;
}
