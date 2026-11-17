/****************************************************
 * Project Savannah - ScriptsController characterisation suite (refactoring safety net)
 *
 * App/ScriptsController.js had no automated coverage. This suite pins what it does today so its
 * request parsing and response shaping can be moved into focused modules with proof that nothing
 * observable changed: every scenario's response, log lines and repository writes are compared
 * with node-tests/fixtures/scripts-controller.json, captured before the split.
 *
 * It runs the REAL controller with the REAL ScriptModel and ApprovalModel over in-memory
 * repositories and a canned ScriptEngine. No AI call, no sheet, no network.
 *
 * Run with: node node-tests/ScriptsControllerCharacterization_Tests.js
 * Regenerate (deliberately, never to make a failure pass): add --update
 ****************************************************/
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { root, createSandbox, settle } = require('./lib/characterization.cjs');

// Every App/ScriptsController*.js file, so focused modules split out later are loaded too.
const controllerFiles = fs.readdirSync(path.join(root, 'App'))
  .filter(name => /^ScriptsController.*\.js$/.test(name))
  .sort()
  .map(name => 'App/' + name);

function build() {
  const state = { scripts: {}, approvals: {}, ideas: {}, writes: [], engine: { mode: 'ok' }, lock: { held: false, busy: false } };
  const copy = value => (value === undefined || value === null ? value : JSON.parse(JSON.stringify(value)));
  const values = map => Object.keys(map).map(key => copy(map[key]));

  const sandbox = createSandbox({
    LockService: {
      getScriptLock: () => ({
        waitLock: () => { if (state.lock.busy) throw new Error('Lock timeout'); state.lock.held = true; },
        hasLock: () => state.lock.held,
        releaseLock: () => { state.lock.held = false; state.writes.push('lock released'); }
      })
    },
    ScriptsRepository: {
      getAllScripts: () => values(state.scripts),
      getScriptsByIdeaId: ideaId => values(state.scripts).filter(s => s.ideaId === ideaId),
      getScriptsByStatus: status => values(state.scripts).filter(s => s.status === status),
      getScriptCount: () => Object.keys(state.scripts).length,
      getScriptById: id => copy(state.scripts[id] || null),
      getLatestScriptByIdeaId: ideaId => values(state.scripts)
        .filter(s => s.ideaId === ideaId)
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] || null,
      updateScript: script => {
        if (state.failScriptUpdate) throw new Error('Sheets write failed');
        state.writes.push('script ' + script.id + ' -> ' + script.status);
        state.scripts[script.id] = copy(script);
        return script;
      }
    },
    ApprovalRepository: {
      getActiveApprovalByScriptId: scriptId => values(state.approvals).find(a => a.scriptId === scriptId) || null,
      saveApproval: approval => { state.writes.push('approval saved for ' + approval.scriptId); state.approvals[approval.id] = copy(approval); return approval; },
      deleteApprovalById: id => { state.writes.push('approval deleted'); delete state.approvals[id]; }
    },
    IdeasRepository: {
      getIdeaById: id => copy(state.ideas[id] || null),
      markIdeaScriptReady: id => {
        if (state.ideaWriteLoses) return copy(state.ideas[id]);
        state.writes.push('idea ' + id + ' -> Script Ready');
        state.ideas[id].status = 'Script Ready';
        return copy(state.ideas[id]);
      }
    },
    ScriptEngine: {
      generateScript: (idea, options) => {
        state.writes.push('engine.generateScript ' + JSON.stringify({ idea, options }));
        const mode = state.engine.mode;
        if (mode === 'empty') return {};
        if (mode === 'throw') {
          const error = new Error(state.engine.message);
          error.name = state.engine.name;
          if (state.engine.runId) error.runId = state.engine.runId;
          if (state.engine.ideaId) error.ideaId = state.engine.ideaId;
          throw error;
        }
        if (mode === 'throwString') throw state.engine.message; // eslint-disable-line no-throw-literal
        const script = copy(state.scripts['SCR-FORMATTED']);
        const result = { scriptId: script.id, ideaId: mode === 'noIdea' ? '' : idea.id, script, title: mode === 'bare' ? '' : script.title };
        if (mode !== 'bare') {
          Object.assign(result, {
            status: script.status, persistence: { saved: true, row: 7 }, ai: { model: 'test-model' },
            validation: { valid: true }, formatting: { valid: true }, promptVersion: 'p-1',
            estimatedCost: '0.0123', validationAttempts: 2, execution: { ms: 10 }, engineVersion: 'e-1'
          });
        }
        return result;
      },
      generatePreview: (idea, options) => {
        state.writes.push('engine.generatePreview ' + JSON.stringify({ idea, options }));
        if (state.engine.mode === 'throw') { const e = new Error(state.engine.message); e.name = state.engine.name; throw e; }
        return copy(state.scripts['SCR-FORMATTED']);
      }
    }
  });

  sandbox.load(['Models/Script.js', 'Models/Approval.js', 'Tests/ApprovalModel_SelfTests.js'].concat(controllerFiles));

  // Seed data built by the real model from the repository's own fixture.
  const seed = (id, overrides) => {
    sandbox.context.__seed = Object.assign({ id }, overrides);
    const made = sandbox.observe('ScriptModel.toObject(ScriptModel.create(Object.assign(createApprovalModelScriptFixture_(), __seed)))');
    if (!made.returned) throw new Error('Seed script could not be built: ' + JSON.stringify(made));
    state.scripts[id] = Object.assign(made.returned, overrides.after || {});
    delete state.scripts[id].after;
  };
  seed('SCR-FORMATTED', { ideaId: 'IDEA-1', status: 'FORMATTED', updatedAt: '2026-11-10T09:00:00.000Z', createdAt: '2026-11-10T08:00:00.000Z' });
  seed('SCR-PENDING', { ideaId: 'IDEA-2', status: 'PENDING_APPROVAL', updatedAt: '2026-11-12T09:00:00.000Z', createdAt: '2026-11-12T08:00:00.000Z' });
  seed('SCR-ORPHAN-PENDING', { ideaId: 'IDEA-3', status: 'PENDING_APPROVAL', updatedAt: '2026-11-11T09:00:00.000Z', createdAt: '2026-11-11T08:00:00.000Z' });
  seed('SCR-APPROVED', { ideaId: 'IDEA-1', status: 'APPROVED', updatedAt: '2026-11-14T11:00:00.000Z', createdAt: '2026-11-14T10:00:00.000Z',
    after: { metadata: { provider: '  padded-provider ', wordCount: 111, usage: { attemptCount: 2.6 } } } });
  seed('SCR-ODD', { ideaId: 'IDEA-4', status: 'DRAFT', updatedAt: '2026-11-13T09:00:00.000Z', createdAt: '2026-11-13T08:00:00.000Z',
    after: { updatedAt: 'not a date', metadata: { wordCount: -1, usage: { workflowAttemptCount: 3 } }, aiModel: '', promptVersion: '', scenes: null } });
  const pendingApproval = sandbox.observe('ApprovalModel.toObject(ApprovalModel.fromScript(' + JSON.stringify(state.scripts['SCR-PENDING']) + ', { submittedBy: "Writer" }))');
  if (!pendingApproval.returned) throw new Error('Seed approval could not be built: ' + JSON.stringify(pendingApproval));
  state.approvals[pendingApproval.returned.id] = pendingApproval.returned;
  state.ideas = {
    'IDEA-1': { id: 'IDEA-1', status: 'Approved', videoIdea: 'Five mistakes' },
    'IDEA-2': { id: 'IDEA-2', status: ' Idea ', videoIdea: 'Second' }
  };
  sandbox.journal.length = 0;
  return { sandbox, state };
}

