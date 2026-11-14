/****************************************************
 * Project Savannah - AIService characterisation suite (refactoring safety net)
 *
 * Pins what AI/AI_AIService.js does today so its request validation and response normalisation
 * can be moved into focused modules with proof that nothing observable changed. In particular
 * it pins the retry rules: how many times the provider is called, for which errors, and with
 * what delays. Those rules decide how many paid calls one request can make.
 *
 * The provider (callOpenAI) is a canned queue; Utilities.sleep only records the delay asked
 * for. No AI call, no network, no cost, no real waiting.
 *
 * Run with: node node-tests/AIServiceCharacterization_Tests.js
 * Regenerate (deliberately, never to make a failure pass): add --update
 ****************************************************/
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { root, createSandbox, settle } = require('./lib/characterization.cjs');

// Every AI/AI_AIService*.js file, so focused modules split out later are loaded too.
const serviceFiles = fs.readdirSync(path.join(root, 'AI'))
  .filter(name => /^AI_AIService.*\.js$/.test(name))
  .sort()
  .map(name => 'AI/' + name);

function build() {
  const state = { provider: [], calls: [], settings: { provider: 'OpenAI', model: 'gpt-test', temperature: 0.7, maxTokens: 1000 } };
  const copy = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  const sandbox = createSandbox({
    callOpenAI: request => {
      state.calls.push({ call: 'callOpenAI', request: copy(request) });
      const next = state.provider.shift();
      if (next === undefined) throw new Error('Provider stand-in queue is empty');
      if (next && next.throwMessage !== undefined) {
        if (next.asString) throw next.throwMessage; // eslint-disable-line no-throw-literal
        throw new Error(next.throwMessage);
      }
      return next && next.raw !== undefined ? next.raw : copy(next);
    },
    Settings: {
      getProvider: () => state.settings.provider,
      getModel: () => state.settings.model,
      getTemperature: () => state.settings.temperature,
      getMaxTokens: () => state.settings.maxTokens
    }
  });
  sandbox.context.Utilities.sleep = ms => { state.calls.push({ call: 'sleep', milliseconds: ms }); };
  sandbox.load(serviceFiles);
  sandbox.journal.length = 0;
  return { sandbox, state };
}

const record = {};
function scenario(name, expression, arrange) {
  const world = build();
  if (arrange) arrange(world.state, world.sandbox.context);
  const outcome = world.sandbox.observe(expression);
  if (world.state.calls.length) outcome.calls = world.state.calls;
  record[name] = outcome;
}
const args = (...values) => values.map(v => (v === undefined ? 'undefined' : JSON.stringify(v))).join(', ');
const generate = (prompt, options) => 'AIService.generate(' + args(prompt, options) + ')';
const structured = (prompt, schema, options) => 'AIService.generateStructuredContent(' + args(prompt, schema, options) + ')';
const ok = extra => Object.assign({ success: true, data: 'Generated text', usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } }, extra || {});
const SCHEMA = { type: 'json_schema', name: 'script_schema', schema: { type: 'object', properties: { title: { type: 'string' } } } };

