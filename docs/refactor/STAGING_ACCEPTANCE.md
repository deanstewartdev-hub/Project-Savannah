# PR #33 staging acceptance

Three rounds, all on 17 November 2026. **Round 3 is the current state.** Rounds 2 and 1 are kept
below as the record.

Nothing was deployed to production, rendered, uploaded, published or paid for. No live sheet,
production property or trigger was touched. IDs are shortened to their last six characters.

## Round 3: PR #34 integrated, PR #31 CI explained, interactive browser checks

Integrated commit: **`bca17b4`** (merge of PR #34 into this branch). Later commits change docs only.

| Area | Result |
|---|---|
| PR #34 (fix for the PR #32 reply race) reviewed | **PASS**: one commit on PR #32's tip (`8427129`), 2 production files and 1 test file. A reservation now records the `submitIntentId` that made it; only a request of that same intent whose intent record names the job gets the replay report. Different intents, versions, older jobs and unreadable records keep their 409 (fail closed). State transitions copy the whole record, so the label survives every status change |
| PR #34 integrated here | **Merged into this branch** (`bca17b4`, merge commit, no rebase, no force-push) so the integrated code can be verified. **Not merged into PR #32's branch**: that is PR #34's destination and needs the owner. PR #34 stays a draft; GitHub reports it MERGEABLE/CLEAN with 4 of 4 checks passing |
| App runner | **PASS**: exit 0, **1,047 PASS / 0 FAIL** |
| Media worker | **PASS**: **452 / 452** (445 + PR #34's 7) |
| `submitConcurrentProcesses.test.js` (the flaky test) | **PASS 50 / 50** (was 2 failures in 52 before the fix) |
| Characterisation, scope contract, frontend structure, hand-run self-tests, approval gate, idempotency, upload recovery, publishing safety | **PASS**, unchanged |
| Staging code | Unchanged since round 2: no Apps Script or frontend file differs between `2fca32c` (on staging) and `bca17b4`, so the live checks below apply to the integrated commit |
| Production | Unchanged (nothing touched it) |

### Interactive browser checks (live staging web app, owner signed in)

| Check | Result |
|---|---|
| Sidebar navigation: Ideas → Scripts → Approval Queue | **PASS**: each link loads its page |
| Ideas: Approved filter, list-view toggle, search box (split `Ideas.html`) | **PASS**: controls respond (active filter, active view, typed search with clear button) and, as designed, make no server call |
| Scripts: Refresh (split `ScriptWorkspace.html`) | **PASS**: re-calls `scriptsGetMetrics` and `scriptsList`, both `success: true` (`scripts-controller-v1.2`) |
| Approval Queue: Refresh | **PASS**: re-calls `queueList` and `queueGetMetrics`, both `success: true` (`queue-controller-v1.0`) |
| Outer-page console errors | none |
| The unidentified Dashboard call from round 2 | **Identified**: `Notifications.html` (unchanged by the refactor) refreshes the notification feed every 60 seconds (`setInterval(load, 60000)`); repeated calls while a page stays open are that poll |
| App frame console | **Not readable** by the browser tool: Google serves the app from a sandboxed `googleusercontent.com` frame of another origin. Not worked around; covered instead by the successful calls, working controls and the client-side check in round 1 |

### PR #31's four failed CI checks

| | |
|---|---|
| Which | `app-checks` and `media-worker`, push and pull-request runs, on PR #31's head `98b9928` (11 November) |
| Cause | Both jobs fail on `spawn ffmpeg ENOENT` (`ChainIntegration_Tests.cjs`, the narration gate tests). PR #31's own `.github/workflows/validate.yml` has no FFmpeg install step |
| Fixed where | `2e3378d` "ci: install ffmpeg and ffprobe in both Savannah validation jobs" and `7cf851b` (12 November), which are in PR #32, whose CI passes |
| Code verified | PR #31's exact tree run locally with FFmpeg: app runner exit 0, **464 PASS / 0 FAIL**; worker **343 / 343** |
| Verdict | **Historical and environmental**, not a code defect. The red checks will stay on PR #31's page (re-running uses #31's own workflow). They matter only if #31 is ever judged or merged alone; merging the stack bottom-up brings the workflow fix with #32. If wanted, the two workflow commits can be added to #31 (owner decision; not done here) |

## Round 2: integrated with PR #32, fixture corrected, live pages checked

Branch tip after this round: see the PR. Code under test: **`2fca32c`**, which is `d0811a2` plus
the merge of PR #32 (`277b34f`) and the self-test fixture correction (`2fca32c`). Later commits on
the branch change documentation only.

| Area | Result |
|---|---|
| PR #32 synchronised | **PASS**: 2 new commits (`6d4601d`, `4a0a1c9`) merged with a merge commit, no rebase, no force-push. They touch only worker review docs, one new worker test and fixture, and two production tools: no overlap with the refactor, no conflicts |
| App runner, `node node-tests/run-local.cjs` | **PASS**: exit 0, **1,047 PASS / 0 FAIL** (1,035 before + 12 new hand-run self-test checks) |
| Media worker, `npm test` | **PASS on rerun**: 445 / 445. One earlier full run failed 1 test (444 / 445), see Defects |
| Characterisation suites (controller 94, engine 84, validator 179, repository 70, AI service 100), scope contract 7, frontend structure 3 | **PASS**, unchanged |
| Approval gate 8, render-submission idempotency 21, upload recovery 54, publishing-safety and refresh suites | **PASS** |
| Staging push of `2fca32c` (guarded tool, staging ID only) | **PASS**: read-only clone identical (132 non-empty files, manifest) |
| Formatter and validator self-tests in real Apps Script | **PASS**: `testScriptFormatterAll` 4/4 and all four validator self-tests now pass in the staging editor |
| **Live staging web app: Dashboard, Ideas, Scripts, Approval Queue** | **PASS**: see below |
| Production unchanged | **PASS**: deployments HEAD, @99, @1; 99 versions (read-only) |

### Live staging web app (owner signed in, single-account browser)

The multi-account problem was solved without bypassing anything: the owner signed in as the
staging account in the app's separate browser pane, which has no other Google sessions. The
test deployment (HEAD, owner-only) then opened normally. Pages were reached through the app's
own navigation menu, not typed URLs. Generate was not pressed.

| Page | Loaded | Server calls (all HTTP 200, `success: true`) | Console errors |
|---|---|---|---|
| Dashboard | yes | `getDashboardDataForApp` (pipeline: 13 renders, 4 SEO packs, 1 published, matching staging row counts), `notificationsGetFeed` (3 unread), plus one call whose body was not retained after navigating | none |
| Ideas (via menu) | yes | `ideasGetWorkspace` (0 ideas: the staging Ideas sheet is empty), notifications | none |
| Scripts (via menu) | yes | `scriptsGetMetrics`, `scriptsList` (`scripts-controller-v1.2`), notifications | none |
| Approval Queue (via menu) | yes | `queueList`, `queueGetMetrics` (`queue-controller-v1.0`), notifications | none |

Limits, stated plainly: Google serves the app inside a sandboxed frame from another origin, so
the console read here is the outer page's; the app frame's own console cannot be read by the
tool. Every server call and render succeeded, and the same pages showed no errors in the
client-side check (round 1). The "API key required" badge is expected: staging deliberately
has no provider key.

### Fixture correction (test data only, separate commit `2fca32c`)

| | |
|---|---|
| Symptom | `testScriptFormatterAll` and `testScriptValidatorWithValidScript` fail: "Voiceover contains 57 words; minimum is 90" |
| Cause | Commit `e9e417b` (15 August 2026) made the validator count and time the **scene narration** instead of the AI's separate `voiceoverScript`. The shared Rome fixture kept its narration in `voiceoverScript`; its five scenes held only 57 words |
| Change | The fixture's scenes now carry the narration (same Rome sentences, two supporting ones dropped to fit the 130-word maximum: 114 words, about 49.6 s, no scene over 15 s), and `voiceoverScript` equals the joined narration. `testScriptValidatorRejectsShortVoiceover` also shortens the scene narration: with a valid fixture, shortening `voiceoverScript` alone is accepted, so the old test would have stopped testing anything |
| Not changed | Validation rules, the formatter, any production file |
| Guard | `node-tests/HandRunSelfTests_Tests.js` runs the pure hand-run self-tests offline (12 checks); against the old fixtures it fails 4 of 12 |
| Golden master | The ScriptEngine characterisation suite now reads a frozen copy of the old fixture (`node-tests/fixtures/legacy-rome-script.json`): its recorded results are unchanged byte for byte |
| Verified | Locally (12/12) and in the staging editor (formatter 4/4; validator valid, scene-order, short-narration and weak-hook tests) |

### Defect found in PR #32 (fixed in PR #34, see round 3)

| | |
|---|---|
| Test | `media-worker/test/submitConcurrentProcesses.test.js`, "eight simultaneous submissions with one request ID start exactly one execution, and all name one job" |
| Frequency | 2 failures in 52 runs on this Windows machine (1 in a full run, 1 in 20 isolated runs, 0 in 30). PR #32's own CI (Linux) has not shown it |
| What fails | Only "every answer names the same job". Exactly one execution and exactly one acceptance held in every run: **no duplicate paid render is possible** |
| Cause (reproduced and traced) | `media-worker/src/lib/dispatcherApp.js`, `POST /jobs`. When the job reservation is refused, only a request flagged `replay` gets the 200 replay report. The request that **created** the intent record is not flagged `replay`. If a duplicate of the same intent adopts its jobId and reserves the job first, the creator falls through to **409 "This jobId has already been submitted… needs the explicit recovery operation"**, with no jobId in the body, although its own render did start. Captured round: originator 409, duplicate 202, six others 200 |
| Origin | PR #32 commits `9c732d0` and `f0ee7e4` (13 November). The worker files are identical on this branch and on PR #32 |
| Why not fixed here | It changes the idempotency behaviour of PR #32's code, and PR #33 is a no-behaviour-change PR. It belongs in PR #32 |
| Suggested fix | In the `!reservation.reserved` branch, treat a request whose intent record names this jobId (prepared by the same intent) like a replay and return the replay report. Add a deterministic test where the replay reserves first |

### Blockers

None for staging acceptance. The PR #32 reply defect is fixed in PR #34 (round 3).

## Round 1: `d0811a2` against its base `4e4967c`

### Result (round 1)

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
| Pages in a browser against the live staging web app | **BLOCKED** in round 1 (multi-account browser); **PASS** in round 2 |
| Production unchanged | **PASS** |

### Evidence (round 1)

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

### Defects (round 1)

| Defect | Where | Status |
|---|---|---|
| `testScriptFormatterAll` fails: its fixture has 57 words, the validator's minimum is 90 | Hand-run self-test fixture; present at the PR #32 base `4e4967c` with the same message | **Pre-existing, not a refactor regression. Resolved in round 2 (`2fca32c`).** Changing the fixture is a test-data change outside a behaviour-preserving refactor. The validator self-tests in `Tests/ScriptValidator_SelfTests.gs` share that fixture and probably fail the same way (not run) |

No defect was found that needed a fix for staging compatibility, so no code was changed.

### Blockers (round 1, since cleared)

| Blocker | Cause | What would clear it |
|---|---|---|
| The live staging web app pages (Dashboard, Ideas, Scripts, Queue) could not be opened | The test deployment is limited to the owner. Chrome on this machine is signed in to several Google accounts and the staging owner is not the first, so Google shows "unable to open the file" for any web app of that account (a known multi-account limitation). No account was signed out | Owner: open the staging project as `dean.stewart.dev` → Deploy → Test deployments → open the web app URL in a browser window signed in **only** to that account (for example a guest or incognito window), then click Dashboard, Ideas, Scripts and Approval Queue and check that each loads. No paid action is involved; do not press Generate |

## Staging state now

Staging runs `2fca32c` (test deployment HEAD only), whose Apps Script code is identical to the integrated `bca17b4`. To return it to what it ran before this work
(closest to `6ef795a`), push that commit with the same guarded tool, or restore from the saved
snapshot held outside the repository.
