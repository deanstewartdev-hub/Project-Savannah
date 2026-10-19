const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../Production/ScenePlan_Service.js'), 'utf8'), context);
const service = vm.runInContext('ScenePlanService', context);
function script(wordsPerScene) {
  const scenes = Array.from({ length: 4 }, (_, i) => ({
    sceneNumber: i + 1,
    narration: Array(wordsPerScene).fill('travel').join(' ') + '.',
    visualDirection: 'A mountain trail'
  }));
  return { id: 'duration-test', title: 'Travel', scenes,
    voiceoverScript: scenes.map(s => s.narration).join(' ') };
}
for (const [words, expected, warnings] of [[10, 20, 1], [15, 30, 0], [20, 40, 0], [30, 60, 0], [40, 80, 1]]) {
  test(`estimate of ${expected}s is advisory with ${warnings} warnings`, () => {
    const input = script(words);
    const plan = service.create(input);
    assert.equal(plan.expectedDurationSeconds, expected);
    assert.equal(plan.warnings.length, warnings);
    assert.equal(plan.slots.map(s => s.narration).join(' '), input.voiceoverScript);
    const fitted = service.fitToDuration(plan, 40);
    assert.equal(fitted.expectedDurationSeconds, 40);
    assert.equal(fitted.estimatedDurationSeconds, expected);
    assert.equal(fitted.slots.reduce((sum, s) => sum + s.expectedDurationSeconds, 0), 40);
    assert.equal(plan.expectedDurationSeconds, expected);
  });
}
for (const duration of [0, 29, 61, NaN, Infinity, -Infinity, 'invalid']) {
  test(`invalid measured total ${duration} is blocked`, () => {
    assert.throws(() => service.fitToDuration(service.create(script(20)), duration), /Measured narration duration/);
  });
}
for (const duration of [30, 60]) {
  test(`measured ${duration}s boundary is accepted in both audio paths`, () => {
    const plan = service.create(script(40));
    assert.equal(service.fitToDuration(plan, duration).expectedDurationSeconds, duration);
    assert.equal(service.fitToSlotDurations(plan, Array(4).fill(duration / 4)).expectedDurationSeconds, duration);
  });
}
for (const durations of [[10,10,10,NaN], [10,10,10,Infinity], [10,10,10,0], [5,5,5,5], [20,20,20,20]]) {
  test(`invalid measured scene timings ${durations} are blocked`, () => {
    assert.throws(() => service.fitToSlotDurations(service.create(script(20)), durations), /duration/);
  });
}
test('invalid estimate cannot produce non-finite fitted timing', () => {
  const plan = service.create(script(20));
  for (const expectedDurationSeconds of [0, -1, NaN, Infinity]) {
    assert.throws(() => service.fitToDuration({ ...plan, expectedDurationSeconds }, 40), /valid estimated duration/);
  }
});
test('missing narration and incomplete plans remain invalid', () => {
  assert.throws(() => service.create({ id: 'empty', scenes: [] }), /voiceover/);
  assert.throws(() => service.fitToDuration({ slots: [] }, 40), /four-slot/);
  assert.throws(() => service.fitToSlotDurations(service.create(script(20)), [10]), /Four measured/);
});
test('legacy render reaches audio measurement despite a short estimate, then rejects short audio before visuals', () => {
  let audioCalls = 0;
  let visualCalls = 0;
  const sandbox = vm.createContext({
    VoiceoverService: { prepareSceneAudio() {
      audioCalls++;
      return Array(4).fill({ durationSeconds: 5 });
    } },
    VisualAssetService: { prepareSceneVisuals() { visualCalls++; } }
  });
  for (const file of ['ScenePlan_Service.js', 'Creatomate_Service.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../Production', file), 'utf8'), sandbox);
  }
  const renderer = vm.runInContext('CreatomateService', sandbox);
  assert.throws(() => renderer.createRender(script(10), {}), /Measured narration duration is 20/);
  assert.equal(audioCalls, 1);
  assert.equal(visualCalls, 0);
});
