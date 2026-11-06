import test from "node:test";
import assert from "node:assert/strict";
import { stillPrompt } from "../src/pipeline/visualSelection.js";

// Regression: an AI still for a Burano line came back as a generic street, and the ending came back as a
// London/Bali/New York collage. The prompt must name the beat's place and ask for one real scene.

test("the still prompt names the beat's location when the subject does not already contain it", () => {
  const prompt = stillPrompt({ location: "Burano, Italy", visualQuery: "colourful houses along a canal" });
  assert.ok(prompt.includes("Location: Burano, Italy"));
  assert.ok(prompt.includes("colourful houses along a canal"));
});

test("the still prompt does not repeat a location the subject already names", () => {
  const prompt = stillPrompt({ location: "Burano", visualQuery: "Burano canal at dusk" });
  assert.equal(prompt.split("Location:").length - 1, 0);
  assert.ok(prompt.includes("Burano canal at dusk"));
});

test("every still prompt asks for one real scene and forbids collages and text", () => {
  const prompt = stillPrompt({ location: "Santorini, Greece", imagePrompt: "whitewashed village above the sea" });
  assert.ok(prompt.includes("One real scene"));
  assert.ok(prompt.includes("No collage"));
  assert.ok(prompt.includes("no text"));
});
