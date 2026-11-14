/****************************************************
 * Project Savannah - ScriptEngine characterisation suite (refactoring safety net)
 *
 * Pins what Scripts/Script_Engine.js does today, end to end, so its responsibilities (option
 * resolution, prompt building, the validation-and-repair loop, result building, logging) can be
 * moved into focused modules with proof that nothing observable changed.
 *
 * It runs the REAL engine with the REAL ScriptValidator, ScriptFormatter, ScriptModel, prompt
 * library and schemas. The AI provider is a canned queue of responses; the repository, cost and
 * logging services are in-memory recorders. No AI call, no sheet, no network, no cost.
 *
 * Every scenario's result, every prompt sent to the AI stand-in, and every log/cost/save call is
 * compared with node-tests/fixtures/script-engine.json, captured before the split.
 *
 * Run with: node node-tests/ScriptEngineCharacterization_Tests.js
 * Regenerate (deliberately, never to make a failure pass): add --update
 ****************************************************/
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { root, createSandbox, settle, compactLongStrings } = require('./lib/characterization.cjs');

// Every Scripts/Script_Engine*.js file, so focused modules split out later are loaded too.
const engineFiles = fs.readdirSync(path.join(root, 'Scripts'))
  .filter(name => /^Script_Engine.*\.js$/.test(name))
  .sort()
  .map(name => 'Scripts/' + name);

function sceneWithWords(sceneNumber, wordCount) {
  const words = [];
  for (let i = 0; i < wordCount; i++) words.push('word' + i);
  const sentences = [];
  for (let i = 0; i < words.length; i += 8) sentences.push(words.slice(i, i + 8).join(' ') + '.');
  return {
    sceneNumber,
    narration: sentences.join(' '),
    onScreenText: 'Fact ' + sceneNumber,
    visualDirection: 'Concrete visual detail for scene ' + sceneNumber,
    estimatedSeconds: Math.round((wordCount / 2.3) * 100) / 100
  };
}

function validGeneratedScript(wordCountsPerScene) {
  const scenes = wordCountsPerScene.map((count, index) => sceneWithWords(index + 1, count));
  const totalWords = wordCountsPerScene.reduce((sum, count) => sum + count, 0);
  return {
    title: 'Test Script',
    hook: scenes[0].narration.split(' ').slice(0, 6).join(' ').replace(/.$/, ''),
    voiceoverScript: 'An independently written voiceover field that the engine must not trust.',
    scenes,
    callToAction: 'Follow for more facts.',
    estimatedDurationSeconds: Math.round((totalWords / 2.3) * 100) / 100,
    generationNotes: ''
  };
}

function build() {
  const state = { calls: [], ai: [], failSave: false, failCost: false, failLogging: false };
  const copy = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  const note = (kind, detail) => { state.calls.push(Object.assign({ call: kind }, copy(detail) || {})); };
  const logging = kind => (...args) => {
    if (state.failLogging) throw new Error('Logs sheet unavailable');
    note('LoggingService.' + kind, { args: args.map(a => (a instanceof Error || (a && a.name && a.message) ? { name: a.name, message: a.message } : a)) });
  };

  const sandbox = createSandbox({
    AIService: {
      generateStructuredContent: (prompt, schema, options) => {
        note('AIService.generateStructuredContent', { prompt, schemaKeys: Object.keys(schema || {}).sort(), options });
        const next = state.ai.shift();
        if (!next) throw new Error('AI stand-in queue is empty');
        if (next.throw) { const e = new Error(next.throw.message); e.name = next.throw.name; throw e; }
        return next.raw !== undefined ? next.raw : copy(next);
      }
    },
    ScriptsRepository: {
      saveScript: script => {
        if (state.failSave) { const e = new Error('Scripts sheet is locked'); e.name = 'ScriptsRepositoryError'; throw e; }
        note('ScriptsRepository.saveScript', { id: script.id, status: script.status, ideaId: script.ideaId });
        return { saved: true, rowNumber: 12, scriptId: script.id };
      }
    },
    CostService: {
      recordAIUsage: usage => {
        if (state.failCost) throw new Error('Costs sheet unavailable');
        note('CostService.recordAIUsage', usage);
        return { estimatedCost: 0.0042, model: usage.model };
      }
    },
    LoggingService: {
      STATUS: { WARNING: 'WARNING' },
      started: logging('started'), success: logging('success'), failure: logging('failure'),
      log: entry => {
        if (state.failLogging) throw new Error('Logs sheet unavailable');
        const e = entry && entry.errorDetails;
        note('LoggingService.log', Object.assign({}, entry, { errorDetails: e ? { name: e.name, message: e.message } : e }));
      }
    },
    Settings: {
      getModel: () => 'settings-model',
      getTemperature: () => 0.7,
      getMaxTokens: () => 1200,
      getTargetAudience: () => 'Settings audience',
      getNiche: () => 'Settings niche'
    }
  });

  sandbox.load([
    'Config.js', 'Models/Script.js', 'AI/AI_Schemas.js', 'AI/ProptLibrary/Script_PromptLibrary.js',
    'Scripts/Script_Validator.js', 'Scripts/Script_Formatter.js', 'Tests/ScriptValidator_SelfTests.js'
  ].concat(engineFiles));
  sandbox.journal.length = 0;

  // A generated script the engine's default rules accept (110 scene words, about 48 seconds),
  // built the same way Tests/ScriptDurationValidation_Tests.js builds its fixtures.
  const valid = validGeneratedScript([20, 25, 25, 20, 20]);
  const selfTestFixture = sandbox.observe('createValidScriptValidatorFixture_()').returned;
  if (!selfTestFixture) throw new Error('The validator self-test fixture could not be read.');
  const response = (data, extra) => Object.assign({
    success: true, provider: 'test-provider', model: 'test-model', data,
    usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 }, execution: { durationMs: 5 }
  }, extra || {});
  return { sandbox, state, valid, selfTestFixture, response };
}

