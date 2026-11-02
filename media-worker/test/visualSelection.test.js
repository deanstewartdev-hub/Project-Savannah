import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSearchQueries,
  deriveKeywords,
  slugTokens,
  judgeVideo,
  selectClip,
  planBeatVisuals,
  VisualCoverageError
} from "../src/pipeline/visualSelection.js";

// Fixture results shaped like the Pexels video search response.
function clip(id, slug, uploader = "Someone") {
  return {
    id,
    url: `https://www.pexels.com/video/${slug}-${id}/`,
    duration: 9,
    user: { name: uploader },
    video_files: [{ link: `https://videos.pexels.com/${id}.mp4`, width: 1080, height: 1920, file_type: "video/mp4" }]
  };
}

const SANTORINI_DOOR = clip(32304929, "charming-santorini-blue-door-and-white-walls");
const COLOURFUL_CAT = clip(35441957, "colorful-urban-street-with-cat-passing-by");
const CHEFCHAOUEN_ALLEY = clip(34499565, "exploring-chefchaouen-s-alluring-blue-alleys", "Earth Photart");
const CHEFCHAOUEN_STREET = clip(34499570, "strolling-through-blue-streets-of-chefchaouen", "Earth Photart");

const DOOR_BEAT = {
  text: "Some residents say the blue stands for peace.",
  visualQuery: "Close-up of a blue doorway with a wooden door and steps leading up",
  imagePrompt: "Close-up of a blue doorway",
  location: "Chefchaouen",
  searchKeywords: "blue door"
};

test("slugTokens reads the place and subject words from a Pexels URL", () => {
  assert.deepEqual(
    slugTokens("https://www.pexels.com/video/exploring-chefchaouen-s-alluring-blue-alleys-34499565/"),
    ["exploring", "chefchaouen", "alluring", "blue", "alleys"]
  );
});

test("deriveKeywords drops camera and grammar words and keeps subject words", () => {
  const words = deriveKeywords({ visualQuery: "Wide shot of the blue medina climbing a green hillside" });
  assert.deepEqual(words, ["blue", "medina", "green", "hillside"]);
});

test("explicit searchKeywords override the scene direction", () => {
  assert.deepEqual(deriveKeywords({ searchKeywords: "Blue Door", visualQuery: "a long sentence about rooftops" }), ["blue", "door"]);
});

test("buildSearchQueries puts place plus subject first and includes the place alone", () => {
  const queries = buildSearchQueries({ location: "Chefchaouen", searchKeywords: "blue door steps wall" });
  assert.equal(queries[0], "chefchaouen blue door");
  assert.ok(queries.includes("chefchaouen steps wall"), "second subject pair is tried");
  assert.ok(queries.includes("chefchaouen"), "place alone is tried");
  assert.ok(queries.every((q) => q.split(" ").length <= 4), "queries stay short");
  assert.equal(new Set(queries).size, queries.length, "no duplicate queries");
});

test("buildSearchQueries without a place uses subject words only", () => {
  const queries = buildSearchQueries({ searchKeywords: "rooftops mountains" });
  assert.deepEqual(queries, ["rooftops mountains"]);
});

test("a result about another place is rejected when the beat names a location", () => {
  const judgement = judgeVideo(SANTORINI_DOOR, DOOR_BEAT);
  assert.equal(judgement.accepted, false);
  assert.match(judgement.reason, /place name missing/);
});

test("a result that names the place and a subject word is accepted", () => {
  const judgement = judgeVideo(CHEFCHAOUEN_ALLEY, DOOR_BEAT);
  assert.equal(judgement.accepted, true);
  assert.equal(judgement.evidence.locationMatch, true);
  assert.ok(judgement.evidence.matchedKeywords.includes("blue"));
});

test("multi-word places need every word in the metadata", () => {
  const beat = { location: "Rif Mountains", searchKeywords: "blue town" };
  assert.equal(judgeVideo(clip(1, "blue-town-in-the-rif-mountains"), beat).accepted, true);
  assert.equal(judgeVideo(clip(2, "blue-town-in-the-alps"), beat).accepted, false);
});

