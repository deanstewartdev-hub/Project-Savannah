/****************************************************
 * Project Savannah - ScriptValidator characterisation suite (refactoring safety net)
 *
 * Pins every validation rule in Scripts/Script_Validator.js so its scene rules and text-quality
 * rules can be moved into focused modules with proof that the same scripts are accepted and
 * rejected, with the same messages in the same order.
 *
 * Each scenario starts from one script the validator accepts and changes one thing. The result
 * (the accepted, normalised script, or the full list of rejection messages) is compared with
 * node-tests/fixtures/script-validator.json, captured before the split. Pure logic: no AI call,
 * no sheet, no network.
 *
 * Run with: node node-tests/ScriptValidatorCharacterization_Tests.js
 * Regenerate (deliberately, never to make a failure pass): add --update
 ****************************************************/
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { root, createSandbox, settle } = require('./lib/characterization.cjs');

// Every Scripts/Script_Validator*.js file, so focused modules split out later are loaded too.
const validatorFiles = fs.readdirSync(path.join(root, 'Scripts'))
  .filter(name => /^Script_Validator.*\.js$/.test(name))
  .sort()
  .map(name => 'Scripts/' + name);

function words(count, prefix) {
  const out = [];
  for (let i = 0; i < count; i++) out.push((prefix || 'word') + i);
  return out;
}
function sentences(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size).join(' ') + '.');
  return out.join(' ');
}
function scene(sceneNumber, wordCount) {
  return {
    sceneNumber,
    narration: sentences(words(wordCount, 's' + sceneNumber + 'w'), 8),
    onScreenText: 'Fact ' + sceneNumber,
    visualDirection: 'Concrete visual detail for scene ' + sceneNumber,
    estimatedSeconds: Math.round((wordCount / 2.3) * 100) / 100
  };
}
function validScript(wordCounts) {
  const counts = wordCounts || [20, 25, 25, 20, 20];
  const scenes = counts.map((count, index) => scene(index + 1, count));
  const total = counts.reduce((sum, count) => sum + count, 0);
  return {
    title: 'A Test Script',
    hook: scenes[0].narration.split(' ').slice(0, 7).join(' '),
    voiceoverScript: 'The AI wrote its own voiceover here, which the validator must not trust.',
    scenes,
    callToAction: 'Follow for more facts.',
    estimatedDurationSeconds: Math.round((total / 2.3) * 100) / 100,
    generationNotes: ''
  };
}

const record = {};
function scenario(name, script, options) {
  const sandbox = createSandbox({});
  sandbox.load(validatorFiles);
  sandbox.context.__script = script;
  sandbox.context.__options = options;
  record[name] = sandbox.observe('ScriptValidator.validate(' +
    (script === undefined ? '' : 'JSON.parse(JSON.stringify(__script === undefined ? null : __script))') +
    (options === undefined ? '' : ', __options') + ')');
}
// Changes one thing about the accepted script.
function mutated(name, change, options, wordCounts) {
  const script = validScript(wordCounts);
  change(script);
  scenario(name, script, options);
}
const longSentence = count => words(count, 'long').join(' ') + '.';

// --- the accepted script and whole-script problems --------------------------------
scenario('accepted: five scenes, 110 words', validScript());
scenario('accepted: four scenes', validScript([25, 25, 25, 25]));
scenario('accepted: six scenes', validScript([15, 15, 20, 20, 20, 20]));
scenario('rejected: null', null);
scenario('rejected: a string', 'script text');
scenario('rejected: a number', 7);
scenario('rejected: an empty object', {});
scenario('rejected: an array', []);

// --- required strings -------------------------------------------------------------------
for (const field of ['title', 'hook', 'voiceoverScript', 'callToAction']) {
  mutated(field + ': missing', s => { delete s[field]; });
  mutated(field + ': blank', s => { s[field] = '   '; });
  mutated(field + ': not text', s => { s[field] = 42; });
}
mutated('generationNotes: missing', s => { delete s.generationNotes; });
mutated('generationNotes: null', s => { s.generationNotes = null; });
mutated('generationNotes: padded text is trimmed', s => { s.generationNotes = '  a note  '; });
mutated('title and call to action are trimmed', s => { s.title = '  Padded Title  '; s.callToAction = '  Follow now.  '; });