// --- success and response normalisation ---------------------------------------
scenario('generate: text, defaults', generate('  Write a hook.  '), s => { s.provider.push(ok()); });
scenario('generate: wrapper callAIService', 'callAIService(' + args('Write a hook.') + ')', s => { s.provider.push(ok()); });
scenario('generate: all options', generate('P', { temperature: 0, maxTokens: 50, responseFormat: 'json', systemMessage: '  Be brief. ', metadata: { runId: 'RUN-1' }, retry: { maxAttempts: 2, initialDelayMilliseconds: 0, backoffMultiplier: 1.5 } }), s => {
  s.provider.push(ok({ provider: 'OpenAI-reported', model: 'gpt-reported', data: { a: 1 } }));
});
scenario('generate: usage in prompt/completion naming', generate('P'), s => { s.provider.push(ok({ usage: { prompt_tokens: 7.4, completion_tokens: '8', extra: 'kept' } })); });
scenario('generate: usage in camelCase naming', generate('P'), s => { s.provider.push(ok({ usage: { inputTokens: 5, outputTokens: 6, totalTokens: 99 } })); });
scenario('generate: usage missing', generate('P'), s => { s.provider.push(ok({ usage: undefined })); });
scenario('generate: usage is an array', generate('P'), s => { s.provider.push(ok({ usage: [1, 2] })); });
scenario('generate: usage has negative and non-numeric counts', generate('P'), s => { s.provider.push(ok({ usage: { input_tokens: -5, output_tokens: 'many', total_tokens: null } })); });
scenario('generate: data is zero', generate('P'), s => { s.provider.push(ok({ data: 0 })); });
scenario('generate: data is an empty string', generate('P'), s => { s.provider.push(ok({ data: '' })); });
scenario('structured: valid schema', structured('P', SCHEMA, { temperature: 0.2, metadata: { action: 'X' } }), s => { s.provider.push(ok({ data: { title: 'T' } })); });
scenario('structured: no options', structured('P', SCHEMA), s => { s.provider.push(ok({ data: { title: 'T' } })); });
scenario('structured: options ask for text, schema wins', structured('P', SCHEMA, { responseFormat: 'text', schema: null }), s => { s.provider.push(ok({ data: {} })); });

// --- provider responses the service rejects (no retry: they are not thrown by the provider) ---
scenario('generate: provider reports failure', generate('P'), s => { s.provider.push({ success: false, data: 'x' }); });
scenario('generate: provider returns no data', generate('P'), s => { s.provider.push({ success: true }); });
scenario('generate: provider returns null data', generate('P'), s => { s.provider.push({ success: true, data: null }); });
scenario('generate: provider returns null', generate('P'), s => { s.provider.push({ raw: null }); });
scenario('generate: provider returns a string', generate('P'), s => { s.provider.push({ raw: 'plain' }); });

// --- retry rules -------------------------------------------------------------------
const RETRYABLE = ['OpenAI API error 429: rate limit', 'Rate Limit reached', 'Request timeout', 'The request timed out', 'Model temporarily unavailable',
  'Service Unavailable', 'Internal Server Error', 'Bad Gateway', 'Gateway Timeout', 'API error 500', 'API error 502', 'API error 503', 'API error 504'];
for (const message of RETRYABLE) {
  scenario('retry: "' + message + '" then success', generate('P'), s => { s.provider.push({ throwMessage: message }, ok()); });
}
const NOT_RETRYABLE = ['OpenAI API error 400: bad request', 'OpenAI API error 401: invalid key', 'API error 403', 'API error 404', 'Insufficient quota', 'Content policy violation', ''];
for (const message of NOT_RETRYABLE) {
  scenario('retry: "' + message + '" is not retried', generate('P'), s => { s.provider.push({ throwMessage: message }, ok()); });
}
scenario('retry: retryable three times, default limit reached', generate('P'), s => { s.provider.push({ throwMessage: 'API error 503' }, { throwMessage: 'API error 503' }, { throwMessage: 'API error 503' }, ok()); });
scenario('retry: two failures then success, default backoff', generate('P'), s => { s.provider.push({ throwMessage: '429' }, { throwMessage: 'timeout' }, ok()); });
scenario('retry: retryable then non-retryable', generate('P'), s => { s.provider.push({ throwMessage: 'API error 502' }, { throwMessage: 'API error 401' }, ok()); });
scenario('retry: provider throws a string', generate('P'), s => { s.provider.push({ throwMessage: 'rate limit as text', asString: true }, ok()); });
scenario('retry: invalid provider response is not retried', generate('P'), s => { s.provider.push({ raw: 7 }, ok()); });
scenario('retry: one attempt only', generate('P', { retry: { maxAttempts: 1 } }), s => { s.provider.push({ throwMessage: 'API error 503' }, ok()); });
scenario('retry: five attempts, custom backoff', generate('P', { retry: { maxAttempts: 5, initialDelayMilliseconds: 100, backoffMultiplier: 3 } }), s => {
  s.provider.push({ throwMessage: '429' }, { throwMessage: '429' }, { throwMessage: '429' }, { throwMessage: '429' }, ok());
});
scenario('retry: fractional backoff rounds', generate('P', { retry: { maxAttempts: 4, initialDelayMilliseconds: 333, backoffMultiplier: 1.5 } }), s => {
  s.provider.push({ throwMessage: '429' }, { throwMessage: '429' }, { throwMessage: '429' }, ok());
});
scenario('retry: empty retry object uses defaults', generate('P', { retry: {} }), s => { s.provider.push({ throwMessage: '429' }, ok()); });

