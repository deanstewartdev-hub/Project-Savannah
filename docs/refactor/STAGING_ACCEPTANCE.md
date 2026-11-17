# PR #33 staging acceptance

17 November 2026 · tested commit **`d0811a2`** (branch `refactor/modular-architecture`), compared in
the same staging project with its PR #32 base **`4e4967c`**.

Nothing was deployed to production, rendered, uploaded, published or paid for. No live sheet,
production property or trigger was touched. IDs below are shortened to their last six characters.

## Result

| Area | Result |
|---|---|
| Repository and PR state | **PASS** |
| Automated suites | **PASS**: app runner 1,035 PASS / 0 FAIL; worker 435 / 435 |
| Staging identity | **PASS**: established before any push |
| Push to staging (refactored app) | **PASS**: staging runs exactly `d0811a2` |
| In-app checks in real Apps Script | **PASS**: 15 of 16 completed on both base and refactor; the 16th fails identically on both (pre-existing, see Defects) |
| Server-side page rendering (Dashboard shell and all includes) | **PASS** |
| Page data functions: Dashboard, Ideas, Scripts | **PASS** |
| Approval gate refuses an invalid decision | **PASS** |
| Spreadsheet compatibility | **PASS** |
| Missing functions | **PASS**: none |
| Pages in a browser, client side (static build, server mocked) | **PASS**: identical before and after |
| Pages in a browser against the live staging web app | **BLOCKED**: see Blockers |
| Production unchanged | **PASS** |

## Evidence

### Repository