// --- word count (counted from scene narration) ---------------------------------
for (const [label, counts] of [['89', [20, 20, 20, 15, 14]], ['90', [20, 20, 20, 15, 15]], ['99', [20, 20, 20, 20, 19]], ['100', [20, 20, 20, 20, 20]],
  ['120', [24, 24, 24, 24, 24]], ['121', [25, 24, 24, 24, 24]], ['130', [26, 26, 26, 26, 26]], ['131', [27, 26, 26, 26, 26]]]) {
  scenario('words: ' + label, validScript(counts));
}
mutated('words: custom minimum 120', () => {}, { minimumWordCount: 120 });
mutated('words: custom maximum 100', () => {}, { maximumWordCount: 100 });

// --- narration cadence ------------------------------------------------------------------
mutated('cadence: one 23-word sentence', s => { s.scenes[1].narration = longSentence(23) + ' ' + sentences(words(2, 'tail'), 8); });
mutated('cadence: many long sentences', s => { s.scenes.forEach(sc => { sc.narration = longSentence(23); }); }, undefined, [23, 23, 23, 23, 23]);
mutated('cadence: custom sentence limit', () => {}, { maximumSentenceWordCount: 6 });
mutated('cadence: custom long-sentence share', s => { s.scenes[0].narration = longSentence(23); }, { maximumLongSentenceShare: 0.5 });

// --- markdown and placeholders ----------------------------------------------------------
for (const [label, text] of [['bold', 'This is **bold** text.'], ['heading', '# A heading here.'], ['list', '- a list item here.'], ['code', 'Some `code` here.'],
  ['link', 'See [this link](https://example.com) now.'], ['underscore emphasis', 'This is _emphasis_ here.'], ['numbered list', '1. first item here.']]) {
  mutated('markdown: ' + label + ' in narration', s => { s.scenes[2].narration = text + ' ' + s.scenes[2].narration; });
}
mutated('markdown: code fence in narration', s => { s.scenes[2].narration = 'Run this ```code``` now. ' + s.scenes[2].narration; });
mutated('markdown: heading at the very start of the narration', s => { s.scenes[0].narration = '## ' + s.scenes[0].narration; });
mutated('markdown: heading on a new line inside a scene', s => { s.scenes[2].narration = s.scenes[2].narration + String.fromCharCode(10) + '### A heading here.'; });
for (const text of ['TBD', 'todo', 'insert fact', 'Insert Statistic', 'placeholder', 'example text', 'Lorem ipsum']) {
  mutated('placeholder: "' + text + '" in narration', s => { s.scenes[1].narration = 'Here is ' + text + ' for you. ' + s.scenes[1].narration; });
}
mutated('placeholder: in the title', s => { s.title = 'TBD title'; });
mutated('placeholder: in the hook', s => { s.hook = 'placeholder ' + s.hook; });
mutated('placeholder: in the call to action', s => { s.callToAction = 'TODO follow.'; });
mutated('placeholder: in on-screen text', s => { s.scenes[0].onScreenText = 'TBD'; });
mutated('placeholder: in a visual direction', s => { s.scenes[0].visualDirection = 'Lorem ipsum visual detail here'; });
mutated('placeholder: word inside another word is fine', s => { s.title = 'Mastodon habits'; });

// --- scenes -------------------------------------------------------------------------------
mutated('scenes: missing', s => { delete s.scenes; });
mutated('scenes: not a list', s => { s.scenes = 'five scenes'; });
mutated('scenes: empty list', s => { s.scenes = []; });
scenario('scenes: three', validScript([35, 35, 30]));
scenario('scenes: seven', validScript([15, 15, 15, 15, 15, 15, 15]));
mutated('scenes: custom range allows three', () => {}, { minimumSceneCount: 3 }, [35, 35, 30]);
mutated('scene: null entry', s => { s.scenes[2] = null; });
mutated('scene: a string entry', s => { s.scenes[2] = 'scene three'; });
mutated('scene: wrong number', s => { s.scenes[1].sceneNumber = 5; });
mutated('scene: number as text', s => { s.scenes[1].sceneNumber = '2'; });
mutated('scene: number missing', s => { delete s.scenes[3].sceneNumber; });
for (const field of ['narration', 'onScreenText', 'visualDirection']) {
  mutated('scene: ' + field + ' missing', s => { delete s.scenes[1][field]; });
  mutated('scene: ' + field + ' blank', s => { s.scenes[1][field] = '  '; });
  mutated('scene: ' + field + ' not text', s => { s.scenes[1][field] = 9; });
}
mutated('scene: on-screen text five words', s => { s.scenes[0].onScreenText = 'One two three four five'; });
mutated('scene: on-screen text six words', s => { s.scenes[0].onScreenText = 'One two three four five six'; });
mutated('scene: visual direction three words', s => { s.scenes[0].visualDirection = 'Blue door closeup'; });
mutated('scene: visual direction four words', s => { s.scenes[0].visualDirection = 'Blue door close up'; });
mutated('scene: two identical visual directions', s => { s.scenes[3].visualDirection = s.scenes[1].visualDirection; });
mutated('scene: visual directions differ only by case and spacing', s => { s.scenes[3].visualDirection = '  ' + s.scenes[1].visualDirection.toUpperCase() + '  '; });
for (const [label, value] of [['zero', 0], ['negative', -3], ['text', 'eight'], ['missing', undefined], ['numeric text', '9.5'], ['fifteen', 15], ['over fifteen', 15.01], ['null', null]]) {
  mutated('scene: estimated seconds ' + label, s => { if (value === undefined) delete s.scenes[2].estimatedSeconds; else s.scenes[2].estimatedSeconds = value; });
}
mutated('scene: custom maximum hold', () => {}, { maximumSceneDurationSeconds: 9 });