test("without a place, at least two subject words must match", () => {
  const beat = { searchKeywords: "rooftops mountains" };
  assert.equal(judgeVideo(clip(3, "rooftops-and-mountains-view"), beat).accepted, true);
  assert.equal(judgeVideo(clip(4, "rooftops-of-a-city"), beat).accepted, false);
});

test("the reason text treats metadata as supporting evidence only", () => {
  const judgement = judgeVideo(CHEFCHAOUEN_ALLEY, DOOR_BEAT);
  assert.match(judgement.reason, /supporting evidence, not proof of location/);
});

test("selectClip returns null when every result is unrelated", () => {
  assert.equal(selectClip([SANTORINI_DOOR, COLOURFUL_CAT], DOOR_BEAT, new Set()), null);
});

test("selectClip skips clips already used by another beat", () => {
  const chosen = selectClip([CHEFCHAOUEN_ALLEY, CHEFCHAOUEN_STREET], DOOR_BEAT, new Set([CHEFCHAOUEN_ALLEY.id]));
  assert.equal(chosen.pexelsId, CHEFCHAOUEN_STREET.id);
});

test("selectClip prefers the clip with the most subject matches", () => {
  const weak = clip(10, "chefchaouen-street-view");
  const strong = clip(11, "chefchaouen-blue-door-close-up");
  const chosen = selectClip([weak, strong], DOOR_BEAT, new Set());
  assert.equal(chosen.pexelsId, 11);
});

test("planBeatVisuals tries the next query variant before giving up", async () => {
  const seen = [];
  const search = async (query) => {
    seen.push(query);
    return query === "chefchaouen" ? [CHEFCHAOUEN_STREET] : [SANTORINI_DOOR];
  };
  const plan = await planBeatVisuals([DOOR_BEAT], search);
  assert.equal(plan[0].type, "video");
  assert.equal(plan[0].query, "chefchaouen");
  assert.ok(seen.length > 1, "more than one query was searched");
  assert.deepEqual(plan[0].queriesTried, seen);
});

test("planBeatVisuals never reuses a clip across beats", async () => {
  const beats = [DOOR_BEAT, { ...DOOR_BEAT, text: "A second scene." }];
  const search = async () => [CHEFCHAOUEN_ALLEY, CHEFCHAOUEN_STREET];
  const plan = await planBeatVisuals(beats, search);
  assert.notEqual(plan[0].pexelsId, plan[1].pexelsId);
});

test("planBeatVisuals fails with a visual-coverage error when nothing is relevant", async () => {
  const search = async () => [SANTORINI_DOOR, COLOURFUL_CAT];
  await assert.rejects(
    () => planBeatVisuals([DOOR_BEAT], search, { allowAiStills: false }),
    (error) => {
      assert.ok(error instanceof VisualCoverageError);
      assert.equal(error.code, "PRODUCTION_VISUAL_COVERAGE");
      assert.equal(error.beatIndex, 0);
      return true;
    }
  );
});

test("planBeatVisuals uses a labelled AI still only when explicitly allowed", async () => {
  const search = async () => [SANTORINI_DOOR];
  const plan = await planBeatVisuals([DOOR_BEAT], search, { allowAiStills: true });
  assert.equal(plan[0].type, "still");
  assert.equal(plan[0].synthetic, true);
  assert.equal(plan[0].label, "AI-generated illustration, not authentic footage");
  assert.equal(plan[0].prompt, DOOR_BEAT.imagePrompt);
});

test("the approved Chefchaouen door scene picks the Chefchaouen clip, not the Santorini one", async () => {
  // Pexels results observed for the stored scene query (read-only check): the place-name
  // variant returns the Chefchaouen clip, and the unrelated Santorini result is never used.
  const search = async (query) => (query.startsWith("chefchaouen") ? [SANTORINI_DOOR, CHEFCHAOUEN_ALLEY] : [SANTORINI_DOOR]);
  const plan = await planBeatVisuals([DOOR_BEAT], search);
  assert.equal(plan[0].pexelsId, CHEFCHAOUEN_ALLEY.id);
});