// --- request validation (nothing reaches the provider) ---------------------------
for (const [label, prompt] of [['empty', ''], ['blank', '   '], ['null', null], ['number', 42], ['object', { text: 'x' }], ['undefined', undefined]]) {
  scenario('validate: prompt is ' + label, generate(prompt));
}
scenario('validate: options is a string', generate('P', 'fast'));
scenario('validate: options is an array', generate('P', [1]));
scenario('validate: options is null', generate('P', null), s => { s.provider.push(ok()); });
for (const format of ['xml', 'TEXT', 'json_schema']) scenario('validate: response format ' + format, generate('P', { responseFormat: format }), s => { s.provider.push(ok()); });
for (const temperature of [-0.1, 2, 2.1, '0.5', NaN, null]) scenario('validate: temperature ' + String(temperature), 'AIService.generate("P", { temperature: ' + String(typeof temperature === 'string' ? JSON.stringify(temperature) : temperature) + ' })', s => { s.provider.push(ok()); });
for (const maxTokens of [0, -1, 1, '100', Infinity, null]) scenario('validate: maxTokens ' + String(maxTokens), 'AIService.generate("P", { maxTokens: ' + String(typeof maxTokens === 'string' ? JSON.stringify(maxTokens) : maxTokens) + ' })', s => { s.provider.push(ok()); });
for (const [label, metadata] of [['string', 'x'], ['array', [1]], ['null', null]]) scenario('validate: metadata is ' + label, generate('P', { metadata }), s => { s.provider.push(ok()); });
for (const [label, schema] of [['null', null], ['string', 'x'], ['array', []], ['wrong type', { type: 'object', name: 'n', schema: {} }], ['no name', { type: 'json_schema', schema: {} }],
  ['blank name', { type: 'json_schema', name: '  ', schema: {} }], ['no schema', { type: 'json_schema', name: 'n' }], ['array schema', { type: 'json_schema', name: 'n', schema: [] }]]) {
  scenario('validate: structured schema is ' + label, structured('P', schema), s => { s.provider.push(ok()); });
}
scenario('validate: bad schema passed through options', generate('P', { schema: { type: 'nope' } }), s => { s.provider.push(ok()); });
for (const [label, retry] of [['string', 'x'], ['array', [3]], ['zero attempts', { maxAttempts: 0 }], ['six attempts', { maxAttempts: 6 }], ['fractional attempts', { maxAttempts: 1.5 }],
  ['negative delay', { initialDelayMilliseconds: -1 }], ['text delay', { initialDelayMilliseconds: 'soon' }], ['zero multiplier', { backoffMultiplier: 0 }], ['text multiplier', { backoffMultiplier: 'x' }]]) {
  scenario('validate: retry is ' + label, generate('P', { retry }), s => { s.provider.push(ok()); });
}

// --- settings ----------------------------------------------------------------------
scenario('settings: no provider configured', generate('P'), s => { s.settings.provider = '  '; });
scenario('settings: no model configured', generate('P'), s => { s.settings.model = null; });
scenario('settings: unsupported provider', generate('P'), s => { s.settings.provider = 'Anthropic'; s.provider.push(ok()); });
scenario('settings: padded provider and model', generate('P'), s => { s.settings.provider = ' OpenAI '; s.settings.model = ' gpt-pad '; s.provider.push(ok()); });
scenario('settings: temperature and maxTokens fall back to settings', generate('P', { temperature: null }), s => { s.settings.temperature = 1.1; s.settings.maxTokens = 222; s.provider.push(ok()); });

// --- public constants --------------------------------------------------------------
scenario('providers', 'AIService.getProviders()');
scenario('response formats', 'AIService.getResponseFormats()');
scenario('version', 'AIService.getServiceVersion()');

process.exitCode = settle('AIService characterisation', 'ai-service.json', record);
