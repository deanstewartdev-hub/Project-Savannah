'use strict';
// The recap montage (scene.montage) must survive the real validator, formatter and model in its given order, and reach
// the worker as beats. The approved narration must come through unchanged, and a malformed montage must be refused
// before any render request is built. Loads the real files in a sandbox, like ScriptVisualFields_Tests.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

const plan = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'first-video', 'shot-plan.json'), 'utf8'));

const SECONDS = [10, 10, 10, 10, 9];
const ON_SCREEN = ['Mystery of Blue Chefchaouen', 'Peace or pest control?', 'A commonly cited story', 'Repainted again and again', 'Your theory?'];
const VISUAL = [
  'Wide shot of the blue medina climbing a green hillside, slow pan across the rooftops',
  'Medium shot of a blue-painted alley, with a resident walking past a doorway',
  'Close-up of a blue doorway with a wooden door and steps leading up',
  'Close-up of someone touching up a blue wall with a brush, then a shot of a sunlit street',
  'Slow pan up a blue staircase to the rooftops, with street life below'
];
// The recap order the owner approved: Antelope Canyon, then Burano, then Santorini.
const RECAP = [
  { location: 'Antelope Canyon', searchKeywords: 'antelope canyon light' },
  { location: 'Burano', searchKeywords: 'burano colourful houses' },
  { location: 'Santorini', searchKeywords: 'santorini blue domes' }
];

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

function loadApps(files) {
  const sandbox = { console, Utilities: { getUuid: () => '00000000-0000-4000-8000-000000000001' }, Logger: { log: () => {} } };
  vm.createContext(sandbox);
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
  }
  return sandbox;
}

function runPipeline(source) {
  const sandbox = loadApps(['Scripts/Script_Validator.js', 'Scripts/Script_Formatter.js', 'Models/Script.js']);
  let validated;
  try {
    validated = vm.runInContext('ScriptValidator', sandbox).validate(source);
  } catch (error) {
    // The validator throws with every failure listed. Turn that into the same shape as a normal result.
    validated = { valid: false, errors: String(error.message).split('\n').slice(1).map((line) => line.replace(/^- /, '')) };
  }
  return { validated, sandbox };
}