// --- montage and scene controls ---------------------------------------------------------
const place = (location, extra) => Object.assign({ location }, extra || {});
mutated('montage: two places', s => { s.scenes[1].montage = [place('Santorini'), place('Burano', { searchKeywords: 'colourful houses' })]; });
mutated('montage: three places with approved clips', s => { s.scenes[1].montage = [place('A', { approvedClips: [1, 2] }), place('B'), place('C', { approvedClips: [] })]; });
mutated('montage: one place', s => { s.scenes[1].montage = [place('Santorini')]; });
mutated('montage: four places', s => { s.scenes[1].montage = [place('A'), place('B'), place('C'), place('D')]; });
mutated('montage: not a list', s => { s.scenes[1].montage = 'Santorini, Burano'; });
mutated('montage: null', s => { s.scenes[1].montage = null; });
mutated('montage: place without a location', s => { s.scenes[1].montage = [place('A'), { searchKeywords: 'x' }]; });
mutated('montage: blank location', s => { s.scenes[1].montage = [place('A'), place('   ')]; });
mutated('montage: place is a string', s => { s.scenes[1].montage = ['A', 'B']; });
mutated('montage: location of 60 characters', s => { s.scenes[1].montage = [place('A'), place('x'.repeat(60))]; });
mutated('montage: location of 61 characters', s => { s.scenes[1].montage = [place('A'), place('x'.repeat(61))]; });
mutated('montage: keywords of 80 characters', s => { s.scenes[1].montage = [place('A'), place('B', { searchKeywords: 'k'.repeat(80) })]; });
mutated('montage: keywords of 81 characters', s => { s.scenes[1].montage = [place('A'), place('B', { searchKeywords: 'k'.repeat(81) })]; });
mutated('montage: keywords not text', s => { s.scenes[1].montage = [place('A'), place('B', { searchKeywords: ['a', 'b'] })]; });
for (const [label, clips] of [['six ids', [1, 2, 3, 4, 5, 6]], ['a zero', [0]], ['a negative', [-4]], ['a fraction', [1.5]], ['text ids', ['123']], ['not a list', 123], ['null', null]]) {
  mutated('montage: approved clips ' + label, s => { s.scenes[1].montage = [place('A', { approvedClips: clips }), place('B')]; });
  mutated('scene: approved clips ' + label, s => { s.scenes[1].approvedClips = clips; });
}
mutated('scene: approved clips five ids', s => { s.scenes[1].approvedClips = [1, 2, 3, 4, 5]; });
mutated('scene: labelled still true', s => { s.scenes[1].labelledStill = true; });
mutated('scene: labelled still false', s => { s.scenes[1].labelledStill = false; });
mutated('scene: labelled still as text', s => { s.scenes[1].labelledStill = 'yes'; });
mutated('scene: labelled still with approved clips', s => { s.scenes[1].labelledStill = true; s.scenes[1].approvedClips = [7]; });
mutated('scene: labelled still with empty approved clips', s => { s.scenes[1].labelledStill = true; s.scenes[1].approvedClips = []; });
mutated('scene: labelled still with a montage', s => { s.scenes[1].labelledStill = true; s.scenes[1].montage = [place('A'), place('B')]; });
mutated('scene: location and search keywords pass through', s => { s.scenes[0].location = ' Chefchaouen '; s.scenes[0].searchKeywords = 'blue street'; });