const record = {};
// Each scenario starts from a fresh world so order never matters.
function scenario(name, expression, arrange) {
  const world = build();
  if (arrange) arrange(world.state, world.sandbox.context);
  const outcome = world.sandbox.observe(expression);
  if (world.state.writes.length) outcome.writes = world.state.writes.slice();
  outcome.lockHeldAfter = world.state.lock.held;
  record[name] = outcome;
}
const call = (fn, arg) => fn + '(' + (arg === undefined ? '' : JSON.stringify(arg)) + ')';

// --- generate: request parsing -------------------------------------------------
scenario('generate: no request', 'scriptsGenerateScript()');
scenario('generate: null request', 'scriptsGenerateScript(null)');
scenario('generate: array request', call('scriptsGenerateScript', []));
scenario('generate: string request', call('scriptsGenerateScript', 'IDEA-1'));
scenario('generate: missing idea id', call('scriptsGenerateScript', { title: 'A title' }));
scenario('generate: missing idea title', call('scriptsGenerateScript', { id: 'IDEA-1' }));
scenario('generate: whitespace-only fields', call('scriptsGenerateScript', { id: '   ', title: '  ' }));
scenario('generate: options is a string', call('scriptsGenerateScript', { id: 'IDEA-1', title: 'T', options: 'fast' }));
scenario('generate: options is an array', call('scriptsGenerateScript', { id: 'IDEA-1', title: 'T', options: [1] }));
scenario('generate: idea given as an array falls back to the request', call('scriptsGenerateScript', { idea: ['x'], id: 'IDEA-1', title: 'Flat title' }));

