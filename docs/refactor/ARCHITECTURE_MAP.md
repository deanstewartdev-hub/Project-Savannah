# Architecture map and module inventory

Audit of the code at `4e4967c` (tip of PR #32), 14 November 2026. Figures come from the
repository itself: `git ls-files`, `node-tests/lib/appsScriptGlobalScope.cjs` and
`tools/refactor/dependency-map.cjs` (re-run either to refresh them).

## 1. The two runtimes

| Runtime | Where | Module system | How code reaches production |
|---|---|---|---|
| Google Apps Script (V8) | repo root: `Main.js`, `Config.js`, `Constants.js`, `Ideas.js` and the folders `.claspignore` re-includes | **None.** Every pushed `.js` file shares one global scope; each file's top level runs once | `clasp push`, then a versioned web-app deployment (owner only) |
| Node 22+ media worker | `media-worker/` | ES modules (`"type": "module"`) | container image on Cloud Run (owner only) |

A third, tiny Apps Script project, `CallbackBridge/`, is deployed separately and is **not**
part of the main project's push set.

Consequence for the refactor: on the Apps Script side a "module" is a file that defines one
global object. Splitting a file is safe only if every public name keeps its shape, no name is
declared twice, and no file needs another to have loaded first. Those three properties are now
tested (`node-tests/ApplicationScopeContract_Tests.js`).

## 2. Entrypoints

| Kind | Where | Notes |
|---|---|---|
| Web app GET | `doGet` in `App/App.js` | Serves `Frontend/Index.html` through `includeFrontend` |
| Web app POST | `doPost` in `App/App.js` | Media-worker callback route |
| Spreadsheet menu | `onOpen`, `setupProjectSavannah`, … in `Main.js` | Menu items call global functions by name |
| Browser → server | Global functions called through `google.script.run` (44 call sites across 7 frontend script files; Production has 22, Scripts 10) | Each is a one-line global wrapper over a controller method, e.g. `productionSubmit` → `ProductionController.submit` |
| Triggers | Functions installed by name (queue worker, analytics capture) | Names must never change |
| Worker HTTP | `media-worker/src/server.js`, `src/dispatcher.js` → `lib/dispatcherApp.js`, `routes/jobs.js` | Job submit, status, health |
| Worker jobs | `media-worker/src/job-runner.js`, `staging-job-runner.js`, `recover-delivery.js` | Cloud Run Job entry files |

Because menu items, triggers and `google.script.run` all address functions **by global name**,
every one of the 307 global names in the baseline fixture is treated as public interface.

## 3. Module inventory (Apps Script side, 87 pushed server files)

Lines are physical lines at the baseline commit.

| Area | Files | Largest files (lines) | Responsibility |
|---|---|---|---|
| Shell and navigation | `App/App.js` (597), `App/AppRoutes.js` (164), `Main.js`, `Frontend/Index.html`, `Frontend/Components/**` | — | `doGet`/`doPost`, template includes, routes, spreadsheet menu |
| Dashboard | `Dashboard/*` (6), `App/DashboardController.js` | `Dashboard_Service.js` (374) | Sheet dashboard and web dashboard data |
| Ideas | `Ideas/*`, `Ideas.js`, `App/IdeasController.js` (603) | `Ideas_Repository.js` (900) | Idea generation and storage |
| Scripts and validation | `Scripts/*` (6), `App/ScriptsController.js`, `Models/Script.js` | `ScriptsController.js` (2192), `Script_Engine.js` (2114), `Script_Validator.js` (1432), `Scripts_Repository.js` (1368), `Models/Script.js` (1319), `Script_Formatter.js` (856) | Generate, repair, validate, format, store scripts |
| Approval | `Approval/Approval_Repository.js` (457), `Models/Approval.js` (1620) | — | Approval queue records and transitions |
| SEO | `SEO/*`, `App/SeoController.js`, `Models/SeoPack.js` | small | SEO pack generation and storage |
| Production and rendering | `App/ProductionController.js` (1108), `Production/VideoProcessingProvider.js` (510), `ScenePlan_Service.js`, `Voiceover_Service.js`, `VisualAsset_Service.js`, `Creatomate_Service.js`, `RenderQuality_Service.js`, `RenderReview_Service.js` | — | Render submission, provider adapters, legacy scene preparation, quality gate, review |
| Render jobs, queue, retries | `Production/ProductionTask_Repository.js`, `ProductionQueue_Service.js`, `RenderJob_Repository.js`, `Models/RenderJob.js`, `App/QueueController.js` (305) | — | Job records, background queue, retry classification |
| Callbacks | `Production/MediaWorkerCallback_Service.js`, `MediaWorkerCallbackInbox_Service.js` (277), `MediaWorkerProbe_Service.js`, `VideoLink_Service.js` | — | Worker callback intake, single-writer inbox, link refresh |
| Safety gates and health | `Production/ProductionFingerprint_Service.js`, `ProductionError_Service.js`, `ProductionHealth_Service.js` (302), `ReleaseReadiness_Service.js`, `StagingVerification_Service.js` (417), `Utils/EnvironmentGuard.js`, `Utils/LiveTestGuard.js` | — | Duplicate-render and environment guards, findings, staging-only checks |
| YouTube publishing | `Production/YouTube_Service.js` (299), `PublishingJob_Repository.js`, `PublishingSchedule_Service.js`, `Models/PublishingJob.js` | — | Upload, schedule, duplicate-upload protection |
| Analytics | `Analytics/*`, `App/AnalyticsController.js` | `YouTubeAnalytics_Service.js` (347) | Snapshots and channel health |
| AI | `AI/*` (8) | `AI_AIService.js` (1229), `Script_PromptLibrary.js` (442) | Provider-independent AI service, OpenAI client, schemas, prompts |
| Settings and configuration | `Config.js`, `Constants.js`, `App/SettingsController.js`, `Services/Services_SettingsManager.js`, `Services/Services_Secrets.js` | — | Constants, settings sheet, script properties |
| Shared services | `Services/Services_Logging.js`, `Services_Costs.js`, `Services_Notifications.js`, `Utils/Utils_Helpers.js` | — | Logs, cost records, notifications, helpers |
| On-device self-tests | `Tests/*` (5) plus `test…` functions embedded in six production files | — | Functions run by hand from the Apps Script editor |

Frontend (served as templates, not global scope): `Frontend/Assets/Scripts/Scripts.html` (4215
lines) and `Production.html` (1078) are the two large client scripts; styles in
`Frontend/Assets/Styles/` (`Components.html` 2136, `Layout.html` 807).

## 4. Module inventory (media worker, `media-worker/src`, 42 files, ~4,000 lines)

| Area | Files | Responsibility |
|---|---|---|
| HTTP surface | `server.js`, `dispatcher.js`, `lib/dispatcherApp.js` (345), `routes/jobs.js`, `lib/auth.js`, `lib/secretFormat.js` | Submit and status endpoints, authentication |
| Submission safety | `lib/submitIntent.js`, `lib/renderJobGuard.js`, `lib/renderRequest.js`, `lib/validateBeats.js`, `lib/environment.js` | Idempotent submit, maintenance gate, request validation |
| Job state | `lib/jobState.js`, `lib/jobStateStore.js`, `lib/jobStatus.js` (263), `lib/storage.js` | State records in GCS, status reporting |
| Pipeline | `pipeline/runJob.js`, `narration.js`, `alignment.js`, `beatTiming.js`, `narrationCompleteness.js`, `visuals.js` (214), `visualSelection.js` (696), `prepareMusic.js`, `assemble.js` (212), `probe.js`, `deliver.js` | Narration → alignment → footage → assembly → probe → delivery |
| Captions and music | `lib/captionChunks.js`, `captionAss.js`, `ass.js`, `musicLicence.js`, `musicManifest.js` | Caption layout, music licence checks |
| Callback | `lib/callback.js` | Signed callback to Apps Script |

The worker is already modular: one responsibility per file, explicit imports, 431 tests. Only
`pipeline/visualSelection.js` is oversized, and it is the file PR #31/#32 are actively changing.

## 5. Findings

**Oversized files** (Apps Script): eight files over 1,000 lines hold 43% of the server code.
`App/ScriptsController.js`, `Scripts/Script_Engine.js`, `Models/Approval.js`,
`Scripts/Script_Validator.js`, `Scripts/Scripts_Repository.js`, `Models/Script.js`,
`AI/AI_AIService.js`, `App/ProductionController.js`. Each is a single closure
(`const X = (() => { … })()`) mixing its real job with request parsing, response shaping, error
normalisation and small string/number helpers.

**Self-tests inside production files.** Six production files carry their own hand-run test
functions at the bottom (74 `test…` globals in total across the project): about 1,900 lines
that deploy with production code and inflate the files above.

**Duplicated logic.** The same small helpers are re-implemented privately inside several
closures: `firstNonEmptyString_`, `normaliseOptionalString_`, `clone_`, `normaliseError_`,
`createErrorResponse_` / `createSuccessResponse_`, request-ID builders. Each copy is private, so
they are not interchangeable without proof they behave identically; see COMPATIBILITY.md for the
rule used here (move, do not merge, unless a characterisation test proves equivalence).

**Circular dependency.** One file-level cycle:
`App/ProductionController.js` ↔ `Production/ProductionQueue_Service.js` (the queue service
calls back up into the controller). `Production/StagingVerification_Service.js` also reaches up
into the controller.

**Layering exceptions.** `Analytics/YouTubeAnalytics_Service.js` reads three repositories from
other areas directly (Ideas, Scripts, Publishing). `Config.js` is referenced by 19 files and
`Services_Secrets.js` by 14: these are the true shared core.

**Widest fan-out.** `App/ProductionController.js` references 22 other files;
`StagingVerification_Service.js` 13; `Script_Engine.js` 11.

**Hard to test.** Most Apps Script suites load an explicit list of source files into a `vm`
context, so a file that mixes pure logic with Sheets access cannot be exercised without
stubbing the whole spreadsheet. The pure parts (validation rules, request normalisation,
response shaping, model transitions) are the pieces worth separating.

**Not a problem.** No load-order dependence exists today: all 87 files load in push order and
in reverse order with an identical interface. The refactor must keep it that way.

## 6. Target structure

Boundaries, not new folders. Apps Script's flat global scope and `.claspignore` reward keeping
the existing directory layout; modules are added as sibling files inside the folder that owns
the responsibility, named `<Owner>_<Responsibility>.js`.

| Boundary | Owner global (unchanged) | Focused modules to sit beside it |
|---|---|---|
| Application shell and navigation | `doGet`, `doPost`, `includeFrontend`, `AppRoutes` | callback routing separated from page serving |
| Dashboard | `DashboardController`, `Dashboard*` | already split; no change planned |
| Ideas | `IdeasController`, `IdeaEngine`, `IdeasRepository` | repository row mapping; controller request/response |
| Scripts and validation | `ScriptsController`, `ScriptEngine`, `ScriptValidator`, `ScriptFormatter`, `ScriptsRepository`, `ScriptModel` | controller requests / responses; engine option resolution, repair loop, persistence step; repository row mapping |
| Approval workflows | `ApprovalModel`, `ApprovalRepository` | transitions separate from record normalisation |
| Production and rendering | `ProductionController`, `VideoProcessingProvider` | submission, review and publishing actions as separate controller modules (hot set) |
| Footage and image selection | worker `pipeline/visualSelection.js`, `visuals.js` | query building, scoring, selection, AI-still fallback (hot set) |
| Video assembly and quality | worker `pipeline/assemble.js`, `probe.js`; `RenderQualityService` | already focused |
| Render jobs and retries | `ProductionQueueService`, `ProductionTaskRepository`, `RenderJobRepository`, `QueueController` | break the queue ↔ controller cycle with an injected handler |
| Idempotency and safety gates | `ProductionFingerprintService`, worker `submitIntent.js`, `renderJobGuard.js`, guards in `Utils/` | no structural change; protected by existing suites |
| YouTube publishing | `YouTubeService`, `PublishingScheduleService`, `PublishingJobRepository` | no structural change planned |
| SEO | `SeoController`, `SeoEngine`, `SeoRepository` | already small |
| Analytics | `AnalyticsController`, `YouTubeAnalyticsService` | already small |
| Settings and configuration | `Config`, `Secrets`, `SettingsManager`, `SettingsController` | no change |
| Shared services | `Logger`-facing `Services_*`, `Utils_*` | no change |

What is deliberately **not** done: no new folders that would need `.claspignore` changes, no
Node `import`/`require` in Apps Script files, no bundler, no renamed sheet columns or
serialised fields, no shared "utils" file that merges look-alike private helpers.
