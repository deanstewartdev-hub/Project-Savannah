# v1.4 Release Readiness

Audit date: **21 October 2026**. Branch: `integration/v1.4-callback-inbox-and-duration-preflight`
([PR #15](https://github.com/deanstewartdev-hub/Project-Savannah/pull/15)). Tracked in issue #6.

Everything here was checked against the code, not the README. "Tested" means a CI test exercises
the real code path with Google services faked. **Nothing has been verified live**, and no
deployment, merge, callback-URL change, paid render or upload has been made.

## Summary

| Area | State |
|---|---|
| Code for v1.4 | Feature-complete for the Cloud Run pipeline; all known safe-to-fix defects fixed |
| CI | Green: 21 app suites (syntax 81 server files + 9 frontend scripts) and media worker 81/81 |
| Release blockers left | Owner-only: staging run, worker image, bridge deployment, cut-over, one real render, one private upload |

## 1. Prioritised backlog

### P0: release blockers

| # | Finding | Files | Status |
|---|---|---|---|
| P0-1 | This code ships `appsscript.json` with `access: MYSELF`. If it is deployed while `MEDIA_WORKER_CALLBACK_URL` still points at the main app, **every callback fails** (the worker cannot sign in). | `appsscript.json`, `Production/VideoProcessingProvider.js` | **Mitigated:** read-only release readiness check (Settings → Release readiness, `diagnoseReleaseReadiness`) BLOCKS this configuration. Cut-over order in §4. |
| P0-2 | 25 commits (callback-bridge isolation SAV-15, secret separation, `/jobs/status` reconciliation) sat between #3 and #5 with **no PR**. | `CallbackBridge/`, `Services/Services_Secrets.js`, `media-worker/src/lib/*` | **Fixed:** draft [PR #18](https://github.com/deanstewartdev-hub/Project-Savannah/pull/18) makes them reviewable. |
| P0-3 | Four sibling PRs (#13, #14, #16, #17) build on #12; two touch `App/ProductionController.js`. | — | **Fixed:** all integrated in #15 with merge commits; one trivial loader-list conflict resolved; combined suite green. Merge order in §3. |
| P0-4 | The **legacy callback route** (the one production uses today) recorded SUCCEEDED for a `completed` callback with an empty or non-https video URL. | `Production/MediaWorkerCallback_Service.js` | **Fixed** (`eabad3f`), 2 tests. |
| P0-5 | Live verification not done: staging, one real render, one private upload. | `CALLBACK_INBOX_STAGING.md`, `LIVE_ACCEPTANCE.md` | **Blocked on owner.** Staging is now automated (§5). |
| P0-6 | The live spreadsheet menu item **Project Savannah → Setup v1.0 Sheet** ran setup functions that clear the Scripts, SEO Pack, Approval Queue, Logs and Costs tabs. It only crashes before clearing by accident. | `Utils/Utils_Helpers.js`, `Main.js` | **Fixed** (`e023dc6`): setup never clears an existing tab; 4 tests. |
| P0-7 | Staging as first written copied the production spreadsheet (production data, possibly API keys, and YouTube access to the real channel). | staging docs and tools | **Fixed:** staging starts from empty files; spreadsheet-only permissions; paid/publishing calls refused in staging; two-condition staging guard; synthetic-message marker; push tool refuses the production script ID (`0bcabd3`, `d9efff8`, `6e4e17e`). |

### P1: fix before or soon after release

| # | Finding | Files | Status |
|---|---|---|---|
| P1-1 | Signed video links expire after 7 days. After that, uploads failed forever with "HTTP 400", and **there was no recovery**: delivery recovery's re-signed link was ignored because the render was already terminal. The only way out was a paid re-render. | `Production/VideoLink_Service.js`, inbox, legacy route, `publish()` | **Fixed** (`8f38ff6`): publish refuses clearly before recording an attempt; both callback routes accept a same-artifact link refresh; health warns 48 h ahead. |
| P1-2 | With Cloud Run, scene preparation buys GPT images the render never uses; the server and background queue did not prevent it. | `App/ProductionController.js`, `Production/ProductionQueue_Service.js` | **Fixed** (`a0e45be`). |
| P1-3 | Analytics stored **0 views for every video** and captured only the first 50 videos. | `Analytics/YouTubeAnalytics_Service.js` | **Fixed** (`4ae3ab1`), first analytics CI tests. Bug is live in production today. |
| P1-4 | An interrupted render submission is marked FAILED with a "Re-render safely" hint even if the worker accepted it, paying twice; its delivery was only set aside after 48 h. | controller, health | **Fixed** (`a397e70`): critical health finding after 15 min; procedure in `LIVE_ACCEPTANCE.md`. |
| P1-5 | Callback delivery was a single attempt; any transient error lost the result. | `media-worker/src/lib/callback.js` | **Fixed** (`6b5da59`), **needs a new worker image** to take effect. |
| P1-6 | A broken inbox sheet could stop the background queue and break the Production page. | controller, queue | **Fixed** (`2cd8eb9`, `21d0d89`). |
| P1-7 | Background queue cannot be enabled: `script.scriptapp` scope is not in the manifest. Without it, callbacks are processed only when someone opens Production. | `appsscript.json` | **Owner decision.** Adding a scope blocks the whole web app until re-authorised. Readiness check reports the state. |
| P1-8 | The human approval gate had no CI test. | `App/QueueController.js` | **Fixed** (`3768220`): 8 tests, mutation-checked; no defect found. |
| P1-9 | Default music track is a silent placeholder. | worker `DEFAULT_MUSIC_TRACK_PATH` | **Owner** (`APPROVALS_REQUIRED.md`). |
| P1-10 | Almost all tests use mocks; no realistic integration coverage. | `node-tests/` | **Improved:** `StagingFlowEndToEnd_Tests.js` runs the real bridge → inbox → verifier chain; live staging still required. |
| P1-11 | An immediate **Public** YouTube upload needed only one click; after a failed upload the card kept a stale upload button. | `Frontend/Assets/Scripts/Production.html` | **Fixed** (`7a8d75b`): second click required for public-now; list reloads on failure. |
| P1-12 | Render ID saved only after the worker request, so an interrupted submission could pay twice. | controller, provider | **Fixed in PR #19**, integrated (`67ab6cc`). |

### P2: worthwhile, not blocking

| # | Finding | Recommendation |
|---|---|---|
| P2-1 | Settings page is Creatomate-centric and shows nothing about the Cloud Run worker. | Replace the Creatomate card once v1.4's success condition allows removal (`ROADMAP.md`). The readiness card covers the worker meanwhile. |
| P2-2 | In-app `test*` functions that call paid OpenAI or write real rows (`testIdeaGenerationWithTracking`, `testScriptEngineLiveWorkflow`, `testAIServiceLiveConnection`, `testScriptsRepositoryUpdate`, `testLoggingService`) sat one click away in the editor Run menu. | **Fixed:** they refuse unless `SAVANNAH_ALLOW_LIVE_TESTS=true` (`Utils/LiveTestGuard.js`, 3 tests). |
| P2-3 | `publish()` holds the script lock for the whole download + upload; other actions report "busy" meanwhile. | Acceptable (it is what prevents duplicates). Revisit only if uploads become slow. |
| P2-4 | The inbox sheet grows forever; each receipt does a full Render Jobs read. | Archive handled receipts monthly; index Render Jobs once per pass if volume grows. |
| P2-5 | Callback secret compared with `===` in the bridge and the legacy route (timing leak). | **Fixed:** constant-time comparison in both, with near-miss tests. |
| P2-6 | Analytics insights are shown on the dashboard but never fed back into idea generation. | Product decision (`FUTURE.md`). |
| P2-7 | Docs drift: `README.md` and the app header say v1.3; `HANDOFF.md` is from 19 August; `CLAUDE.md` names `sprint-3` as canonical. | Update at release time, after the stack merges. |
| P2-8 | Creatomate code remains. | Remove only after the v1.4 success condition in `ROADMAP.md`. |

## 2. Workflow trace (verified in code)

| Stage | Entry point → code path | Implemented | CI-tested | Live-verified | Notes |
|---|---|---|---|---|---|
| Idea generation | `ideasGenerate` → `Ideas/Idea_Engine.js generateIdeasWorkflow` (OpenAI) | Yes | In-app only | Earlier releases | — |
| Script generation | `scriptsGenerateScript` → `Scripts/Script_Engine.js` + `Script_Validator.js` | Yes | Yes (prompt alignment, duration, options) | Earlier releases | Narration bounds also enforced at submit |
| Approval | `scriptsSendForReview` → `queueDecide` → `QueueController.decide` | Yes | **Yes (new)** | Earlier releases | Every render entry point requires APPROVED |
| SEO | `seoGenerate` → `SEO/Seo_Engine.js` (APPROVED only) | Yes | In-app only | Earlier releases | Feeds YouTube title/description/tags |
| Video preparation | Cloud Run: none (worker builds visuals). Creatomate: scene preparation | Yes | Yes | — | Preparation now refused under Cloud Run (P1-2) |
| Rendering | `productionSubmit` → `submitCore_` → dispatcher → Cloud Run job → callback → bridge → inbox → `Render Jobs` | Yes | Yes (inbox, bridge, reconciliation, staging e2e) | One real render (Aug, legacy callback route) | **Blocked:** staging + one render through the bridge |
| Quality checks | `RenderQualityService` (probe gates) + human review `RenderReviewService` | Yes | Yes | Aug render passed gates | — |
| YouTube publishing | `productionPublish` → `publish()` → `YouTubeService.upload` | Yes | Yes (48 upload-recovery cases) | **No** | **Blocked:** one private upload |
| Analytics | `analyticsRefresh` → `YouTubeAnalyticsService.capture/summary` | Yes | **Yes (new)** | Partly (views were wrong) | P1-3 fixed |
| Monitoring | Production health panel, readiness check, Logs sheet | Yes | Yes | No | — |

## 3. Merge order (owner)

```text
main ← #2 sprint-3 (fast-forward) ← #3 ← #18 (review gap) ← #5 ← #7 ← #8 ← #9 ← #10 ← #11 ← #12 ← #15
```

#15 contains #13, #14, #16, #17 and #19 as merge commits. Once #15 merges they become empty: close them
as "included in #15". Merge bottom-up, re-running CI at each step.

## 4. Production cut-over order (owner, after staging passes)

Do this with **no render in progress** (Production shows no active renders).

1. **Worker first.** Build and deploy the new dispatcher and render-job images. This is safe on its
   own: the retry change works with today's callback route.
2. **Production bridge.** Create it the same way as the staging bridge (`CALLBACK_INBOX_STAGING.md`
   Part 4), with these differences:
   - Name it `Savannah bridge`.
   - Set **only** two script properties: `MEDIA_WORKER_SHARED_SECRET` equal to the **production**
     main app's value, and `RENDER_JOBS_SPREADSHEET_ID` equal to the **production** spreadsheet ID.
   - **Never** add `SAVANNAH_ENVIRONMENT`: without it, the bridge refuses every synthetic test message.

   Before going on, compare `RENDER_JOBS_SPREADSHEET_ID` with the production spreadsheet's address.
   They must match exactly.
3. **Callback URL, then main app.** In the production project: **Project Settings → Script
   Properties → Edit** `MEDIA_WORKER_CALLBACK_URL`. Set it to the production bridge's `/exec` URL
   exactly, with nothing after `/exec`. Then deploy the merged main app as a new version of the
   **same** deployment (**Deploy → Manage deployments → edit (pencil) → Version: New version → Deploy**).
   In between, deliveries wait safely in the inbox, so nothing is sent to an address that rejects it
   (this matches the order in `CallbackBridge/CallbackBridge.js`).
4. **Readiness and identity.** Open the app → **Settings → Release readiness → Run readiness check**:
   - There must be no BLOCK.
   - Its "spreadsheet" line shows the last 6 characters of the main app's spreadsheet ID, and they must
     match the end of the bridge's `RENDER_JOBS_SPREADSHEET_ID`.
   - In the editor, run `diagnoseCallbackInbox` (read-only) for the full ID if needed.
5. **Live acceptance.** `LIVE_ACCEPTANCE.md`: one real render, review, one private upload.
6. **Optional.** Background automation (`script.scriptapp` scope) as a separate, planned
   re-authorisation.

**Rollback:** set `MEDIA_WORKER_CALLBACK_URL` back and redeploy the previous main version (v89).
Receipts already in the inbox stay safe and are applied once the new version returns.

## 5. Staging readiness

Fully prepared and automated: `CALLBACK_INBOX_STAGING.md` (plain-language guide, three steps,
checks C1–C12, troubleshooting). Its correctness is proven locally by
`node node-tests/StagingFlowEndToEnd_Tests.js`. Not yet run against Google.

## 6. Independent verification and later additions

Added 21 October 2026 by a second review session. Each line below was **run or measured**, not read from
the sections above. Still nothing verified live.

### 6.1 What was re-checked, and how

| Claim above | How it was checked | Result |
|---|---|---|
| #13, #14, #16, #17, #19 are inside #15 | `git merge-base --is-ancestor <PR head> <integration head>` for each | Confirmed. #20, #21 and #22 are **not** yet inside it |
| CI is green, media worker 81/81 | CI run 39684626370 on `3796f38`: both jobs `success`; media-worker log shows 81 tests, 81 pass, 0 fail | Confirmed |
| P0-1: the main app ships `access: MYSELF` | `appsscript.json` read; `CallbackBridge/appsscript.json` read | Confirmed (`MYSELF` vs `ANYONE_ANONYMOUS`) |
| P1-7: no `script.scriptapp` scope | Manifest scopes listed | Confirmed: five scopes (sheets current-only, external request, drive, YouTube upload, YouTube read-only) |
| All sibling PRs combine cleanly | `git merge-tree` of every pair, then a **disposable worktree** of integration head + #20 + #21 + #22 running `node node-tests/run-local.cjs` | Exit 0, 28 suites, 0 failures, no conflict markers in tracked files |
| Open PRs mergeable | GitHub `mergeStateStatus` for #15, #16, #17, #19, #20 | `CLEAN` for all five when checked |

Not verified here: the media-worker suite on the combined tree (the new PRs do not touch `media-worker/`;
CI on each PR is the evidence), and anything that needs Google or Cloud Run.

### 6.2 Changes not yet in #15

| PR | What | Base | Why it matters |
|---|---|---|---|
| #20 | Background queue: stuck `SUBMITTING` tasks settled, poison tasks contained, interrupted retries capped with backoff, submit claim is a locked compare-and-set | integration | Without it a task that dies mid-submit is stuck forever and one bad task starves the queue |
| #21 | Tests only: queue x reserved render ID x callback inbox, on real modules (10 tests) | #20 | Proves #19, #20 and the inbox work together, including overlapping work |
| #22 | Health panel reports stuck/failed/exhausted queue tasks and unconfirmed submissions (read-only) | #20 | Operator sees these states instead of finding them in a sheet |
| #23 | This addendum and the owner-facing improvements to `LIVE_ACCEPTANCE.md` | #22 | Docs only |

**Merge sequence for these:** #20 into the integration branch first, then #21 and #22 (re-point their base
to the integration branch if GitHub does not do it), re-run CI, then continue with §3. They can also wait
until after #15 if you prefer a smaller first merge; nothing in §4 depends on them, but without #20 the
queue defects above remain.

### 6.3 Remaining risks I found (not fixed, by design)

| # | Risk | Why left | Mitigation now |
|---|---|---|---|
| R1 | "Unmatched delivery" recovery (`LIVE_ACCEPTANCE.md` §9) has you edit four cells in Render Jobs by hand. A typo could link a video to the wrong render | A guarded editor function is the right fix but is new behaviour on live data, not a safe autonomous change | Procedure says to stop if more than one render could match; do it only with the Cloud Run execution checked |
| R2 | Health thresholds (5 / 10 / 45 min, 1 h, 3 h) and the queue limits (10 min, 3 attempts) are reasoned defaults, not measured | Needs real render timings | Tune after the first live acceptance |
| R3 | `recoverStaleJobs_` still marks a QUEUED render **with no render ID** FAILED after 15 minutes. Since #19 a Cloud Run render always has an ID before the worker is called, so this only affects rows created by the *old* version | Rows from the old version only | Do the cut-over with no render in progress (§4); do not leave old-version renders running across it |
| R4 | The queue retry cap and backoff mostly protect the Creatomate fallback: Cloud Run refuses scene preparation | Intended | None needed |
| R5 | Test realism: the new interplay suite uses the real modules but fake sheets, a fake lock and a fake dispatcher. Real Apps Script locking, quotas and Sheets timing are untested | Needs the live run | Section 5 of `LIVE_ACCEPTANCE.md` is the proof |
| R6 | Rollback is documented but has never been exercised | Needs the live run | Before cut-over, confirm the previous app version (v89) still appears under **Deploy → Manage deployments** and note the old `MEDIA_WORKER_CALLBACK_URL` |

### 6.4 Owner actions still required (in order)

1. Staging check from empty files (`CALLBACK_INBOX_STAGING.md`).
2. Decide the `script.scriptapp` scope (P1-7); it forces a one-time re-authorisation.
3. Cut-over in the order of §4 (worker images, bridge, callback URL then app, readiness check).
4. Live acceptance (`LIVE_ACCEPTANCE.md`): one paid render, review, one private upload, duplicate checks.
5. Product decisions: licensed music track (P1-9), side-by-side comparison before any Creatomate removal (P2-8).

### 6.5 Deployment dependencies

- The callback retry (P1-5) takes effect only with a **new worker image**; the app changes work without it.
- Everything in the app is one Apps Script deployment; the bridge is a separate project with its own two properties.
- Nothing depends on a Sheet schema change. The queue and health changes read existing columns.

### 6.6 Release readiness, plainly

Code and automated tests: ready for the owner-run steps above. Live behaviour: **not demonstrated**. No
percentage is given because the remaining work is a short list of owner actions, not a quantity of code.