// --- generate: happy paths and option handling ----------------------------------
scenario('generate: nested idea, all fields', call('scriptsGenerateScript', {
  idea: { id: ' IDEA-1 ', videoIdea: ' Five mistakes ', hook: ' Hook ', targetAudience: 'Travellers', niche: 'Travel' },
  options: { temperature: 0.4, maxTokens: 900, tone: 'calm', language: 'en', status: 'FORMATTED', unsupported: 'x', callToActionStyle: '', maxValidationAttempts: null, minimumWordCount: 0 }
}));
scenario('generate: sheet-style keys', call('scriptsGenerateScript', { 'Idea ID': 'IDEA-1', 'Video Idea': 'Sheet title', Hook: 'H', 'Target Audience': 'TA', Niche: 'N' }));
scenario('generate: alternate keys and numeric id', call('scriptsGenerateScript', { ID: 42, topic: 'Topic title', audience: 'Aud', options: { targetDurationSeconds: 50, minimumDurationSeconds: 30, maximumDurationSeconds: 60, durationToleranceSeconds: 2, maximumWordCount: 125 } }));
scenario('generate: key precedence (id over ideaId, videoIdea over title)', call('scriptsGenerateScript', { id: 'IDEA-1', ideaId: 'IDEA-2', videoIdea: 'First', title: 'Second', idea: 'Third' }));
scenario('generate: engine returns minimal result', call('scriptsGenerateScript', { id: 'IDEA-1', title: 'T' }), s => { s.engine.mode = 'bare'; });
scenario('generate: engine returns no idea id, request id is used', call('scriptsGenerateScript', { id: 'IDEA-2', title: 'T' }), s => { s.engine.mode = 'noIdea'; });

// --- generate: idea transition ------------------------------------------------
scenario('generate: source idea not found', call('scriptsGenerateScript', { id: 'IDEA-MISSING', title: 'T' }));
scenario('generate: idea status write does not stick', call('scriptsGenerateScript', { id: 'IDEA-1', title: 'T' }), s => { s.ideaWriteLoses = true; });
scenario('generate: ideas repository unavailable', call('scriptsGenerateScript', { id: 'IDEA-1', title: 'T' }), (s, context) => { context.IdeasRepository = null; });
scenario('generate: ideas repository has only updateIdeaStatus', call('scriptsGenerateScript', { id: 'IDEA-1', title: 'T' }), (s, context) => {
  const repo = context.IdeasRepository;
  context.IdeasRepository = { getIdeaById: repo.getIdeaById, updateIdeaStatus: (id, status) => { s.writes.push('idea ' + id + ' updateIdeaStatus ' + status); return { id, status }; } };
});
scenario('generate: ideas repository has no update method', call('scriptsGenerateScript', { id: 'IDEA-1', title: 'T' }), (s, context) => {
  context.IdeasRepository = { getIdeaById: context.IdeasRepository.getIdeaById };
});