const record = {};
function scenario(name, expression, arrange) {
  const world = build();
  if (arrange) arrange(world);
  const outcome = world.sandbox.observe(expression);
  if (world.state.calls.length) outcome.calls = world.state.calls;
  record[name] = outcome;
}
const IDEA = { id: 'IDEA-7', title: 'Five travel mistakes to avoid', hook: 'These mistakes ruin trips.', targetAudience: 'Travellers', niche: 'Travel' };
const run = (fn, idea, options) => 'ScriptEngine.' + fn + '(' + JSON.stringify(idea) + (options === undefined ? '' : ', ' + JSON.stringify(options)) + ')';
// Deliberately invalid generated scripts, to drive the repair loop. Word counts come from the
// scene narration (the validator ignores the AI's own voiceoverScript), so "too short" means short scenes.
const tooShort = () => validGeneratedScript([5, 5, 5]);
const noScenes = valid => Object.assign({}, valid, { scenes: [] });

// --- generateScript: success paths -------------------------------------------
scenario('generate: valid on the first attempt', run('generateScript', IDEA), w => { w.state.ai.push(w.response(w.valid)); });
scenario('generate: wrapper function', 'generateScriptWorkflow(' + JSON.stringify(IDEA) + ')', w => { w.state.ai.push(w.response(w.valid)); });
scenario('generate: repaired on the second attempt', run('generateScript', IDEA), w => {
  w.state.ai.push(w.response(tooShort(w.valid)), w.response(w.valid, { usage: { inputTokens: 150, outputTokens: 250, totalTokens: 400 } }));
});
scenario('generate: repaired on the third attempt', run('generateScript', IDEA), w => {
  w.state.ai.push(w.response(tooShort(w.valid)), w.response(noScenes(w.valid), { usage: null }), w.response(w.valid, { execution: undefined }));
});
scenario('generate: with options', run('generateScript', IDEA, { temperature: 0.2, maxTokens: 800, tone: ' calm ', language: 'en-GB', callToActionStyle: 'soft', status: 'generated', targetDurationSeconds: 45 }), w => {
  w.state.ai.push(w.response(w.valid));
});
scenario('generate: response without provider or model uses settings', run('generateScript', IDEA), w => {
  w.state.ai.push(w.response(w.valid, { provider: undefined, model: '' }));
});
scenario('generate: sheet-style idea without a hook is refused by the prompt library', run('generateScript', { 'Idea ID': 'IDEA-8', 'Video Idea': 'Sheet-style idea' }), w => { w.state.ai.push(w.response(w.valid)); });
scenario('generate: idea fields fall back to settings', run('generateScript', { 'Idea ID': 'IDEA-8', 'Video Idea': 'Sheet-style idea', Hook: 'A sheet hook.' }), w => { w.state.ai.push(w.response(w.valid)); });

