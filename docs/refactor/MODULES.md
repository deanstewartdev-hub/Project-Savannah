# Modules after the refactor: inventory, interfaces, dependencies

State at the end of the refactor (14 November 2026). For the "before" picture and the findings
that led here, see [ARCHITECTURE_MAP.md](ARCHITECTURE_MAP.md).

## How to read this

- **Owner** is the global name every other file, menu, trigger and `google.script.run` call
  uses. Owners are unchanged; their public members are pinned by
  `node-tests/fixtures/public-interface.json`.
- **Module** is a focused sibling file the owner delegates to. Modules are internal: only their
  owner calls them. Each is one global object, looked up when called, never while a file loads.
- Line counts are physical lines.

## Apps Script side

### Scripts and validation

| File | Global | Lines | Responsibility | Public interface |
|---|---|---|---|---|
| `App/ScriptsController.js` | `ScriptsController` (owner) and the browser entry functions `scriptsGenerateScript`, `scriptsGeneratePreview`, `scriptsList`, `scriptsGet`, `scriptsGetLatestForIdea`, `scriptsGetMetrics`, `scriptsSendForReview`, plus `reconcileExistingScriptReadyIdea` | 1,189 (was 2,192) | The seven controller actions and the idea-to-Script-Ready transition | `generateScript`, `generatePreview`, `listScripts`, `getScript`, `getLatestScriptForIdea`, `getMetrics`, `sendForReview`, `getControllerVersion` |
| `App/ScriptsController_Requests.js` | `ScriptsControllerRequests` | 334 | Untrusted request → normalised input | `normaliseGenerateRequest`, `normaliseListRequest`, `extractScriptId`, `extractIdeaId` |
| `App/ScriptsController_Responses.js` | `ScriptsControllerResponses` | 503 | Success / not-found / error responses, safe error details, script summaries | `forController(version)` → `success`, `notFound`, `error`, `removeSensitiveErrorDetails`, `toScriptSummary`, `sortByNewestUpdated`, `resolveLatestUpdatedAt` |
| `App/ScriptsController_Values.js` | `ScriptsControllerValues` | 110 | Shared string, clone and error helpers | `firstNonEmptyString`, `normaliseOptionalString`, `createControllerError`, `clone` |
| `Scripts/Script_Engine.js` | `ScriptEngine` (owner), `generateScriptWorkflow` | 703 (was 2,114) | The generation workflow: request the AI, validate, repair, format, save, record cost, log | `generateScript`, `generatePreview`, `prepareRequest`, `getEngineVersion`, and the three `__test_` hooks |
| `Scripts/Script_Engine_Inputs.js` | `ScriptEngineInputs` | 485 | Idea normalisation and option resolution (defaults, settings fallbacks, limits) | `normaliseIdea`, `resolveOptions` |
| `Scripts/Script_Engine_Prompt.js` | `ScriptEnginePrompt` | 223 | Prompt building and prompt version | `buildPrompt` |
| `Scripts/Script_Engine_Repair.js` | `ScriptEngineRepair` | 220 | Honest timing estimate; correction prompt for a rejected script | `normaliseGeneratedTiming`, `buildCorrectionPrompt` |
| `Scripts/Script_Engine_Results.js` | `ScriptEngineResults` | 402 | Combined AI response, ScriptModel creation, workflow result, engine error | `forEngine(version, action)` → `combineAIResponses`, `createScriptModel`, `buildWorkflowResult`, `createEngineError`, `clone` |
| `Scripts/Script_Validator.js` | `ScriptValidator` (owner) | 612 (was 1,432) | `validate()`, rule resolution, word-count and duration rules | `validate`, `countWords`, `getDefaultRules` |
| `Scripts/Script_Validator_Scenes.js` | `ScriptValidatorScenes` | 361 | Scene structure, montage, approved clips, labelled stills, canonical narration | `validateScenes`, `canonicalNarrationFromScenes`, `normaliseScene` |
| `Scripts/Script_Validator_Text.js` | `ScriptValidatorText` | 309 | Hook, call to action, cadence, markdown, placeholders; counting helpers | `validateHookPlacement`, `validateHookQuality`, `validateCallToActionQuality`, `validateNarrationCadence`, `validateNoMarkdown`, `validateNoPlaceholders`, `countWords`, `normaliseComparableText`, `roundNumber` |
| `Scripts/Scripts_Repository.js` | `ScriptsRepository` (owner) | 665 (was 1,368) | Scripts sheet access and schema (`HEADERS`, `COLUMN`) | `saveScript`, `saveOrUpdateScript`, `updateScript`, `getScriptById`, `getScriptsByIdeaId`, `getLatestScriptByIdeaId`, `getAllScripts`, `getScriptsByStatus`, `getScriptCount`, `exists`, `deleteScriptById`, `ensureSheet`, `getHeaders`, `getRepositoryVersion` |
| `Scripts/Scripts_Repository_Rows.js` | `ScriptsRepositoryRows` | 361 | ScriptModel ↔ sheet row | `forColumns(COLUMN)` → `toRow`, `rowToScript`, `requireIdentifier`, `createRepositoryError` |
| `Scripts/Script_Formatter.js` | `ScriptFormatter` | 619 (was 856) | Unchanged apart from its self-tests moving out | unchanged |
| `Models/Script.js` | `ScriptModel` | 975 (was 1,319) | Unchanged apart from its self-tests moving out | unchanged |

