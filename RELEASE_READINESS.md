# v1.4 Release Readiness

Audit date: **21 October 2026**. Branch: `integration/v1.4-callback-inbox-and-duration-preflight`
([PR #15](https://github.com/deanstewartdev-hub/Project-Savannah/pull/15)). Tracked in issue #6.

Everything here was checked against the code, not the README. "Tested" means a CI test exercises
the real code path with Google services faked. **Update, 23 October 2026:** the callback inbox,
queue and recovery workflow have now been **verified live in an isolated staging environment**
(two passing runs, §7). No production deployment, merge, callback-URL change, paid render or
upload has been made.

## Summary

| Area | State |
|---|---|
| Code for v1.4 | Feature-complete for the Cloud Run pipeline; all known safe-to-fix defects fixed |
| CI | Green: all app suites (syntax 84 server files + 9 frontend scripts) and media worker 81/81 |
| Live staging | **PASSED** twice on real Apps Script: 12/12 bridge checks and C1–C12 (§7) |
| Release blockers left | Owner-only: worker image, production bridge, cut-over, one real render, one private upload |

## 1. Prioritised backlog

### P0: release blockers

| # | Finding | Files | Status |
|---|---|---|---|
| P0-1 | This code ships `appsscript.json` with `access: MYSELF`. If it is deployed while `MEDIA_WORKER_CALLBACK_URL` still points at the main app, **every callback fails** (the worker cannot sign in). | `appsscript.json`, `Production/VideoProcessingProvider.js` | **Mitigated:** read-only release readiness check (Settings → Release readiness, `diagnoseReleaseReadiness`) BLOCKS this configuration. Cut-over order in §4. |
| P0-2 | 25 commits (callback-bridge isolation SAV-15, secret separation, `/jobs/status` reconciliation) sat between #3 and #5 with **no PR**. | `CallbackBridge/`, `Services/Services_Secrets.js`, `media-worker/src/lib/*` | **Fixed:** draft [PR #18](https://github.com/deanstewartdev-hub/Project-Savannah/pull/18) makes them reviewable. |
| P0-3 | Four sibling PRs (#13, #14, #16, #17) build on #12; two touch `App/ProductionController.js`. | — | **Fixed:** all integrated in #15 with merge commits; one trivial loader-list conflict resolved; combined suite green. Merge order in §3. |
| P0-4 | The **legacy callback route** (the one production uses today) recorded SUCCEEDED for a `completed` callback with an empty or non-https video URL. | `Production/MediaWorkerCallback_Service.js` | **Fixed** (`eabad3f`), 2 tests. |
| P0-5 | Live verification: staging, one real render, one private upload. | `CALLBACK_INBOX_STAGING.md`, `LIVE_ACCEPTANCE.md` | **Staging done:** passed live twice on 23 Oct (§7). **Still blocked on the owner:** one real render and one private upload. |
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

#15 contains #13, #14, #16, #17, #19, #20, #21, #22 and #23 as merge commits. Once #15 merges they
become empty: close them as "included in #15". Merge bottom-up, re-running CI at each step.

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
`node node-tests/StagingFlowEndToEnd_Tests.js` and `StagingProjectSimulation_Tests.js`. **Run against
Google on 23 Oct 2026: PASSED twice (§7).**

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

### 6.2 Changes not yet in #15 (now integrated: see §7.1)

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

1. ~~Staging check from empty files (`CALLBACK_INBOX_STAGING.md`).~~ **Done, 23 Oct 2026** (§7).
2. Decide the `script.scriptapp` scope (P1-7); it forces a one-time re-authorisation.
3. Cut-over in the order of §4 (worker images, bridge, callback URL then app, readiness check).
4. Live acceptance (`LIVE_ACCEPTANCE.md`): one paid render, review, one private upload, duplicate checks.
5. Product decisions: licensed music track (P1-9), side-by-side comparison before any Creatomate removal (P2-8).

### 6.5 Deployment dependencies

- The callback retry (P1-5) takes effect only with a **new worker image**; the app changes work without it.
- Everything in the app is one Apps Script deployment; the bridge is a separate project with its own two properties.
- Nothing depends on a Sheet schema change. The queue and health changes read existing columns.

### 6.6 Release readiness, plainly

Code and automated tests: ready for the owner-run steps above. Live behaviour: **demonstrated in staging**
(§7) for callbacks, the inbox, the queue and recovery; still **not demonstrated** for a real render, the
real worker-to-bridge path and a YouTube upload. No percentage is given because the remaining work is a
short list of owner actions, not a quantity of code.

## 7. Live staging acceptance and integration of #20–#23 (23 October 2026)

### 7.1 Integration

| PR | Merged into #15 as | Conflicts | Evidence |
|---|---|---|---|
| #23 (contains #22 and #20) | `b49778a` | None | Queue reliability 17/17, production health (queue) 15/15 |
| #21 | `34137f6` | None | Queue × submission × callback interplay 10/10 |
| New regression test | `98da503` | — | In a simulated spreadsheet-only staging project, a queue tick contains a failing READY task (not retried, no internet access) |

`ProductionQueue_Service.js` keeps both this branch's Cloud Run guard and inbox-failure containment and
#20's stall review, backoff and poison-task containment. Local runner: exit 0, every suite green
(syntax 84 server files and 9 frontend scripts).

### 7.2 Isolated staging environment (owner account dean.stewart.dev)

| Component | ID | Isolation |
|---|---|---|
| Savannah STAGING spreadsheet | `1lco-iCL…ZI3nA` | Created empty; no production data |
| Staging main project | `1Lwxw64D…EFihV2f` | Manifest: `spreadsheets.currentonly` only, no YouTube service; `SAVANNAH_ENVIRONMENT=staging` |
| Savannah STAGING bridge | `1eVGe56y…oXw6dTvu`, web app @1 | Writes only to the staging spreadsheet; `SAVANNAH_ENVIRONMENT=staging`; staging-only secret (fingerprint `f6e4991c…`, never displayed) |

Before each run, a read-only `clasp clone` of the staging project was compared file-by-file with the
branch: 0 differences in both runs (`e698d39`, then `98da503`).

### 7.3 Results

| Run | Code | 12 bridge checks | `stagingVerifyRun` |
|---|---|---|---|
| f8001e19 | `6c3d01f` (before #20–#23) | 12/12 PASS | **PASSED**, C1–C12 PASS |
| ad3d0f86 | `98da503` (with #20–#23) | 12/12 PASS | **PASSED**, C1–C12 PASS |

Inbox outcome of the first run, as designed: 9 receipts (12 sent, 3 refused at the bridge), with 3
APPLIED, 2 IGNORED_TERMINAL, 1 LINK_REFRESHED, 2 REJECTED_NO_VIDEO and 1 held (unknown render). C12
reports BLOCKED, which is expected: staging deliberately has no worker URL, job secret or callback URL.

### 7.4 Production verified unchanged (read-only, after both runs)

- Deployments: `@89` (`AKfycbzfD4…`), HEAD and `@1`, unchanged. Versions: 89.
- Code (`clasp clone`, read-only): 112 files, the v89 manifest (`ANYONE_ANONYMOUS`), none of the new files. Code last modified 17 Aug 2026.
- Script properties: the same 12 names; **no** `SAVANNAH_ENVIRONMENT`. Triggers: 0.
- Executions: **none on 23 Oct**. The newest is `onOpen`, 22 Oct 23:20, from before the staging bridge existed.
- The production spreadsheet was not opened (to avoid running its `onOpen`); Drive shows it last modified 22 Oct.
- Incident disclosed in issue #6: a malformed shell command ran broken `clasp` sub-commands from the
  repository folder; all failed at argument parsing before contacting Google. The checks above were taken afterwards.

### 7.5 What staging does not prove

- The real worker → bridge path, including the worker's callback retry (needs a new worker image).
- A real render through Cloud Run, video quality, and a YouTube upload.
- Real-world timings behind the health and queue thresholds (R2).

## 8. Worker image deployment preflight (24 October 2026)

Prepared and verified read-only. **Nothing below §8.5 has been executed**; it waits for the owner's approval.
Project `savannah-media-worker`, region `europe-west2`, gcloud account dean.stewart.dev. Billing
(dean99992011) is charged.

### 8.1 What runs in production today (read from the live services)

| Resource | Image | Code inside (source layer compared with git) | Other settings (unchanged by this deploy) |
|---|---|---|---|
| Service `savannah-media-worker-dispatcher` | `media-worker:v11`, revision `00008-btl`, 100% traffic | exactly `c9c1e3c` (13 Aug) | 1 vCPU / 512Mi, max 20 instances, scales to zero; `JOB_SUBMIT_SECRET` ← `job-submit-secret:latest`; SA `savannah-dispatcher@` |
| Job `savannah-render-job` | `media-worker:v7` | exactly `963dbbf` (12 Aug) | 2 vCPU / 2Gi, timeout 1200 s, 0 retries; secrets openai, elevenlabs ×2, pexels, job-submit; SA `savannah-render-job@` |

No render execution is running; the last one was on 18 Aug.

### 8.2 What the new image (`v12`, built from the branch head) changes

| Commit | Change | Dispatcher (from v11) | Render job (from v7) |
|---|---|---|---|
| `fd659d8` | Refuses to start if a secret has whitespace or control characters | yes | yes |
| `8cf3535` | Fails closed if the job-submission secret is missing | yes | yes |
| `33e7226` | Callback secrets redacted from worker errors and logs | yes | yes |
| `6b5da59` | Callback delivery retried for transient failures (4 attempts, 2/10/30 s) | (shared code) | **yes**: this is the job that sends callbacks |
| `89d8f57`–`c9c1e3c` | `/jobs/status` code | already in v11 | present but unused by the job |
| `6db099b` | Railway retired: storage always uses the attached service account and refuses the inline-key variable | yes | yes |

No dependency, Dockerfile or configuration change (`package.json` only gained a `test` script).

### 8.3 Verification already done (no production change)

- **Secrets** (worker's exact rules, values read only into memory; only verdicts printed): `job-submit-secret` v1, `openai-api-key` v4, `elevenlabs-api-key` v1, `pexels-api-key` v1 and `elevenlabs-voice-id` v1 are all **CLEAN**. The new start-up validation will pass.
- **Local image smoke** (only `package*.json` + `src/`, `npm ci --omit=dev`, Node 22.23.4, the Docker base version), 8/8:
  - the job runner loads with clean secrets, then exits with "JOB_ID env var is required"
  - a malformed secret is refused with no value in the output
  - the dispatcher refuses a malformed submit secret
  - the dispatcher serves `/health`, and `/jobs` and `/jobs/status` return 401 without the secret
- **Media-worker tests:** 81/81 on Node 22. **App suites:** all green.
- **Build upload contents:** `gcloud meta list-files-for-upload` lists 32 files, with no credentials (fix `06f2d65`).

### 8.4 Security finding (needs owner approval to remediate)

The local key `media-worker/gcp-key.json` (service account `media-worker-railway@`, key `c56e3d6a…`, created 6 Aug, never
expires, `storage.objectAdmin` on `gs://savannah-media`) was uploaded with each earlier Cloud Build. The newest of the
**12 archives in `gs://savannah-media-worker_cloudbuild/source/`** contains it. The bucket is private to the project, and no
image contains the key. Recommended:
1. Rotate the key. If the Railway rollback is still wanted, create a new key and update Railway; otherwise disable the key.
2. Delete those 12 source archives.
3. Delete the local key files once Railway no longer needs them.

### 8.5 Deployment steps (each needs approval; run from the repository root in PowerShell)

```powershell
$img = "europe-west2-docker.pkg.dev/savannah-media-worker/savannah-media-worker/media-worker:v12"
```

1. **Build** (about 3–5 min). The source upload is key-free:
   ```powershell
   gcloud builds submit media-worker --tag $img
   ```
2. **Dispatcher canary, no traffic:**
   ```powershell
   gcloud run services update savannah-media-worker-dispatcher --region europe-west2 --image $img --no-traffic --tag candidate --update-secrets=JOB_SUBMIT_SECRET=job-submit-secret:1
   ```
   Check `https://candidate---savannah-media-worker-dispatcher-d6ycwdbyla-nw.a.run.app/health` returns 200, and that POST `/jobs` without auth returns 401.
   Pinning `job-submit-secret:1` (today's value, so behaviour is identical) is the first step of the §10 rotation: with
   `latest`, adding the new version would make every newly started instance reject Apps Script's current value.
3. **Promote** the canary:
   ```powershell
   gcloud run services update-traffic savannah-media-worker-dispatcher --region europe-west2 --to-latest
   ```
4. **Render job:** image only; secrets, limits and service account are kept:
   ```powershell
   gcloud run jobs update savannah-render-job --region europe-west2 --image $img
   ```
5. **Job smoke** (seconds of compute, no provider call, no callback):
   ```powershell
   gcloud run jobs execute savannah-render-job --region europe-west2 --wait
   ```
   **Expected:** the execution FAILS with "JOB_ID env var is required" in its log and no secret-format error. Read it with:
   ```powershell
   gcloud logging read 'resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"savannah-render-job\"' --freshness=10m --limit=10
   ```
   (The `\"` escapes are needed in Windows PowerShell 5.1, which otherwise strips the inner quotes and gcloud rejects the filter.)

### 8.6 Rollback (seconds; v7 and v11 stay in the registry; do not delete them)

```powershell
gcloud run services update-traffic savannah-media-worker-dispatcher --region europe-west2 --to-revisions savannah-media-worker-dispatcher-00008-btl=100
```

```powershell
gcloud run jobs update savannah-render-job --region europe-west2 --image europe-west2-docker.pkg.dev/savannah-media-worker/savannah-media-worker/media-worker:v7
```

No data, schema, secret or callback change is involved, so rollback restores the exact previous state. **Exception:** while
a §10 rotation overlap is open, roll back only to a pinned v12 revision. Revision 00008-btl (v11) reads `latest` and does not
understand `JOB_SUBMIT_SECRET_PREVIOUS`, so it would reject whichever value Apps Script holds if that is not the newest.

### 8.7 Estimated cost

| Item | Estimate |
|---|---|
| Cloud Build (one build, about 5 min) | £0 within the monthly free build minutes; otherwise under £0.05 |
| Artifact Registry (+260 MB image) | about £0.02–0.03 per month |
| Dispatcher revision | £0 while idle (scales to zero) |
| Job smoke execution | under £0.01 |
| **Total for this deployment** | **under £0.10 one-off, about £0.03 per month** |

Not part of this deployment: each real render later costs Cloud Run compute (pennies) plus ElevenLabs and OpenAI usage. That
is the separate, approval-gated live-acceptance step.

## 9. Railway key retirement and exposed-archive cleanup (24 October 2026)

Owner decision: Railway is permanently retired; Cloud Run is the rendering platform. Each stage needs explicit approval.
**Stage A was approved and executed on 25 October 2026 (§9.6).** Stages B–E are prepared, not executed; §10 is the
coordinated credential rotation, and §9.7 the revised order.

### 9.1 Does anything depend on the Railway key? **No.**

| Checked | Result |
|---|---|
| Production main app `MEDIA_WORKER_URL` | Points at the Cloud Run **dispatcher** (`savannah-media-worker-dispatcher-…-nw.a.run.app`), not Railway |
| Cloud Run runtime identities | Dispatcher: `savannah-dispatcher@`; render job: `savannah-render-job@`; the two legacy services: the default compute account. **None runs as `media-worker-railway@`** |
| Inline-key variable on any Cloud Run service or job | None set (every service checked) |
| Cloud Build | Uses its own service account; no triggers |
| Artifact Registry and images | Pull and push use the Cloud Build and runtime accounts; no image contains the key (v7/v11 source layers and both legacy images checked by file name) |
| Secret Manager | No secret holds the key (5 secrets, all provider and submit secrets) |
| Rollback process (§8.6) | Uses gcloud as the owner account and the existing images; does not touch the key |
| Code (`6db099b`) | The inline-key path is removed; the variable is now refused at start-up |

**The service account `media-worker-railway@savannah-media-worker.iam.gserviceaccount.com`** (display name "Media Worker
(Railway, GCS-only)", unique ID `113584502099553594714`):
- **Roles:** only `roles/storage.objectAdmin` on `gs://savannah-media`; no project roles; no one may act as it.
- **Keys:** one user-managed key, **`c56e3d6ae90a2bd84e99bbeace72ce73ef5c9ab5`** (created 6 Aug 2026, never expires; **disabled 2026-10-24T23:54Z**, Stage A). The two system-managed keys are Google-internal and cannot be downloaded.

### 9.2 Audit findings and their limits

| Evidence | Finding | Strength |
|---|---|---|
| Cloud Monitoring `iam.googleapis.com/service_account/key/authn_events_count` and `…/service_account/authn_events_count`, 12 Sep – 24 Oct 2026 | **No authentication events** for any key or account (a control query on the same API returned all 42 daily points) | Good evidence of **no key use in the last 6 weeks**; nothing earlier than 12 Sep is covered |
| Admin Activity audit logs (400-day retention) | **0 entries made as the account**; 1 entry about it: `CreateServiceAccountKey`, 6 Aug, by the owner | Admin-type activity only |
| Data Access audit logs | **Off** (the project default), including Cloud Storage object reads and writes, the key's only capability | **Cannot confirm** whether the key read or wrote bucket objects |
| Policy Analyzer "key last authentication" | API not enabled (not changed) | Optional: enabling it (free) gives a direct last-used timestamp |
| Who can read the exposed archives | Only the owner account, Google service agents and the default compute account (Editor); every archive's ACL is private | Exposure confined to project principals; reads by them cannot be ruled out (Data Access logs off) |

### 9.3 What was exposed, and where (identified by file name and value fingerprint only)

All **12 Cloud Build source archives** contain `gcp-key.json`, `gcp-key-b64.txt` and `b64-chunk-0..3.txt` (the Railway key),
plus **`.env`**. The **3 `run-sources` zips** (4 Aug, before the key existed) also contain `.env`. In those `.env` copies:

| Variable | Matches today's production secret? | Consequence |
|---|---|---|
| `JOB_SUBMIT_SECRET` | **Yes (live)** | Holder can start **paid** renders through the public dispatcher |
| `ELEVENLABS_API_KEY` | **Yes (live)** | Holder can spend ElevenLabs credit |
| `PEXELS_API_KEY` | **Yes (live)** | Free API, rate-limit abuse |
| `ELEVENLABS_VOICE_ID` | Yes | An identifier, not a secret |
| `OPENAI_API_KEY` | No: an **older** key (production uses v4) | Revoke it at OpenAI if it is still active (only the dashboard can tell) |

**Not exposed:** git history (no key material, key-ID field or key file on any branch); no images; no secrets. Local copies
remain on the owner's PC: `media-worker/gcp-key.json`, `gcp-key-b64.txt`, `b64-chunk-*.txt` and `media-worker/.env`. Railway's
own variables (outside Google) also held them.

**Additional risk found:** the two legacy Cloud Run services, `savannah-media-worker` (europe-west2) and
`savannah-media-worker-test` (us-central1), are **publicly invokable** (`allUsers`), run the old all-in-one worker, and wire
in the live secrets. Today they return 404 (the old image has no `/health` route), but that could change.

**Found on 25 October: a second project, `savannah-worker-2`** (number 29658067982, owner-created 4 Aug 2026), holds a
**third legacy copy**:
- Cloud Run service `savannah-media-worker` (us-central1), public (`allUsers` invoker, ingress all), running as that
  project's default compute account, returning 404.
- Its own Secret Manager copies, compared by fingerprint only: `job-submit-secret`, `elevenlabs-api-key`, `pexels-api-key`
  and `elevenlabs-voice-id` **match today's production values**. `openai-api-key` is the **older OpenAI key** from the
  archives.
- A 16th source archive containing the same `.env`: `gs://run-sources-savannah-worker-2-us-central1/services/savannah-media-worker/1785840812.901701-6d29d2e2900f42d58a588b5fe19d534b.zip`,
  generation `1785840813372336`. All four `run-sources` zips are byte-identical (same MD5).
- **Cross-project access:** its default compute account, `29658067982-compute@developer.gserviceaccount.com`, has
  `roles/storage.objectAdmin` on the production bucket `gs://savannah-media`.
- No user-managed service-account keys. The owner's other two projects ("My First Project") have no Cloud Run, secrets,
  buckets or user-managed keys.

**Disabled but not destroyed:** production `openai-api-key` versions 1–3 (the current key is version 4). They probably
hold the older key(s), and anyone with Secret Manager admin could re-enable them. Destroy them once the old OpenAI key is
revoked (§10.3).

**Objects proposed for deletion (15 here, plus the 16th in `savannah-worker-2` listed above)**, by name and generation:

| Bucket | Object | Generation |
|---|---|---|
| `savannah-media-worker_cloudbuild` | `source/1786459426.577613-a3be5b1b6d9b46c69de3bf09f06f9b94.tgz` | `1786459461758206` |
| 〃 | `source/1786460138.368973-0e6786805ec241149e24513226f2a5de.tgz` | `1786460146684140` |
| 〃 | `source/1786461167.097622-c4a8bf45e4ea44a898554de0b0bca078.tgz` | `1786461175036041` |
| 〃 | `source/1786466727.043584-3224ab665e8a431c806b4a3f3ebf3087.tgz` | `1786466768218518` |
| 〃 | `source/1786474148.991043-db932edb00dd400391b7cdc3a5b1f56d.tgz` | `1786474157011728` |
| 〃 | `source/1786474773.175906-e07cda6d8324462a808c9b59f2f642d4.tgz` | `1786474780233359` |
| 〃 | `source/1786489587.398235-2a71d7c25062421ea1b74868877f3b77.tgz` | `1786489630904381` |
| 〃 | `source/1786578582.261914-78854e43fe20495ca188acde7e322d2c.tgz` | `1786578625213267` |
| 〃 | `source/1786578649.148566-32e02cc4d13b4440a6436e8ba39ce626.tgz` | `1786578656849758` |
| 〃 | `source/1786579310.692389-ee85d61273b246bca240e293b588ec67.tgz` | `1786579319454564` |
| 〃 | `source/1786580975.257317-941118eb5d394b47a8c054325225eef2.tgz` | `1786580984340089` |
| 〃 | `source/1786646276.226725-29c4034a85c040f4b293f81c088dcd31.tgz` | `1786646318077613` |
| `run-sources-savannah-media-worker-europe-west2` | `services/savannah-media-worker/1785802652.161422-dd23b30bd3bb409994beb9eed05d4977.zip` | `1785802652147192` |
| 〃 | `services/savannah-media-worker/1785802858.592545-48ed04b485f44e9e952f8ef69a4f913d.zip` | `1785802858428016` |
| `run-sources-savannah-media-worker-us-central1` | `services/savannah-media-worker-test/1785839857.482359-b198b3b0505a402cb183da0d072844a7.zip` | `1785839857774094` |

**Bucket protections, all three buckets:** versioning off; **soft delete 7 days**; no retention policy, no object holds, no
default event-based hold, no lifecycle rule; no soft-deleted copies exist today. Nothing blocks deletion; a normal delete
leaves a copy restorable by project principals for 7 days.

### 9.4 Procedures (approval-gated; PowerShell, gcloud as the owner account)

```powershell
$sa  = "media-worker-railway@savannah-media-worker.iam.gserviceaccount.com"
$key = "c56e3d6ae90a2bd84e99bbeace72ce73ef5c9ab5"
```

**Stage A: disable the Railway key (reversible). Done 2026-10-24T23:54Z; results in §9.6.**
```powershell
gcloud iam service-accounts keys disable $key --iam-account $sa
```
- **Verify:** `gcloud iam service-accounts keys list --iam-account $sa` shows `DISABLED True`; the dispatcher `/health` still returns 200; dispatcher and job identities are unchanged.
- **Undo:** `gcloud iam service-accounts keys enable $key --iam-account $sa`.
- **Then (also reversible):** remove the bucket role with `gcloud storage buckets remove-iam-policy-binding gs://savannah-media --member="serviceAccount:$sa" --role=roles/storage.objectAdmin`, and disable the account with `gcloud iam service-accounts disable $sa`.

**Stage B: delete the 16 exposed archives (targeted; soft delete left on). Revised 25 October; details in §10.4.**
Bucket-wide soft delete is **not** turned off. Google's documentation is explicit that soft-deleted objects keep the retention
in force when they were deleted, so clearing the policy afterwards purges nothing, and no single soft-deleted object can be
purged early. A normal delete therefore always leaves a 7-day restorable copy; it is acceptable because:
- after §10, every credential inside the archives is dead (rotated or revoked; the Railway key is disabled and later deleted
  in Stage E);
- a soft-deleted object cannot be read, only listed or restored, and only by Storage Admin-level project principals.

Evidence is kept first: `tools/security/archive-evidence-2026-10-25.json` records every object's bucket, name, generation,
size, CRC32C, MD5, creation time and Cloud Build ID, plus the credential entry names (no contents). Cloud Build history
entries stay. Commands and verification: §10.4.

**Stage C: rotate the live credentials found in `.env`.** Superseded by the coordinated, no-interruption procedure in §10.

**Stage D: remove the three legacy public services (revised 25 October).** No callers (§9.6):
```powershell
gcloud run services delete savannah-media-worker --region europe-west2 --project savannah-media-worker
gcloud run services delete savannah-media-worker-test --region us-central1 --project savannah-media-worker
gcloud run services delete savannah-media-worker --region us-central1 --project savannah-worker-2
```
Then, in `savannah-worker-2`:
- Remove its cross-project bucket access:
  ```powershell
  gcloud storage buckets remove-iam-policy-binding gs://savannah-media --member="serviceAccount:29658067982-compute@developer.gserviceaccount.com" --role=roles/storage.objectAdmin
  ```
- Either delete its five secrets (`gcloud secrets delete <name> --project savannah-worker-2`), or **shut down the whole
  project** (`gcloud projects delete savannah-worker-2`: recoverable for 30 days, then permanent; it holds nothing else).
  Shutting it down is recommended.

Redeploying is the only way back for the services, and nothing uses them. Optionally also delete their
`cloud-run-source-deploy` images and the emptied `run-sources-*` buckets. Do D **before** §10.2, so the new provider keys
are never wired into a public legacy service (they read `latest` at start-up).

**Stage E: permanent deletion (irreversible), after at least 7 days with no problems.**
```powershell
gcloud iam service-accounts keys delete $key --iam-account $sa --quiet
gcloud iam service-accounts delete $sa --quiet
```
The account can be undeleted for 30 days with `gcloud iam service-accounts undelete 113584502099553594714`; **a deleted key can
never be restored**. Then delete the local key files on the owner's PC.

**Then:** the v12 worker deployment (§8), as a separate approval. It now also includes `6db099b`.

### 9.5 Costs

| Stage | Cost |
|---|---|
| A, D, E | Nothing; removes resources |
| B | Nothing; frees about 100 MB (if soft delete stays on, the deleted copies cost a fraction of a penny for 7 days) |
| C | None in Google; provider keys are free to regenerate |
| Optional: enable the Policy Analyzer API for key last-used evidence | Free for this query |

### 9.6 Stage A results (executed 2026-10-24T23:54:27Z, approved by the owner)

**Final dependency check, immediately before:** no Cloud Run service or job runs as `media-worker-railway@`. Env wiring was
read by variable name only: no inline-key variable anywhere. The key had **no authentication events in the 42 days to 24
Oct**. The account's only grant is still `objectAdmin` on `gs://savannah-media`.

**Action:** `gcloud iam service-accounts keys disable c56e3d6ae90a2bd84e99bbeace72ce73ef5c9ab5 --iam-account media-worker-railway@…`.
The key is listed `DISABLED True`. The service account itself stays enabled, and nothing was deleted.

**Health after the change:**

| Check | Result |
|---|---|
| Dispatcher `GET /health` | 200 `{"status":"ok"}` |
| Dispatcher authenticated `POST /jobs/status` for the last successful render (read-only) | 200: `state SUCCEEDED`, `artifactExists true`, `probeExists true`, `probePassed true`. The dispatcher's own account still reads `gs://savannah-media` and the Cloud Run Jobs API |
| Render job | Unchanged: image v7, `savannah-render-job@`, generation 9; secret access intact for all five secrets; `objectAdmin` on the bucket intact (not executed: that would be a paid render) |
| Cloud Run errors since the change | 0 |

**Legacy service callers:** request logs (30-day retention, 25 Sep – 24 Oct) and Cloud Monitoring `request_count` (42 days)
show **exactly one request to each of the three legacy services**: my own `/health` probes on 24 Oct, from curl and
PowerShell. No code or config refers to their URLs. The default compute account's two sign-ins on 24 Oct match those
probes, which started instances that read their secrets.

### 9.8 Stage D record (approved; executed 25 October 2026, 00:13–00:15 UTC)

**Immediately before each change:** the service had no requests since 24 Oct other than my own `/health` probe; it was
not in the rollback plan (§8.6 uses only dispatcher revision 00008-btl and `media-worker:v7`/`v11`); and its image was still
in its registry. The `savannah-worker-2` account had no authentication events in 42 days.

| Time (UTC) | Change | Production check afterwards | How to restore |
|---|---|---|---|
| 00:13:48 | Deleted Cloud Run service `savannah-media-worker` (europe-west2, project `savannah-media-worker`) | health 200; status call SUCCEEDED, artifact and probe found; dispatcher 00008-btl at 100%, v11, unchanged; render job v7, generation 9; 0 errors | `gcloud run services replace tools/security/stage-d-restore/savannah-media-worker.europe-west2.yaml --region europe-west2 --project savannah-media-worker`, then `gcloud run services set-iam-policy … <matching .iam.json>`. The image is kept in `cloud-run-source-deploy`. The public URL may differ |
| 00:14:09 | Deleted `savannah-media-worker-test` (us-central1, project `savannah-media-worker`) | Same results, 0 errors | Same method with `savannah-media-worker-test.us-central1.yaml` |
| 00:14:31 | Deleted `savannah-media-worker` (us-central1, project `savannah-worker-2`) | Same results, 0 errors | Same method with `worker-2.savannah-media-worker.us-central1.yaml` in project `savannah-worker-2` |
| 00:15:00 | Removed `roles/storage.objectAdmin` on `gs://savannah-media` from `29658067982-compute@developer.gserviceaccount.com` | Same results, 0 errors; bucket `objectAdmin` is now the default compute account of `savannah-media-worker`, `media-worker-railway@` (key disabled), `savannah-dispatcher@` and `savannah-render-job@` | `gcloud storage buckets add-iam-policy-binding gs://savannah-media --member="serviceAccount:29658067982-compute@developer.gserviceaccount.com" --role=roles/storage.objectAdmin` (full previous policy: `savannah-media.bucket-iam.before.json`) |

**Not done, and waiting for the owner:** shutting down `savannah-worker-2`. Its full inventory matches what was already
known:
- owner only, plus Google service agents and its default compute account;
- billing enabled; no liens;
- no Cloud Run services or jobs left; no BigQuery datasets, Pub/Sub, Datastore/Firestore database or Dataform repositories;
- one Cloud Build (`98ffbe03…`) and one image (the deleted legacy service's);
- the five known secrets;
- one bucket holding only **archive #16**.

Shutting the project down would permanently delete archive #16 after 30 days, and its secrets with it. That overlaps with
Stage B, which is not yet approved. Its evidence is in `tools/security/archive-evidence-2026-10-25.json`.

**Restore files** (`tools/security/stage-d-restore/`) hold configuration and secret *references* only, never secret values.

### 9.7 Revised safe order

1. **A:** done. **D:** three services deleted and the bucket grant removed (§9.8); `savannah-worker-2` shutdown awaits the owner.
2. **D** (approval): delete the three legacy services; remove the `savannah-worker-2` bucket grant; shut down `savannah-worker-2`.
   Removes every public path to the live secrets, at no risk to production.
3. **§10.1, `JOB_SUBMIT_SECRET`** (approval), during the v12 deployment: the v12 deploy pins version 1, then the overlap
   rotation runs.
4. **§10.2, ElevenLabs and Pexels** (approval, plus owner dashboards), and **§10.3, OpenAI old-key revocation** (owner).
5. **B** (approval): delete the 16 archives by generation, with soft delete left on. Every credential inside is dead by then.
   B may also run earlier, since deletion already blocks reads, but it adds little before the rotation.
6. **E** (approval, at least 7 days after A with no problems): delete the key, then the account. Destroy `job-submit-secret`
   version 1 and old provider versions. Delete the local key files and `.env`.

## 10. Coordinated credential rotation (prepared 25 October 2026; not executed)

Everything here changes production and needs the owner's approval stage by stage. Code support is on branch
`security/job-submit-secret-rotation-overlap`:
- The dispatcher accepts an optional `JOB_SUBMIT_SECRET_PREVIOUS` and compares bearer tokens in constant time
  (`media-worker/src/lib/auth.js`; worker tests 89/89).
- `tools/security/job-submit-secret-rotation.cjs` creates, copies and verifies the new value by fingerprint only, and never
  writes to Google Cloud or Apps Script.

**How each consumer picks up a secret.** Cloud Run resolves a secret reference when an **instance starts** (service), or
when an **execution starts** (job). A running instance keeps the value it started with.
- **Dispatcher:** `JOB_SUBMIT_SECRET` ← `job-submit-secret@latest` today. It must equal the production main app's
  `MEDIA_WORKER_JOB_SUBMIT_SECRET`, which is used for `POST /jobs` and `POST /jobs/status`.
- **Render job:** `JOB_SUBMIT_SECRET` is required at start-up but never used for authentication. It also needs
  `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` and `PEXELS_API_KEY`, all at `@latest`.
- **Callbacks:** use `MEDIA_WORKER_SHARED_SECRET` (bridge and main app). This was **not** exposed and is **not** rotated
  here, so renders in flight still deliver their callbacks during every step below.

**Common preconditions:**
- No render in progress: `gcloud run jobs executions list --job savannah-render-job --region europe-west2 --limit 5` shows
  every execution completed, and the production queue is idle.
- Stage D is done.
- Where PowerShell is shown, run it as the owner account.

### 10.1 `JOB_SUBMIT_SECRET`: zero-gap overlap rotation (requires the v12 image)

| Step | Action | Verify | Undo |
|---|---|---|---|
| 1 | v12 deploy with `--update-secrets=JOB_SUBMIT_SECRET=job-submit-secret:1` (§8.5 step 2), promoted | `/health` 200; status call with the current value 200 | §8.6 rollback |
| 2 | `node tools/security/job-submit-secret-rotation.cjs new` | Prints only a fingerprint | Delete `%USERPROFILE%\.savannah-rotation` |
| 3 | `gcloud secrets versions add job-submit-secret --project savannah-media-worker --data-file="$env:USERPROFILE\.savannah-rotation\job-submit-secret"` (version 2). Nothing reads it yet: the dispatcher is pinned to 1, and the job only needs a well-formed value | `node tools/security/job-submit-secret-rotation.cjs verify 2` shows **MATCHES** with no whitespace warning | `gcloud secrets versions disable 2 --secret job-submit-secret` |
| 4 | **Open the overlap:** `gcloud run services update savannah-media-worker-dispatcher --region europe-west2 --update-secrets=JOB_SUBMIT_SECRET=job-submit-secret:2,JOB_SUBMIT_SECRET_PREVIOUS=job-submit-secret:1`. **Never on v11**, which ignores `_PREVIOUS` | Status call with version 1 → 200 **and** with version 2 → 200 (values read from Secret Manager in memory, never shown) | Same command with `JOB_SUBMIT_SECRET=job-submit-secret:1` and `--remove-secrets=JOB_SUBMIT_SECRET_PREVIOUS` |
| 5 | **Owner:** `node tools/security/job-submit-secret-rotation.cjs copy`. In the **production** script editor: Project Settings → Script properties → `MEDIA_WORKER_JOB_SUBMIT_SECRET` → paste → Save. Only this property changes | Copy the saved value back out of Script properties, then run `node tools/security/job-submit-secret-rotation.cjs check-clipboard` → **MATCHES**. Clear the clipboard | Paste version 1 back: `gcloud secrets versions access 1 --secret job-submit-secret` piped to `clip` |
| 6 | **Close the overlap:** `gcloud run services update savannah-media-worker-dispatcher --region europe-west2 --remove-secrets=JOB_SUBMIT_SECRET_PREVIOUS` | Version 1 → **401**; version 2 → 200. No 401s in dispatcher request logs over the next day | Step 4 command again |
| 7 | `gcloud secrets versions disable 1 --secret job-submit-secret --project savannah-media-worker`. Optionally pin the job too: `gcloud run jobs update savannah-render-job --region europe-west2 --update-secrets=JOB_SUBMIT_SECRET=job-submit-secret:2` | `gcloud secrets versions list job-submit-secret`. Only after step 6: a revision still referencing version 1 (the step-1 or step-4 revision) can no longer start once it is disabled, so from here roll back only to a revision pinned to `:2`, or to v11 (`latest`) | `… versions enable 1` |
| 8 | Delete `%USERPROFILE%\.savannah-rotation`. Destroy version 1 in Stage E | | |

**Why there is no interruption:** at every moment, the value Apps Script sends is accepted. Before step 5 it is version 1
(accepted from step 1 through step 6). After step 5 it is version 2 (accepted from step 4). Rollback during the overlap
(steps 4–6) must target a pinned v12 revision; after step 6, even the v11 rollback revision works, because `latest` is then
version 2.

**Cost:** none (two config-only revisions; Secret Manager versions are free at this scale).

### 10.2 ElevenLabs and Pexels (owner dashboards, then Secret Manager)

Only the render job uses these, and it reads `latest` when each execution starts.
1. **Owner:** create a **new** key in the ElevenLabs and Pexels dashboards. Do **not** revoke the old ones yet.
2. **Owner:** add each as a new version without a trailing newline. Either use Secret Manager in the Console (`elevenlabs-api-key` or
   `pexels-api-key` → New version → paste), or save the key to a file and use `gcloud secrets versions add <name> --data-file=<file>`.
   Never use a PowerShell pipe, which adds CRLF.
3. **Verify, free and read-only, values never shown:**
   - the new version is clean (no surrounding whitespace; the worker would refuse it at start-up, before any paid call);
   - ElevenLabs `GET /v1/user` returns 200 with the new key;
   - Pexels `GET /v1/search?query=nature&per_page=1` returns 200 with the new key.
4. With no render running, **owner:** revoke the old keys at each provider. Then
   `gcloud secrets versions disable <old version> --secret <name>`.
5. The next real render (live acceptance) is the end-to-end proof. Until then, the step 3 checks are the evidence.

**Undo:** re-enable the old secret version (only possible until the provider key is revoked). **Cost:** none.

### 10.3 OpenAI: the older key from the archives

- The archived key **ends in `f8gA`**. Production version 4, which stays, ends in `FlsA`. These are the same redacted forms
  OpenAI's key list shows.
- **Owner:** OpenAI dashboard → API keys → find the key ending `f8gA` → check "Last used" → revoke it. If it is not listed,
  it was already revoked.
- After revocation, destroy production `openai-api-key` versions 1–3 (disabled today):
  `gcloud secrets versions destroy <n> --secret openai-api-key --project savannah-media-worker`. **Irreversible**, but they
  hold no value in use.
- The `savannah-worker-2` copy disappears with Stage D.

### 10.4 Archives: evidence, then targeted deletion (Stage B detail)

1. Evidence is already committed (`tools/security/archive-evidence-2026-10-25.json`, 16 objects). Immediately before
   deleting, re-check each object's MD5 against it:
   `gcloud storage objects describe "gs://<bucket>/<object>#<generation>" --format="value(md5_hash)"`.
2. Delete by exact generation, so nothing newer can be hit: `gcloud storage rm "gs://<bucket>/<object>#<generation>"`, one
   per evidence entry. **No bucket policy change.**
3. **Verify:** `gcloud storage ls -a "gs://<bucket>/**"` no longer lists them. They will show under
   `gcloud storage ls --soft-deleted "gs://<bucket>/**"` until about 7 days later, when they expire automatically.
4. **Consequences:** those old Cloud Build entries lose their source (they cannot be re-run). Images, services and the
   evidence record are unaffected. Restorable for 7 days by Storage Admin-level principals, then **permanent**.
5. **Cost:** nothing; about 100 MB is freed after the soft-delete window (pennies-or-less meanwhile).
6. Recurrence is already prevented by `media-worker/.gcloudignore` and `.dockerignore` (§8; 32 key-free upload files).

**Only if a faster purge is wanted (not recommended):** run `gcloud storage buckets update <bucket> --clear-soft-delete`
**before** step 2, delete, then set `--soft-delete-duration=7d` again. This briefly removes protection for every object in
that bucket. The buckets hold only build inputs, but the owner asked to avoid this unless necessary, and it is not
necessary once §10 is done.