// --- duration -----------------------------------------------------------------------------
for (const [label, value] of [['missing', undefined], ['text', 'fifty'], ['numeric text', '47.83'], ['null', null], ['zero', 0], ['29', 29], ['30', 30], ['60', 60], ['61', 61]]) {
  mutated('duration: estimated ' + label, s => { if (value === undefined) delete s.estimatedDurationSeconds; else s.estimatedDurationSeconds = value; });
}
mutated('duration: five seconds above the scene total', s => { s.estimatedDurationSeconds = Math.round((s.estimatedDurationSeconds + 5) * 100) / 100; });
mutated('duration: just over five seconds above the scene total', s => { s.estimatedDurationSeconds = Math.round((s.estimatedDurationSeconds + 5.02) * 100) / 100; });
mutated('duration: custom tolerance of zero', s => { s.estimatedDurationSeconds += 1; }, { durationToleranceSeconds: 0 });
mutated('duration: custom range 40 to 45', () => {}, { minimumDurationSeconds: 40, maximumDurationSeconds: 45 });

// --- hook and call to action --------------------------------------------------------------
mutated('hook: not the opening of the narration', s => { s.hook = 'Something else entirely opens this script here'; });
mutated('hook: differs only by case and punctuation', s => { s.hook = s.hook.toUpperCase() + '!!!'; });
mutated('hook: five words', s => { s.hook = s.scenes[0].narration.split(' ').slice(0, 5).join(' '); });
mutated('hook: six words', s => { s.hook = s.scenes[0].narration.split(' ').slice(0, 6).join(' '); });
mutated('hook: eighteen words', s => { s.hook = s.scenes[0].narration.replace(/\./g, '').split(' ').slice(0, 18).join(' '); });
mutated('hook: nineteen words', s => { s.hook = s.scenes[0].narration.replace(/\./g, '').split(' ').slice(0, 19).join(' '); });
for (const opener of ['Did you know', 'Here are', 'Here is', 'Welcome', 'Today', 'In this video', "In today's video", 'In todays video']) {
  mutated('hook: weak opener "' + opener + '"', s => {
    const hook = opener + ' five amazing travel facts exist';
    s.hook = hook;
    s.scenes[0].narration = hook + '. ' + s.scenes[0].narration;
  });
}
mutated('call to action: twelve words', s => { s.callToAction = words(12, 'cta').join(' ') + '.'; });
mutated('call to action: thirteen words', s => { s.callToAction = words(13, 'cta').join(' ') + '.'; });
mutated('custom hook and call-to-action limits', () => {}, { minimumHookWordCount: 8, maximumCallToActionWordCount: 2 });

// --- rule options ------------------------------------------------------------------------
mutated('options: null', () => {}, null);
mutated('options: numeric text', () => {}, { minimumWordCount: '100', maximumSceneCount: '5' });
mutated('options: blank and null fall back to defaults', () => {}, { minimumWordCount: '', maximumWordCount: null });
for (const [label, options] of [['text', { minimumWordCount: 'lots' }], ['negative', { maximumSceneCount: -1 }], ['zero', { minimumDurationSeconds: 0 }], ['an object', { maximumWordCount: {} }]]) {
  mutated('options: ' + label, () => {}, options);
}
mutated('options: several problems at once are all reported', s => {
  s.title = ''; s.scenes[0].onScreenText = 'far too many words on this screen'; s.callToAction = words(20, 'c').join(' '); s.estimatedDurationSeconds = 90;
});

// --- other public members -------------------------------------------------------------------
function member(name, expression) {
  const sandbox = createSandbox({});
  sandbox.load(validatorFiles);
  record[name] = sandbox.observe(expression);
}
member('members', 'Object.keys(ScriptValidator)');
member('default rules', 'ScriptValidator.getDefaultRules()');
member('default rules: returned copy is independent', '(function () { var r = ScriptValidator.getDefaultRules(); r.minimumWordCount = 1; return ScriptValidator.getDefaultRules().minimumWordCount; })()');
for (const [label, text] of [['plain', '"one two  three"'], ['padded and multiline', '"  one\\ntwo\\tthree  "'], ['empty', '""'], ['null', 'null'], ['number', '12345'], ['punctuation', '"well-known fact, isn\'t it?"']]) {
  member('countWords: ' + label, 'ScriptValidator.countWords(' + text + ')');
}

process.exitCode = settle('ScriptValidator characterisation', 'script-validator.json', record);