### AI

| File | Global | Lines | Responsibility | Public interface |
|---|---|---|---|---|
| `AI/AI_AIService.js` | `AIService` (owner), `callAIService` | 322 (was 1,229) | `generate`, structured generation, **the retry loop, retryable-error list and provider routing** | `generate`, `generateStructuredContent`, `getProviders`, `getResponseFormats`, `getServiceVersion` |
| `AI/AI_AIService_Requests.js` | `AIServiceRequests` | 470 | Request validation and normalisation | `forService(RESPONSE_FORMATS)` → `createRequest`, `validateSchema` |
| `AI/AI_AIService_Responses.js` | `AIServiceResponses` | 249 | Provider response → provider-independent response, token usage | `forService(SERVICE_VERSION)` → `normaliseResponse` |
| `AI/AI_AIService_Values.js` | `AIServiceValues` | 93 | AIServiceError, clone, merge, optional string | `createAIServiceError`, `cloneObject`, `mergeObjects`, `normaliseOptionalString` |

### Hand-run self-tests

`Tests/ScriptsController_SelfTests.js`, `ApprovalModel_SelfTests.js`, `ScriptValidator_SelfTests.js`,
`ScriptsRepository_SelfTests.js`, `ScriptModel_SelfTests.js`, `AIService_SelfTests.js`,
`ScriptEngine_SelfTests.js`, `ScriptFormatter_SelfTests.js`: the `test…` functions that used to
sit at the bottom of the production files. Same global names, still in the pushed set, still
guarded by `assertLiveTestAllowed_` where they have real side effects.

### Frontend (browser)

| File | Lines | Holds |
|---|---|---|
| `Frontend/Assets/Scripts/Scripts.html` | 547 (was 4,215) | `SavannahApp` with `initialise`, `dom`, `modal`, `navigation`, `format`; the page-start listener |
| `Frontend/Assets/Scripts/Dashboard.html` | 488 | `SavannahApp.dashboard` |
| `Frontend/Assets/Scripts/Ideas.html` | 1,521 | `SavannahApp.ideas` |
| `Frontend/Assets/Scripts/ScriptWorkspace.html` | 1,694 | `SavannahApp.scripts` |

`Frontend/Index.html` loads the four files in that order on every page, then the route-specific
scripts exactly as before.

### Unchanged

Everything under `Production/`, `Approval/`, `Analytics/`, `Dashboard/`, `Ideas/`, `SEO/`,
`Services/`, `Utils/`, `Setup/`, `CallbackBridge/`; `App/App.js`, `AppRoutes.js`,
`ProductionController.js`, `QueueController.js`, `IdeasController.js` and the other controllers;
`Models/RenderJob.js`, `PublishingJob.js`, `SeoPack.js`; `Config.js`, `Constants.js`, `Main.js`,
`appsscript.json`, `.claspignore`. `Models/Approval.js` lost only its self-tests (1,620 → 1,048).