- `refactor/modular-architecture` local and remote at `d0811a2`. PR #33 open, draft, base
  `fix/photogenic-scene-metadata` (PR #32), mergeable.
- PR #32 still at `4e4967c`; **0** new commits since this branch was cut.
- Other worktrees and the main checkout untouched. The only local change in this worktree is
  `.claude/settings.json` (editor tool settings, not ours, not pushed anywhere).

### Automated suites at `d0811a2`

| Suite | Result |
|---|---|
| `node node-tests/run-local.cjs` | exit 0 · **1,035 PASS / 0 FAIL** · syntax: 108 server files, 12 frontend scripts |
| `media-worker`: `npm test` | **435 tests, 435 pass, 0 fail**, 0 skipped |

### Staging identity (all checked before pushing)

| Check | Evidence |
|---|---|
| Which project | Main staging project `…VqXv64`, recorded as such in GitHub issue #28 (A6/A9: created with `clasp create --parentId` bound to the new staging spreadsheet) |
| Not production | Differs from the production ID in `.clasp.json` (`…vfUfUf`); the guarded tool also refuses the production ID |
| Title | "Savannah STAGING main v18" |
| Owner | `dean.stewart.dev`, the documented staging owner, and the account clasp is signed in as |
| Environment | Script property `SAVANNAH_ENVIRONMENT = staging`; no provider key, worker URL or job secret present |
| Permissions | Manifest scope only `spreadsheets.currentonly`, no advanced services: staging cannot reach YouTube, Drive or any paid provider |
| Deployments | HEAD (test deployment) only; no versioned deployment |

### Pushes

Both pushes used the repository's guarded tool `tools/staging/prepare-staging-push.cjs`, each
into its own marked folder, with a production-ID check immediately before `clasp push`
(clasp 3.4.1, the version the tool pins, run from the push folder only).

| Push | Files | Review | After push (read-only clone) |
|---|---|---|---|
| Base `4e4967c`, 15:47 UTC | 123 code + manifest | `.claspignore` allow-list only; no tests, worker or tools files; no `require`/`import` | 108 non-empty files identical, manifest identical, nothing extra |
| Refactor `d0811a2`, 16:05 UTC | 147 code + manifest (the 123 plus exactly the 24 new modules) | same | 132 non-empty files identical, manifest identical, nothing extra |

The 15 files a clone does not return are 0-byte placeholders, which Apps Script does not store
(also noted in the October staging record).

Before the first push, the code staging held (closest to `6ef795a` on `feat/creative-quality-v1`)
was saved as a read-only snapshot outside the repository, so it can be restored if wanted.

### In-app checks in real Apps Script (staging editor, run as the owner)

Times are UTC on 17 November, from the project's Executions page. Each check is read-only or
pure logic; none calls a provider, writes rows, uploads or renders.

| Check | What it exercises | Base `4e4967c` | Refactor `d0811a2` |
|---|---|---|---|
| `testDashboardController` | `getDashboardDataForApp`, the Dashboard page's server call | Completed 15:52 | Completed 16:06 |
| `testIdeasController` | `ideasGetWorkspace`, the Ideas page's server call | Completed 15:55 | Completed 16:07 |
| `testScriptsControllerAll` | `listScripts`, `getMetrics`, invalid-request handling (Scripts page; split controller, repository row mapping) | Completed 15:56 (3/3, no provider) | Completed 16:07 (3/3, no provider) |
| `testQueueControllerInvalidDecision` | Approval gate refuses a decision without an approval ID | Completed 16:04 | Completed 16:08 (`QueueControllerError: Approval ID is required.`) |
| `testApplicationTemplate` | `doGet` renders the shell, navigation and every included script file | Completed 15:59 | Completed 16:08 |
| `runProductionHardeningTests` | Production suite (throws on any failure) | Completed 16:00 | Completed 16:09 |
| `runCloudRunReconciliationTests` | Provider routing incl. `CreatomateProviderAdapter` | Completed 16:00 | Completed 16:09 |
| `runScriptDurationValidationTests` | Validator and engine timing (split modules) | Completed 16:00 | Completed 16:09 |
| `runPromptAlignmentTests` | Correction prompt (split engine) | Completed 16:00 | Completed 16:10 |
| `runScriptEngineOptionsResolutionTests` | Option resolution (split engine) | Completed 16:01 | Completed 16:10 |
| `testApprovalModelAll` | Approval model (relocated self-tests) | Completed 16:01 (9/9) | Completed 16:10 (9/9) |
| `testScriptModelAll` | Script model | Completed 16:02 (6/6) | Completed 16:11 (6/6) |
| `testScriptEngineUnitTests` | Request preparation (split engine) | Completed 16:02 (2/2, no provider) | Completed 16:11 (2/2, no provider) |
| `testAIServiceUnitTests` | Request validation (split AI service) | Completed 16:02 (2/2, no provider) | Completed 16:12 (2/2, no provider) |
| `stagingRowCounts` | Read-only row counts | 13 / 1 / 4 / 12 | 13 / 1 / 4 / 12 (unchanged) |
| `testScriptFormatterAll` | Formatter self-tests | **Failed** (pre-existing) | **Failed**, identical message |

On the base round two extra read-only functions also ran, `doGet` and `queueList`, both completed.

### Pages in a browser, client side

Static builds of the Dashboard, Ideas, Scripts and Approval Queue pages, from the real view
markup and the real page scripts of each commit, with `google.script.run` replaced by a stand-in,
loaded in a real browser:

| Page | Base `4e4967c` | Refactor `d0811a2` |
|---|---|---|
| Dashboard | no errors; calls `getDashboardDataForApp`; 970 characters of text | identical |
| Ideas | no errors; calls `ideasGetWorkspace`; 659 | identical |
| Scripts | no errors; calls `scriptsGetMetrics`, `scriptsList`; 723 | identical |
| Approval Queue | no errors; calls `queueList`, `queueGetMetrics`; 419 | identical |

`SavannahApp` has the same sections in both, and `node-tests/FrontendAppStructure_Tests.js`
proves all 87 of its functions identical by source hash.

### Missing functions

Every server function the browser code calls through `google.script.run` (35 distinct names)
is defined in the pushed refactor build. `node-tests/ApplicationScopeContract_Tests.js`
separately proves all 307 baseline globals still exist.

### Spreadsheet compatibility

- The Scripts page's server calls read the staging spreadsheet through the split
  `Scripts_Repository_Rows.js` mapping without error.
- Staging row counts are identical before and after both pushes and all checks.
- Locally, `node-tests/ScriptsRepositoryCharacterization_Tests.js` pins every sheet write and the
  sheet's final contents (70 scenarios).

### Production (read-only)

Deployments HEAD, @99 and @1; 99 versions. No clasp command in this session used the production
ID except these two read-only listings, and every push ran from a staging-bound folder after a
production-ID check.

## Defects

| Defect | Where | Status |
|---|---|---|
| `testScriptFormatterAll` fails: its fixture has 57 words, the validator's minimum is 90 | Hand-run self-test fixture; present at the PR #32 base `4e4967c` with the same message | **Pre-existing, not a refactor regression, not fixed here.** Changing the fixture is a test-data change outside a behaviour-preserving refactor. The validator self-tests in `Tests/ScriptValidator_SelfTests.gs` share that fixture and probably fail the same way (not run) |

No defect was found that needed a fix for staging compatibility, so no code was changed.

## Blockers

| Blocker | Cause | What would clear it |
|---|---|---|
| The live staging web app pages (Dashboard, Ideas, Scripts, Queue) could not be opened | The test deployment is limited to the owner. Chrome on this machine is signed in to several Google accounts and the staging owner is not the first, so Google shows "unable to open the file" for any web app of that account (a known multi-account limitation). No account was signed out | Owner: open the staging project as `dean.stewart.dev` → Deploy → Test deployments → open the web app URL in a browser window signed in **only** to that account (for example a guest or incognito window), then click Dashboard, Ideas, Scripts and Approval Queue and check that each loads. No paid action is involved; do not press Generate |

## Staging state now

Staging runs the refactored application `d0811a2`, test deployment HEAD only. To return it to
what it ran before (closest to `6ef795a`), push that commit with the same guarded tool, or
restore from the saved snapshot held outside the repository.
