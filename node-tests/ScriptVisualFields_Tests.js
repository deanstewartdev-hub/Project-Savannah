'use strict';
// The optional visual-search fields (location, searchKeywords) must survive the real validator,
// formatter and model, and the approved narration must come through unchanged. Scenes without the
// fields must keep their exact shape.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

const plan = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'first-video', 'shot-plan.json'), 'utf8'));

const VISUAL = [
  'Wide shot of the blue medina climbing a green hillside, slow pan across the rooftops',
  'Medium shot of a blue-painted alley, with a resident walking past a doorway',
  'Close-up of a blue doorway with a wooden door and steps leading up',
  'Close-up of someone touching up a blue wall with a brush, then a shot of a sunlit street',
  'Slow pan up a blue staircase to the rooftops, with street life below'
];
const ON_SCREEN = ['Mystery of Blue Chefchaouen', 'Peace or pest control?', 'A commonly cited story', 'Repainted again and again', 'Your theory?'];
const SECONDS = [10, 10, 10, 10, 9];

function sourceWith(sceneFields) {
  const scenes = plan.scenes.map((scene, index) => Object.assign({
    sceneNumber: scene.sceneNumber,
    narration: scene.narration,
    onScreenText: ON_SCREEN[index],
    visualDirection: VISUAL[index],
    estimatedSeconds: SECONDS[index]
  }, sceneFields(scene, index)));
  return {
    title: 'The Mystery of Morocco\'s Blue City',
    hook: 'In Morocco\'s Rif Mountains, a whole town is painted blue, and nobody agrees why.',
    voiceoverScript: plan.scenes.map((s) => s.narration).join(' '),
    scenes: scenes,
    callToAction: 'Tell me your theory in the comments.',
    estimatedDurationSeconds: SECONDS.reduce((a, b) => a + b, 0),
    generationNotes: ''
  };
}

function runPipeline(source) {
  const sandbox = { console, Utilities: { getUuid: () => '00000000-0000-4000-8000-000000000001' }, Logger: { log: () => {} } };
  vm.createContext(sandbox);
  for (const file of ['Scripts/Script_Validator.js', 'Scripts/Script_Formatter.js', 'Models/Script.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
  }
  const validated = vm.runInContext('ScriptValidator', sandbox).validate(source);
  assert.equal(validated.valid, true, 'validator accepts the source: ' + JSON.stringify(validated.errors || []));
  const formatted = vm.runInContext('ScriptFormatter', sandbox).format(validated);
  assert.equal(formatted.valid, true, 'formatter accepts the validated source');
  const model = vm.runInContext('ScriptModel', sandbox).fromFormattedResult(formatted, { ideaId: 'IDEA-C4EF1471', status: 'FORMATTED' });
  return { validated, formatted, model };
}

const cases = [
  ['the visual fields survive validator, formatter and model for every scene', () => {
    const source = sourceWith((scene) => ({ location: 'Chefchaouen', searchKeywords: scene.searchKeywords }));
    const { validated, formatted, model } = runPipeline(source);
    for (const [index, scene] of plan.scenes.entries()) {
      assert.equal(validated.script.scenes[index].location, 'Chefchaouen', 'validator keeps location');
      assert.equal(formatted.script.scenes[index].location, 'Chefchaouen', 'formatter keeps location');
      assert.equal(formatted.script.scenes[index].searchKeywords, scene.searchKeywords, 'formatter keeps searchKeywords');
      assert.equal(model.scenes[index].location, 'Chefchaouen', 'model keeps location');
      assert.equal(model.scenes[index].searchKeywords, scene.searchKeywords, 'model keeps searchKeywords');
    }
  }],
  ['the approved narration is unchanged through the pipeline', () => {
    const source = sourceWith((scene) => ({ location: 'Chefchaouen', searchKeywords: scene.searchKeywords }));
    const { model } = runPipeline(source);
    plan.scenes.forEach((scene, index) => {
      assert.equal(model.scenes[index].narration, scene.narration, 'narration scene ' + scene.sceneNumber);
      assert.equal(model.scenes[index].estimatedSeconds, SECONDS[index], 'timing scene ' + scene.sceneNumber);
    });
  }],
  ['scenes without the fields keep their exact shape (no empty keys added)', () => {
    const source = sourceWith(() => ({}));
    const { model } = runPipeline(source);
    for (const scene of model.scenes) {
      assert.equal('location' in scene, false);
      assert.equal('searchKeywords' in scene, false);
    }
  }],
  ['blank visual fields are dropped rather than stored as empty strings', () => {
    const source = sourceWith(() => ({ location: '   ', searchKeywords: '' }));
    const { model } = runPipeline(source);
    assert.equal('location' in model.scenes[0], false);
    assert.equal('searchKeywords' in model.scenes[0], false);
  }]
];

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log('PASS ' + name);
  } catch (error) {
    failed += 1;
    console.log('FAIL ' + name + ': ' + error.message);
  }
}
console.log('Script visual fields: ' + (cases.length - failed) + '/' + cases.length + ' passed.');
if (failed > 0) process.exit(1);
