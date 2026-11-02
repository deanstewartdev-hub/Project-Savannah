// Dry run for adding visual-only search fields to the saved Chefchaouen script scenes.
//
// Read-only with respect to production: it reads an exported copy of the stored scene JSON,
// writes a backup copy, a proposed copy and a diff into an output folder, and checks that only
// `location` and `searchKeywords` change. It never writes to the Scripts sheet.
//
// Usage:
//   node tools/first-video/visual-fields-dry-run.mjs <exported-scenes.json> <output-folder>
//
// The exported file may be a bare scene array or an object with a `scenes` array.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const plan = JSON.parse(readFileSync(join(here, "shot-plan.json"), "utf8"));

const [inputPath, outDir] = process.argv.slice(2);
if (!inputPath || !outDir) {
  console.error("Usage: node visual-fields-dry-run.mjs <exported-scenes.json> <output-folder>");
  process.exit(1);
}

const raw = readFileSync(inputPath, "utf8");
const parsed = JSON.parse(raw);
const scenes = Array.isArray(parsed) ? parsed : parsed.scenes;
if (!Array.isArray(scenes) || scenes.length !== plan.scenes.length) {
  console.error("Expected " + plan.scenes.length + " scenes, found " + (scenes ? scenes.length : "none") + ".");
  process.exit(2);
}

// Protected fields: must be byte-identical before and after.
const PROTECTED = ["sceneNumber", "narration", "onScreenText", "estimatedSeconds", "visualDirection"];

const after = scenes.map((scene, index) => {
  const shot = plan.scenes.find((s) => s.sceneNumber === scene.sceneNumber);
  if (!shot) throw new Error("No shot plan for scene " + scene.sceneNumber);
  if (shot.narration !== scene.narration) {
    throw new Error("Narration differs from the approved plan in scene " + scene.sceneNumber + "; stop.");
  }
  return { ...scene, location: shot.location, searchKeywords: shot.searchKeywords };
});

const problems = [];
scenes.forEach((before, index) => {
  for (const key of PROTECTED) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[index][key])) {
      problems.push("scene " + before.sceneNumber + ": " + key + " changed");
    }
  }
  const extraKeys = Object.keys(after[index]).filter((k) => !(k in before));
  if (extraKeys.length !== 2 || !extraKeys.includes("location") || !extraKeys.includes("searchKeywords")) {
    problems.push("scene " + before.sceneNumber + ": unexpected new fields " + extraKeys.join(", "));
  }
});
if (problems.length > 0) {
  console.error("Dry run failed:\n" + problems.join("\n"));
  process.exit(3);
}

mkdirSync(outDir, { recursive: true });
const beforePath = join(outDir, "before.json");
const afterPath = join(outDir, "after.json");
copyFileSync(inputPath, join(outDir, "backup-original.json"));
writeFileSync(beforePath, JSON.stringify(scenes, null, 2) + "\n");
writeFileSync(afterPath, JSON.stringify(after, null, 2) + "\n");

const diff = [];
scenes.forEach((before, index) => {
  diff.push("Scene " + before.sceneNumber + ":");
  diff.push("  + location: " + JSON.stringify(after[index].location));
  diff.push("  + searchKeywords: " + JSON.stringify(after[index].searchKeywords));
});
writeFileSync(join(outDir, "diff.txt"), diff.join("\n") + "\n");

console.log("Dry run passed: " + scenes.length + " scenes; protected fields unchanged.");
console.log(diff.join("\n"));
console.log("Outputs in " + outDir + " (nothing written to production).");
