# Modular refactoring — completion report

15 November 2026 · branch `refactor/modular-architecture` · draft PR #33, stacked on PR #32
(`fix/photogenic-scene-metadata`, cut at `4e4967c`).

## Outcome

The oversized files outside the render-and-publish gate are now split into focused modules, with
no change in behaviour. Every planned module is either done or recorded as a justified
exception. Nothing was deployed, rendered, uploaded or spent, and no live sheet, script
property or trigger was touched.

**Not done, by decision:** `App/ProductionController.js` and the files around it
(`VideoProcessingProvider.js`, `Production.html`, the controller ↔ queue-service cycle). A real
split there means redesigning the shared lock and recovery plumbing in the file that guards
paid renders and uploads. That is a behaviour-affecting change and needs separate approval; the
recommended design is in [COMPATIBILITY.md](COMPATIBILITY.md).

## What changed

| Area | Before | After |
|---|---|---|
| `App/ScriptsController.js` | 2,192 lines | 1,189, plus `_Requests`, `_Responses`, `_Values` |
| `Scripts/Script_Engine.js` | 2,114 | 703, plus `_Inputs`, `_Prompt`, `_Repair`, `_Results` |
| `Scripts/Script_Validator.js` | 1,432 | 612, plus `_Scenes`, `_Text` |
| `Scripts/Scripts_Repository.js` | 1,368 | 665, plus `_Rows` |
| `AI/AI_AIService.js` | 1,229 | 322, plus `_Requests`, `_Responses`, `_Values` |
| `Models/Approval.js`, `Models/Script.js`, `Scripts/Script_Formatter.js` | 1,620 / 1,319 / 856 | 1,048 / 975 / 619 (self-tests moved to `Tests/`) |
| Frontend `Assets/Scripts/Scripts.html` | 4,215 | 547, plus `Dashboard.html`, `Ideas.html`, `ScriptWorkspace.html` |
| Worker `pipeline/visualSelection.js` | 696 | 307, plus `visualQueries.js`, `clipSelection.js`, `montageRules.js`, `footagePreflight.js` |

Largest Apps Script server file: 2,192 lines before, 1,189 after. Largest script file anywhere
in the app: 4,215 before, 1,694 after. Module inventory, public interfaces and dependencies:
[MODULES.md](MODULES.md).

New files: 13 Apps Script modules, 8 relocated self-test files, 3 frontend section files and 4
worker modules.

## How behaviour was kept identical

1. **Moved, not rewritten.** For every split, each line removed from the original file was
   checked to exist in the new modules. What is new is only the wiring: the one-line delegates left
   behind, each module's wrapper, three frontend section headers, and one `export` keyword in
   the worker.
2. **Public names frozen.** All 307 Apps Script global names and their public members from the
   baseline still exist; no name is declared twice; the interface is identical whichever order
   the files load in.
3. **Characterised first.** Five modules had no automated coverage. Each got a golden-master
   suite, captured from the unsplit code and committed before any code moved: 527 scenarios in
   total, all unchanged after the splits.
4. **Browser check.** Static builds of the Dashboard, Ideas and Scripts pages were loaded in a
   real browser before and after the frontend split: no errors, same server calls, same text.

## Test evidence

| Suite | Baseline (`4e4967c`) | Final |
|---|---|---|
| App runner, `node node-tests/run-local.cjs` | exit 0 · 498 PASS / 0 FAIL | exit 0 · **1,047 PASS / 0 FAIL** (after merging PR #32 and the fixture correction; 1,035 at `d0811a2`) |
| Media worker, `npm test` | 431 / 431 | **445 / 445** (PR #32 added 10 tests); one intermittent PR #32 failure, see below |
| GitHub Actions "Validate Savannah" | — | success on the branch (both jobs) |

The 537 extra app checks are the new safety-net suites (7 scope-contract checks, 527
characterisation scenarios, 3 frontend-structure checks); the 4 extra worker tests pin the
import surface. No pre-existing test was removed, skipped or loosened. Six existing test files
were edited, only to load the new sibling files or read relocated self-tests. No flaky test was
observed in any run.

## Safety controls

Checked by diff against the baseline: **no change** to anything under `Production/`,
`App/ProductionController.js`, `App/QueueController.js`, `App/App.js`, `Approval/`, `Utils/`
(environment and live-test guards), `Services/`, `Config.js`, `appsscript.json`,
`.claspignore`, `CallbackBridge/`, or the worker's `src/lib/` and `src/routes/` (submission
idempotency, maintenance gate, authentication, job state). `Production/Creatomate_Service.js`
and `CreatomateProviderAdapter` are untouched.

Verified by the existing suites, all passing unchanged:

- One owner action cannot start two paid renders: `RenderSubmissionIdempotency`,
  `RenderNewVersion`, `InitialRenderWorkflow`, `QueueSubmissionInterplay`, and the worker's
  `submitIdempotency`, `submitConcurrentProcesses` and `submissionGate` tests.
- Submission-maintenance gate and rollout rules: `submissionGate`, `rolloutGuard`,
  `productionContractCheck`, `secretBlock`.
- Publishing protections: upload recovery (54 checks), `PublishStagingGuard`,
  `ProductionRefreshSafety`, `ProductionUI_Reconciliation`.
- Human approval gate: `ApprovalGate`.
- Live-test guard: `LiveTestGuard` (same assertion; three path entries updated for relocated
  self-tests).
- AI retry rules (how many paid provider calls one request can make): pinned by the new
  `AIServiceCharacterization` suite and left in `AI_AIService.js`, unedited.

No test performs chargeable work or writes live data: the runners supply no Google or provider
clients, the worker suite uses stubs and local FFmpeg, and the new suites use canned stand-ins
and an in-memory sheet.

## What the owner still needs to do

1. **Review and merge order.** PR #33 sits on #32. Merge the stack bottom-up as usual; #33 last.
2. **Staging check before any production deployment.** Done on 17 November 2026:
   [STAGING_ACCEPTANCE.md](STAGING_ACCEPTANCE.md). The integrated code runs in the staging
   project, passed the in-app checks in real Apps Script, and Dashboard, Ideas, Scripts and
   Approval Queue load in the live staging web app with every server call succeeding.
3. **PR #32 reply defect.** Fix it in PR #32, not here: under a narrow race the request that
   created a submission intent can be answered 409 although its render started (one execution
   still holds). Cause and suggested fix are in STAGING_ACCEPTANCE.md.
4. **Decide on the Production controller.** Approve, change or decline the proposed design in
   COMPATIBILITY.md. Until then it stays as it is.
4. If PR #32 gets more commits, merge them into this branch using the procedure in
   COMPATIBILITY.md.

## Findings worth knowing

- **Fixed separately (test data only, `2fca32c`):** the Rome fixture shared by the formatter and
  validator hand-run self-tests had gone stale on 15 August, so `testScriptFormatterAll` and
  `testScriptValidatorWithValidScript` failed. Corrected, verified in staging, and now run
  automatically by `node-tests/HandRunSelfTests_Tests.js`.

Characterisation surfaced a few existing behaviours that were pinned as they are and not
changed (details in COMPATIBILITY.md): the scripts repository will save a nearly empty script
given only an ID; the validator's markdown rule catches only code fences and line-start
headings; some rejection messages print a regular expression.

## Record

17 commits on the branch before this report, each one module or one safety net, each pushed
after its suites passed. Working record: [README.md](README.md). Baseline and test log:
[BASELINE.md](BASELINE.md).
