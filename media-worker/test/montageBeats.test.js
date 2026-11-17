import test from "node:test";
import assert from "node:assert/strict";
import { validateBeats } from "../src/lib/validateBeats.js";
import { montageError, MONTAGE_MAX_PARTS, MONTAGE_MIN_PARTS } from "../src/pipeline/visualSelection.js";

const RECAP_PARTS = [
  { location: "Antelope Canyon", searchKeywords: "antelope canyon light" },
  { location: "Burano", searchKeywords: "burano colourful houses" },
  { location: "Santorini", searchKeywords: "santorini blue domes" }
];

function beatWith(montage) {
  return { text: "You'd be mad to miss these gems!", visualQuery: "A collage of all three locations", imagePrompt: "recap", location: "", montage };
}

test("the default recap order is Antelope Canyon, Burano, then Santorini, and it passes validation", () => {
  assert.equal(validateBeats([beatWith(RECAP_PARTS)]), null);
  assert.deepEqual(RECAP_PARTS.map((part) => part.location), ["Antelope Canyon", "Burano", "Santorini"]);
});

test("a beat without a montage is unchanged by validation", () => {
  assert.equal(validateBeats([{ text: "Plain.", visualQuery: "a view", imagePrompt: "a view", location: "Burano" }]), null);
});

test("montage sizes: two or three places are allowed, one or four are refused", () => {
  assert.equal(MONTAGE_MIN_PARTS, 2);
  assert.equal(MONTAGE_MAX_PARTS, 3);
  assert.equal(montageError(RECAP_PARTS.slice(0, 2)), null);
  assert.equal(montageError(RECAP_PARTS), null);
  assert.match(montageError(RECAP_PARTS.slice(0, 1)), /needs 2 to 3 places/);
  assert.match(montageError([...RECAP_PARTS, { location: "Tangier" }]), /needs 2 to 3 places/);
});

test("a place without a location is refused, with the place number in the message", () => {
  assert.match(montageError([RECAP_PARTS[0], { location: "   " }]), /montage place 2 needs a location/);
  assert.match(validateBeats([beatWith([RECAP_PARTS[0], { searchKeywords: "x" }])]), /beats\[0\]\.montage place 2 needs a location/);
});

test("over-long fields and non-text keywords are refused", () => {
  assert.match(montageError([RECAP_PARTS[0], { location: "x".repeat(61) }]), /longer than 60/);
  assert.match(montageError([RECAP_PARTS[0], { location: "Burano", searchKeywords: "k".repeat(81) }]), /at most 80/);
  assert.match(montageError([RECAP_PARTS[0], { location: "Burano", searchKeywords: 7 }]), /at most 80/);
});

test("a montage that is not a list is refused", () => {
  assert.match(montageError("Antelope Canyon, Burano, Santorini"), /must be a list/);
  assert.match(validateBeats([beatWith({ location: "Burano" })]), /must be a list/);
});

test("the montage fields survive as given: part order and keywords are not rewritten by validation", () => {
  const beats = [beatWith(RECAP_PARTS)];
  assert.equal(validateBeats(beats), null);
  assert.deepEqual(beats[0].montage, RECAP_PARTS);
});