// --- generate: engine failures and error shaping --------------------------------
scenario('generate: engine returns nothing persisted', call('scriptsGenerateScript', { id: 'IDEA-1', title: 'T' }), s => { s.engine.mode = 'empty'; });
for (const name of ['ScriptEngineError', 'ScriptValidationError', 'ScriptFormatterError', 'ScriptModelError', 'ScriptModelValidationError',
  'ScriptsRepositoryError', 'ApprovalRepositoryError', 'ApprovalModelError', 'ApprovalModelValidationError', 'AIServiceError', 'ScriptsControllerError', 'TypeError', '']) {
  scenario('generate: engine throws ' + (name || '(blank name)'), call('scriptsGenerateScript', { id: 'IDEA-1', title: 'T' }), s => {
    s.engine = { mode: 'throw', name, message: 'Provider said no' };
  });
}
scenario('generate: error message has a link and a stack', call('scriptsGenerateScript', { id: 'IDEA-1', title: 'T' }), s => {
  s.engine = { mode: 'throw', name: 'AIServiceError', message: 'Failed at https://api.example.com/v1/x?key=abc and HTTP://other.example \n    at call (file.js:1:1)\n at next', runId: ' RUN-9 ', ideaId: 'IDEA-1' };
});
scenario('generate: a thrown string', call('scriptsGenerateScript', { id: 'IDEA-1', title: 'T' }), s => { s.engine = { mode: 'throwString', message: '  plain failure  ' }; });
scenario('generate: an error with an empty message', call('scriptsGenerateScript', { id: 'IDEA-1', title: 'T' }), s => { s.engine = { mode: 'throw', name: 'Error', message: '' }; });

// --- preview ------------------------------------------------------------------
scenario('preview: valid', call('scriptsGeneratePreview', { idea: { id: 'IDEA-1', title: 'T' }, options: { tone: 'warm' } }));
scenario('preview: invalid request', call('scriptsGeneratePreview', { options: {} }));
scenario('preview: engine throws', call('scriptsGeneratePreview', { id: 'IDEA-1', title: 'T' }), s => { s.engine = { mode: 'throw', name: 'ScriptValidationError', message: 'Too short' }; });

// --- list -------------------------------------------------------------------
scenario('list: no request', 'scriptsList()');
scenario('list: null request', 'scriptsList(null)');
scenario('list: empty object', call('scriptsList', {}));
scenario('list: by status, lower case and padded', call('scriptsList', { status: '  pending_approval ' }));
scenario('list: by idea id', call('scriptsList', { ideaId: ' IDEA-1 ' }));
scenario('list: idea id wins over status', call('scriptsList', { ideaId: 'IDEA-1', status: 'DRAFT' }));
scenario('list: unknown status', call('scriptsList', { status: 'NOPE' }));
for (const limit of [1, 2, '3', 500, 0, -1, 1.5, 'abc', '', null, true]) {
  scenario('list: limit ' + JSON.stringify(limit), call('scriptsList', { limit }));
}
scenario('list: request is a string', call('scriptsList', 'DRAFT'));
scenario('list: request is an array', call('scriptsList', [1]));
scenario('list: controller called directly with undefined', 'ScriptsController.listScripts()');

