// Search-query building for a beat: tokenising, subject keywords, shot words, the ordered query
// variants sent to Pexels, and the prompt for a labelled AI still. Pure: no network, no filesystem.
// Split out of visualSelection.js (modular refactor, November 2026); the code is unchanged.
// Import from visualSelection.js, which re-exports this module's public names.

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