// --- generateScript: failure paths -------------------------------------------
scenario('generate: never valid, three attempts', run('generateScript', IDEA), w => {
  w.state.ai.push(w.response(tooShort(w.valid)), w.response(tooShort(w.valid)), w.response(noScenes(w.valid)));
});
scenario('generate: the validator self-test fixture is too short for the engine', run('generateScript', IDEA, { maxValidationAttempts: 1 }), w => { w.state.ai.push(w.response(w.selfTestFixture)); });
scenario('generate: one attempt allowed and it is invalid', run('generateScript', IDEA, { maxValidationAttempts: 1 }), w => { w.state.ai.push(w.response(tooShort(w.valid))); });
scenario('generate: AI reports failure', run('generateScript', IDEA), w => { w.state.ai.push({ success: false, data: w.valid }); });
scenario('generate: AI returns no data', run('generateScript', IDEA), w => { w.state.ai.push({ success: true }); });
scenario('generate: AI returns an array', run('generateScript', IDEA), w => { w.state.ai.push({ raw: [1, 2] }); });
scenario('generate: AI returns array data', run('generateScript', IDEA), w => { w.state.ai.push({ success: true, data: [w.valid] }); });
scenario('generate: AI throws', run('generateScript', IDEA), w => { w.state.ai.push({ throw: { name: 'AIServiceError', message: 'Provider timeout' } }); });
scenario('generate: AI throws a ScriptEngineError', run('generateScript', IDEA), w => { w.state.ai.push({ throw: { name: 'ScriptEngineError', message: 'Already wrapped' } }); });
scenario('generate: save fails', run('generateScript', IDEA), w => { w.state.ai.push(w.response(w.valid)); w.state.failSave = true; });
scenario('generate: cost recording fails, script still saved', run('generateScript', IDEA), w => { w.state.ai.push(w.response(w.valid)); w.state.failCost = true; });
scenario('generate: logging fails, script still saved', run('generateScript', IDEA), w => { w.state.ai.push(w.response(tooShort(w.valid)), w.response(w.valid)); w.state.failLogging = true; });
scenario('generate: logging fails during a failure', run('generateScript', IDEA), w => { w.state.ai.push({ throw: { name: 'Error', message: 'boom' } }); w.state.failLogging = true; });
scenario('generate: no AIService, falls back to callAIService', run('generateScript', IDEA), w => {
  const queue = w.state.ai; queue.push(w.response(w.valid));
  w.sandbox.context.AIService = undefined;
  w.sandbox.context.callAIService = (prompt, options) => { w.state.calls.push({ call: 'callAIService', promptLength: prompt.length, responseFormat: options.responseFormat }); return queue.shift(); };
});
scenario('generate: no AI service at all', run('generateScript', IDEA), w => { w.sandbox.context.AIService = null; });

// --- idea and option validation (throw before any AI call) --------------------
for (const [label, idea] of [['null', null], ['string', 'IDEA-7'], ['array', [IDEA]], ['no id', { title: 'T' }], ['no title', { id: 'IDEA-7' }], ['blank fields', { id: '  ', title: '' }]]) {
  scenario('generate: idea is ' + label, run('generateScript', idea));
}
scenario('generate: options is a string', run('generateScript', IDEA, 'fast'));
scenario('generate: options is an array', run('generateScript', IDEA, [1]));