// --- get / latest -------------------------------------------------------------
scenario('get: by string id', call('scriptsGet', ' SCR-FORMATTED '));
scenario('get: by scriptId', call('scriptsGet', { scriptId: 'SCR-APPROVED' }));
scenario('get: by id', call('scriptsGet', { id: 'SCR-PENDING' }));
scenario('get: scriptId wins over id', call('scriptsGet', { scriptId: 'SCR-APPROVED', id: 'SCR-PENDING' }));
scenario('get: not found', call('scriptsGet', 'SCR-NOPE'));
scenario('get: missing id', call('scriptsGet', {}));
scenario('get: no request', 'scriptsGet()');
scenario('get: number', call('scriptsGet', 7));
scenario('latest: by string', call('scriptsGetLatestForIdea', 'IDEA-1'));
scenario('latest: by ideaId', call('scriptsGetLatestForIdea', { ideaId: 'IDEA-2' }));
scenario('latest: by id', call('scriptsGetLatestForIdea', { id: 'IDEA-4' }));
scenario('latest: not found', call('scriptsGetLatestForIdea', { ideaId: 'IDEA-NOPE' }));
scenario('latest: missing', call('scriptsGetLatestForIdea', {}));

// --- metrics ------------------------------------------------------------------
scenario('metrics: seeded scripts', 'scriptsGetMetrics()');
scenario('metrics: no scripts', 'scriptsGetMetrics()', s => { s.scripts = {}; });
scenario('metrics: unknown status and bad dates', 'scriptsGetMetrics()', s => {
  s.scripts['SCR-ODD'].status = 'MYSTERY';
  s.scripts['SCR-ODD'].createdAt = 'nonsense';
  Object.keys(s.scripts).forEach(id => { if (id !== 'SCR-ODD') s.scripts[id].updatedAt = 'bad'; });
});
scenario('metrics: repository fails', 'scriptsGetMetrics()', (s, context) => {
  context.ScriptsRepository.getAllScripts = () => { const e = new Error('Sheet missing'); e.name = 'ScriptsRepositoryError'; throw e; };
});

// --- send for review ----------------------------------------------------------
scenario('review: formatted script is queued', call('scriptsSendForReview', { scriptId: 'SCR-FORMATTED', submittedBy: ' Dean ', reviewNotes: ' Please check ' }));
scenario('review: by string id', call('scriptsSendForReview', 'SCR-FORMATTED'));
scenario('review: already pending returns the existing approval', call('scriptsSendForReview', { scriptId: 'SCR-PENDING' }));
scenario('review: pending without a queue record', call('scriptsSendForReview', { scriptId: 'SCR-ORPHAN-PENDING' }));
scenario('review: approved script is refused', call('scriptsSendForReview', { scriptId: 'SCR-APPROVED' }));
scenario('review: draft script is refused', call('scriptsSendForReview', { scriptId: 'SCR-ODD' }));
scenario('review: not found', call('scriptsSendForReview', { scriptId: 'SCR-NOPE' }));
scenario('review: missing id', call('scriptsSendForReview', {}));
scenario('review: formatted script that already has an active approval', call('scriptsSendForReview', { scriptId: 'SCR-FORMATTED' }), s => {
  s.approvals.extra = { id: 'APR-EXTRA', scriptId: 'SCR-FORMATTED', status: 'PENDING_APPROVAL' };
});
scenario('review: script status write fails, approval is rolled back', call('scriptsSendForReview', { scriptId: 'SCR-FORMATTED' }), s => { s.failScriptUpdate = true; });
scenario('review: lock is busy', call('scriptsSendForReview', { scriptId: 'SCR-FORMATTED' }), s => { s.lock.busy = true; });

// --- maintenance helper and version ------------------------------------------
scenario('reconcile: idea with a saved script', call('reconcileExistingScriptReadyIdea', ' IDEA-1 '));
scenario('reconcile: no id', 'reconcileExistingScriptReadyIdea()');
scenario('reconcile: no saved script', call('reconcileExistingScriptReadyIdea', 'IDEA-NOPE'));
scenario('version', 'ScriptsController.getControllerVersion()');

process.exitCode = settle('ScriptsController characterisation', 'scripts-controller.json', record);