const cases = [
  ['a three-place montage survives validator, formatter and model, in its approved order', () => {
    const source = sourceWith((scene, index) => (index === 4 ? { montage: RECAP } : {}));
    const { validated, sandbox } = runPipeline(source);
    assert.equal(validated.valid, true, 'validator accepts: ' + JSON.stringify(validated.errors || []));
    const formatted = vm.runInContext('ScriptFormatter', sandbox).format(validated);
    assert.equal(formatted.valid, true, 'formatter accepts');
    const model = vm.runInContext('ScriptModel', sandbox).fromFormattedResult(formatted, { ideaId: 'IDEA-C4EF1471', status: 'FORMATTED' });
    const parts = JSON.parse(JSON.stringify(model.scenes[4].montage));
    assert.deepEqual(parts.map((p) => p.location), ['Antelope Canyon', 'Burano', 'Santorini']);
    assert.deepEqual(parts.map((p) => p.searchKeywords), RECAP.map((p) => p.searchKeywords));
  }],
  ['two places are valid; one place, four places, a missing location and a non-list are refused with a clear message', () => {
    const two = runPipeline(sourceWith((s, i) => (i === 4 ? { montage: RECAP.slice(0, 2) } : {})));
    assert.equal(two.validated.valid, true, 'two places accepted');
    const bad = [
      [RECAP.slice(0, 1), /montage needs 2 to 3 places/],
      [[...RECAP, { location: 'Tangier' }], /montage needs 2 to 3 places/],
      [[RECAP[0], { searchKeywords: 'x' }], /montage place 2 needs a location/],
      ['Burano, Santorini', /montage must be a list of places/]
    ];
    for (const [montage, pattern] of bad) {
      const result = runPipeline(sourceWith((s, i) => (i === 4 ? { montage } : {}))).validated;
      assert.equal(result.valid, false, 'refused: ' + JSON.stringify(montage));
      assert.ok((result.errors || []).some((e) => pattern.test(e)), 'message for ' + JSON.stringify(montage) + ': ' + JSON.stringify(result.errors));
    }
  }],
  ['the approved narration is unchanged through the pipeline with a montage on scene 5', () => {
    const source = sourceWith((s, i) => (i === 4 ? { montage: RECAP } : {}));
    const { validated, sandbox } = runPipeline(source);
    const formatted = vm.runInContext('ScriptFormatter', sandbox).format(validated);
    const model = vm.runInContext('ScriptModel', sandbox).fromFormattedResult(formatted, { ideaId: 'IDEA-C4EF1471', status: 'FORMATTED' });
    plan.scenes.forEach((scene, index) => {
      assert.equal(model.scenes[index].narration, scene.narration, 'narration scene ' + scene.sceneNumber);
      assert.equal(model.scenes[index].estimatedSeconds, SECONDS[index], 'timing scene ' + scene.sceneNumber);
    });
  }],
  ['scenes without a montage keep their exact shape (no montage key added)', () => {
    const source = sourceWith(() => ({}));
    const { validated, sandbox } = runPipeline(source);
    const formatted = vm.runInContext('ScriptFormatter', sandbox).format(validated);
    const model = vm.runInContext('ScriptModel', sandbox).fromFormattedResult(formatted, { ideaId: 'IDEA-C4EF1471', status: 'FORMATTED' });
    for (const scene of model.scenes) assert.equal('montage' in scene, false);
  }],
  ['the render beats send the montage places in order, with the narration exactly as saved', () => {
    const source = sourceWith((s, i) => (i === 4 ? { montage: RECAP } : {}));
    const { validated, sandbox } = runPipeline(source);
    const formatted = vm.runInContext('ScriptFormatter', sandbox).format(validated);
    const model = vm.runInContext('ScriptModel', sandbox).fromFormattedResult(formatted, { ideaId: 'IDEA-C4EF1471', status: 'FORMATTED' });
    const providerSandbox = loadApps(['Production/VideoProcessingProvider.js']);
    const beats = vm.runInContext('buildRenderBeats', providerSandbox)({ id: 'SCR-test', title: model.title, location: '', scenes: model.scenes });
    assert.equal(beats.length, 5);
    beats.forEach((beat, index) => assert.equal(beat.text, plan.scenes[index].narration.trim(), 'beat ' + (index + 1) + ' narration unchanged'));
    assert.deepEqual(JSON.parse(JSON.stringify(beats[4].montage)), RECAP, 'the recap reaches the worker in order');
    for (const beat of beats.slice(0, 4)) assert.equal('montage' in beat, false, 'a non-recap beat has no montage key');
  }],
  ['a malformed montage stops the render request before any beat is built', () => {
    const providerSandbox = loadApps(['Production/VideoProcessingProvider.js']);
    const scenes = [{ sceneNumber: 1, narration: 'Hello there.', montage: [{ location: 'Burano' }] }];
    assert.throws(
      () => vm.runInContext('buildRenderBeats', providerSandbox)({ id: 'SCR-test', title: 'T', scenes }),
      /montage needs 2 to 3 places/
    );
    const missing = [{ sceneNumber: 1, narration: 'Hello there.', montage: [{ location: 'Burano' }, { searchKeywords: 'x' }] }];
    assert.throws(
      () => vm.runInContext('buildRenderBeats', providerSandbox)({ id: 'SCR-test', title: 'T', scenes: missing }),
      /montage place 2 needs a location/
    );
  }]
  ,
  ['reviewed clips and a labelled still survive validator, formatter, model and the render beats', () => {
    const source = sourceWith((scene, index) => {
      if (index === 0) return { labelledStill: true };
      if (index === 2) return { location: 'Burano', searchKeywords: 'burano colourful houses', approvedClips: [29918560] };
      if (index === 4) return { montage: [
        { location: 'Antelope Canyon', searchKeywords: 'antelope canyon light', approvedClips: [29510336] },
        { location: 'Burano', searchKeywords: 'burano colourful houses', approvedClips: [29918561] },
        { location: 'Santorini', searchKeywords: 'santorini blue domes', approvedClips: [32500600] }
      ] };
      return {};
    });
    const { validated, sandbox } = runPipeline(source);
    assert.equal(validated.valid, true, 'validator accepts: ' + JSON.stringify(validated.errors || []));
    const formatted = vm.runInContext('ScriptFormatter', sandbox).format(validated);
    const model = vm.runInContext('ScriptModel', sandbox).fromFormattedResult(formatted, { ideaId: 'IDEA-C4EF1471', status: 'FORMATTED' });
    assert.equal(model.scenes[0].labelledStill, true);
    assert.deepEqual(JSON.parse(JSON.stringify(model.scenes[2].approvedClips)), [29918560]);
    const providerSandbox = loadApps(['Production/VideoProcessingProvider.js']);
    const beats = vm.runInContext('buildRenderBeats', providerSandbox)({ id: 'SCR-test', title: model.title, location: '', scenes: model.scenes });
    assert.equal(beats[0].labelledStill, true, 'the labelled still reaches the worker');
    assert.deepEqual(JSON.parse(JSON.stringify(beats[2].approvedClips)), [29918560], 'the reviewed Burano clip reaches the worker');
    assert.deepEqual(JSON.parse(JSON.stringify(beats[4].montage.map((p) => p.approvedClips))), [[29510336], [29918561], [32500600]], 'each montage place keeps its reviewed clip');
    for (const beat of [beats[1], beats[3]]) {
      assert.equal('approvedClips' in beat, false, 'a beat without reviewed clips gets no key');
      assert.equal('labelledStill' in beat, false, 'a beat without a labelled still gets no key');
    }
  }],
  ['malformed reviewed clips and labelled-still combinations are refused by the validator', () => {
    const cases = [
      [(scene, i) => (i === 0 ? { approvedClips: [1.5] } : {}), /approvedClips must be a list of at most 5 positive whole Pexels clip IDs/],
      [(scene, i) => (i === 0 ? { approvedClips: [1, 2, 3, 4, 5, 6] } : {}), /at most 5 positive whole Pexels clip IDs/],
      [(scene, i) => (i === 0 ? { labelledStill: 'yes' } : {}), /labelledStill must be true or false/],
      [(scene, i) => (i === 0 ? { labelledStill: true, approvedClips: [29918560] } : {}), /labelled still, so it cannot also name approved clips/],
      [(scene, i) => (i === 4 ? { labelledStill: true, montage: [{ location: 'Burano' }, { location: 'Santorini' }] } : {}), /montage cannot be a labelled still/],
      [(scene, i) => (i === 4 ? { montage: [{ location: 'Burano', approvedClips: [0] }, { location: 'Santorini' }] } : {}), /montage place 1 approvedClips must be a list/]
    ];
    for (const [fields, pattern] of cases) {
      const result = runPipeline(sourceWith(fields)).validated;
      assert.equal(result.valid, false, 'refused');
      assert.ok((result.errors || []).some((e) => pattern.test(e)), 'message: ' + JSON.stringify(result.errors));
    }
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
console.log('Script montage: ' + (cases.length - failed) + '/' + cases.length + ' passed.');
if (failed > 0) process.exit(1);