## Media worker

| File | Lines | Responsibility | Exports |
|---|---|---|---|
| `src/pipeline/visualSelection.js` | 307 (was 696) | Footage planning for a job; **the single import point** | The same 31 names as before (its own plus re-exports) |
| `src/pipeline/visualQueries.js` | 98 | Tokenising, keywords, query variants, labelled-still prompt | `tokenize`, `deriveKeywords`, `shotWordsFor`, `buildSearchQueries`, `stillPrompt` |
| `src/pipeline/clipSelection.js` | 150 | Relevance evidence, framing, clip scoring | `MAX_CROP_UPSCALE`, `MIN_KEPT_WIDTH_FRACTION`, `slugTokens`, `evidenceFor`, `judgeVideo`, `landscapeCropFile`, `framingFor`, `selectClip` |
| `src/pipeline/montageRules.js` | 84 | Montage parts, approved clips, request checks | `MONTAGE_MIN_PARTS`, `MONTAGE_MAX_PARTS`, `montagePartBeat`, `isMontage`, `approvedSet`, `approvedCandidates`, `montageError`, `approvedClipsError`, `beatControlsError` |
| `src/pipeline/footagePreflight.js` | 99 | The unpaid coverage preflight | `coverageCandidates`, `unsupportedBeats`, `matchedFlags`, `maxDistinctAssignment` |

Every other worker file is unchanged, including all of `src/lib/` (submission idempotency,
maintenance gate, authentication, job state) and `src/routes/`.

## Dependencies

Module-to-module references, all resolved at call time:

```text
ScriptsController ──► ScriptsControllerRequests ──► ScriptsControllerValues
                  ──► ScriptsControllerResponses ─► ScriptsControllerValues
ScriptEngine ──► ScriptEngineInputs
             ──► ScriptEnginePrompt
             ──► ScriptEngineRepair
             ──► ScriptEngineResults
ScriptValidator ──► ScriptValidatorScenes ──► ScriptValidatorText
                ──► ScriptValidatorText
ScriptsRepository ──► ScriptsRepositoryRows
AIService ──► AIServiceRequests ──► AIServiceValues
          ──► AIServiceResponses ─► AIServiceValues
visualSelection.js ──► visualQueries.js, clipSelection.js, montageRules.js, footagePreflight.js
clipSelection.js ──► visualQueries.js
footagePreflight.js ──► visualQueries.js, clipSelection.js, montageRules.js
```

No module refers back to its owner, so the refactor added no dependency cycle. The one
file-level cycle found in the audit (`App/ProductionController.js` ↔
`Production/ProductionQueue_Service.js`) is unchanged; see COMPATIBILITY.md.

Refresh the file-level picture at any time with `node tools/refactor/dependency-map.cjs`.

## Tests that guard this structure

| Suite | What it pins |
|---|---|
| `node-tests/ApplicationScopeContract_Tests.js` | Every global name and public member from the baseline still exists; no duplicate names; identical interface whichever order files load in |
| `node-tests/ScriptsControllerCharacterization_Tests.js` | 94 controller scenarios: responses, log lines, repository writes |
| `node-tests/ScriptEngineCharacterization_Tests.js` | 84 engine scenarios: results, every prompt, every log/cost/save call |
| `node-tests/ScriptValidatorCharacterization_Tests.js` | 179 validation scenarios: accepted scripts and exact rejection messages |
| `node-tests/ScriptsRepositoryCharacterization_Tests.js` | 70 repository scenarios: return values, sheet writes, final sheet contents |
| `node-tests/AIServiceCharacterization_Tests.js` | 100 AI-service scenarios, including every retry and backoff case |
| `node-tests/FrontendAppStructure_Tests.js` | `SavannahApp` sections, member order and all 87 function sources |
| `media-worker/test/visualSelectionFacade.test.js` | The worker import point's 31 exports and public constants |

Shared support: `node-tests/lib/appsScriptGlobalScope.cjs` (offline model of the Apps Script
global scope), `characterization.cjs` (pinned clock and IDs, fixture comparison),
`fakeSpreadsheet.cjs` (in-memory sheet).