// --- prepareRequest: option resolution and prompt, no AI call ----------------
scenario('prepare: defaults', run('prepareRequest', IDEA));
scenario('prepare: alternate idea keys', run('prepareRequest', { ideaId: 'IDEA-9', videoIdea: 'Alt title', Hook: 'Alt hook', audience: 'Alt audience', Niche: 'Alt niche' }));
scenario('prepare: idea key precedence', run('prepareRequest', { id: 'A', ideaId: 'B', ID: 'C', title: 'T1', videoIdea: 'T2', topic: 'T3' }));
for (const seconds of [20, 30, 45, 50, 60, 90, 'abc', 0, -5, '40']) {
  scenario('prepare: target duration ' + JSON.stringify(seconds), run('prepareRequest', IDEA, { targetDurationSeconds: seconds }));
}
scenario('prepare: explicit word and duration limits', run('prepareRequest', IDEA, { minimumWordCount: 80, maximumWordCount: 140, minimumDurationSeconds: 25, maximumDurationSeconds: 58, durationToleranceSeconds: 0 }));
scenario('prepare: numeric strings', run('prepareRequest', IDEA, { temperature: '0.3', maxTokens: '500', minimumWordCount: '95', maxValidationAttempts: '2' }));
scenario('prepare: blank and null options fall back', run('prepareRequest', IDEA, { temperature: '', maxTokens: null, tone: null, language: 7, status: '' }));
scenario('prepare: maximum words below minimum', run('prepareRequest', IDEA, { minimumWordCount: 120, maximumWordCount: 100 }));
scenario('prepare: maximum duration below minimum', run('prepareRequest', IDEA, { minimumDurationSeconds: 50, maximumDurationSeconds: 40 }));
for (const attempts of [1, 5, 6, 0, -1, 2.5, 'x']) {
  scenario('prepare: validation attempts ' + JSON.stringify(attempts), run('prepareRequest', IDEA, { maxValidationAttempts: attempts }));
}
for (const value of [-1, 'abc', {}, true]) {
  scenario('prepare: temperature ' + JSON.stringify(value), run('prepareRequest', IDEA, { temperature: value }));
  scenario('prepare: minimum words ' + JSON.stringify(value), run('prepareRequest', IDEA, { minimumWordCount: value }));
  scenario('prepare: duration tolerance ' + JSON.stringify(value), run('prepareRequest', IDEA, { durationToleranceSeconds: value }));
}
for (const status of ['draft', 'APPROVED', 'pending_approval', 'nonsense']) {
  scenario('prepare: status ' + status, run('prepareRequest', IDEA, { status }));
}
scenario('prepare: settings unavailable, idea complete', run('prepareRequest', IDEA), w => { w.sandbox.context.Settings = undefined; });
scenario('prepare: settings unavailable', run('prepareRequest', { id: 'IDEA-7', title: 'T' }), w => { w.sandbox.context.Settings = undefined; });
scenario('prepare: settings throw, idea complete', run('prepareRequest', IDEA), w => {
  w.sandbox.context.Settings = { getTemperature: () => { throw new Error('Settings sheet missing'); }, getMaxTokens: () => '', getNiche: () => null };
});
scenario('prepare: settings throw', run('prepareRequest', { id: 'IDEA-7', title: 'T' }), w => {
  w.sandbox.context.Settings = { getTemperature: () => { throw new Error('Settings sheet missing'); }, getMaxTokens: () => '', getNiche: () => null };
});

// --- generatePreview -------------------------------------------------------------
scenario('preview: valid', run('generatePreview', IDEA, { tone: 'warm' }), w => { w.state.ai.push(w.response(w.valid)); });
scenario('preview: repaired', run('generatePreview', IDEA), w => { w.state.ai.push(w.response(noScenes(w.valid)), w.response(w.valid)); });
scenario('preview: never valid', run('generatePreview', IDEA, { maxValidationAttempts: 2 }), w => { w.state.ai.push(w.response(tooShort(w.valid)), w.response(tooShort(w.valid))); });
scenario('preview: invalid idea', run('generatePreview', {}));

// --- test hooks and version ------------------------------------------------------
scenario('version', 'ScriptEngine.getEngineVersion()');
scenario('hook: resolve options', 'ScriptEngine.__test_resolveOptions({ targetDurationSeconds: 55 })');
scenario('hook: normalise timing', '(function () { var s = createValidScriptValidatorFixture_(); ScriptEngine.__test_normaliseGeneratedTiming(s); return s; })()');
scenario('hook: correction prompt', '(function () { var e = new Error(' + JSON.stringify('Generated script failed validation:\n- Voiceover contains 15 words; minimum is 99.') + ');' +
  ' e.name = "ScriptValidationError";' +
  ' return ScriptEngine.__test_buildCorrectionPrompt("ORIGINAL PROMPT", ' + JSON.stringify(tooShort()) + ', e,' +
  ' { ideaId: "IDEA-7", title: "T" }, ScriptEngine.__test_resolveOptions({}), 2); })()');

// Whole prompts are long and repeat across scenarios: keep their hash, length and opening text.
process.exitCode = settle('ScriptEngine characterisation', 'script-engine.json', compactLongStrings(record, 1200));
