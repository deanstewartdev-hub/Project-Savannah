# Project Savannah — Session Handoff (19 August 2026)

Compact but complete state dump for a new Claude Code session picking up this work.
Everything below was verified directly (git/gcloud/clasp/npm commands, live Sheet
reads, live production UI), not recalled from memory, at the time this file was
written. This supersedes the 11–13 August handoff below it in every respect except
branch topology, which is unchanged.

---

## CURRENT GIT

- **Current branch:** `chore/post-duration-hardening`
- **git status:** `?? HANDOFF.md` only (this file, before this commit)
- **Branch stack (each built on the last, oldest first):**
  1. `sprint-3` (`c8006c1`) — canonical branch, still untouched by any of this work
  2. `feature/cloud-run-jobs-migration` (13 commits ahead of `sprint-3`)
  3. `fix/production-completed-render-actions` (1 commit ahead of #2)
  4. `feature/render-status-reconciliation` (8 commits ahead of #3) — the
     `/jobs/status` reconciliation-infrastructure increment, plus the script
     generation convergence fixes (hook placement, scene-count repair)
  5. `chore/post-duration-hardening` (current HEAD, branched from #4 at `b9ec215`) —
     tonight's zero-cost hardening pass
- **Pushed to `origin` with upstream tracking:** `feature/cloud-run-jobs-migration`,
  `fix/production-completed-render-actions`, `feature/render-status-reconciliation`.
  `chore/post-duration-hardening` — see this file's own "GitHub push" line below for
  whether it was pushed this run.
- **`sprint-3` local == `origin/sprint-3`**, confirmed via fresh fetch, 0 commits
  either direction.

---

## PROVEN PRODUCTION MILESTONE — CLOUD RUN DURATION FIX

The Cloud Run migration's core open risk (short-duration renders) is now proven
resolved end-to-end with a real paid render:

- **Script:** `SCR-6702aa8d-0ee7-4624-9475-bf0871aa7dac` ("Traveling the World with
  just $10!") — 102 canonical narration words, 6 scenes, hook placed exactly at the
  start of Scene 1, predicted duration 44.35s (102 / 2.3 words-per-second estimate).
- **First attempt — `RND-9EDA317F`** (`savannah-render-job-s2v9v`): **FAILED** at 5%
  progress. ElevenLabs narration completed; the OpenAI alignment call then threw
  `APIConnectionError` — root cause: `OPENAI_API_KEY` in Secret Manager (version 3)
  carried a trailing CR/LF, which node-fetch's `Headers` constructor rejected as
  "not a legal HTTP header value" before any network request was even made. No
  artifact, no probe, no delivery. Preserved as historical evidence; row not modified.
- **Secret repaired:** a new Secret Manager version (4) was created manually with
  the same key material, whitespace-only trimmed. Verified byte-clean (no leading/
  trailing whitespace, no CR/LF/TAB) and authenticated successfully against OpenAI's
  `/v1/models` (zero-generation check) before use.
- **Second attempt — `RND-D68F9FDD`** (`savannah-render-job-dc7g5`): **SUCCEEDED,
  100%.** Narration → alignment → visuals → FFmpeg assembly → probe → delivery all
  completed. Alignment specifically confirmed passing this time (previously the
  exact failure point), proving the secret fix works in the real Cloud Run
  environment, not just in isolation.
  - **Actual duration: 36.9 seconds** (predicted 44.35s, −7.45s / −16.8%) — well
    within the 30–60s gate.
  - Resolution 1080×1920, audio present, all three probe gates passed
    (resolution/silence/black-frame), no clipping.
  - Artifact delivered to Savannah; Production UI now shows "View video" for this
    script; Completed videos counter went 13→14.

**This is one data point.** The 2.3 words/second estimator was *not* recalibrated
from it — see Phase 9 analysis in tonight's hardening report for why (need 3–5
comparable samples first).

---

## SECURITY STATE

- **OpenAI Secret Manager (`openai-api-key`, project `savannah-media-worker`):**
  - v4 — **ENABLED**, is `latest`, proven working (see above)
  - v3 — **DISABLED** (the malformed CR/LF version that caused `RND-9EDA317F`)
  - v2 — DISABLED (pre-existing)
  - v1 — DISABLED (pre-existing)
  - Cloud Run binding: `savannah-render-job`'s `OPENAI_API_KEY` env var references
    `openai-api-key:latest` (the alias, not a pinned numeric version) — unchanged,
    picks up v4 automatically. See tonight's report for a pinning plan (not applied).
- **Creatomate credential:** retired from Apps Script Script Properties earlier this
  session (the property itself was removed). Creatomate source code, provider
  adapter, and Settings UI references remain in the repo — see the Creatomate
  retirement audit in tonight's hardening report for a full dependency map; nothing
  removed tonight, analysis only.
- **Railway:** retained untouched as rollback. Not touched this session.
- **media-worker secret-format hardening (new, this branch):** `OPENAI_API_KEY`,
  `ELEVENLABS_API_KEY`, `PEXELS_API_KEY`, and `JOB_SUBMIT_SECRET` are now validated
  for leading/trailing whitespace and control characters (CR/LF/TAB/etc.) at
  `config.js`/`dispatcherConfig.js` load time, failing loudly before any provider
  call with an error that never contains the credential. Also discovered
  `OPENAI_API_KEY` has a second consumption site (`pipeline/visuals.js`, the OpenAI
  visual-fallback path) that was equally vulnerable and is now equally protected.
- **No secret payloads were read or printed at any point in this session.**

---

## CURRENT DEPLOYMENTS (verified live, not assumed)

- **Apps Script production version:** **v89** ("Improve script repair convergence
  for scene limits") — unchanged all session, confirmed via the still-serving
  production `/exec` URL returning HTTP 200; `clasp list-deployments` intermittently
  returned a "caller does not have permission" error this session (a local CLI
  OAuth/scope issue, not a deployment change — `clasp status`, a lighter command,
  kept working throughout).
- **Apps Script production Deployment ID:**
  `AKfycbzfD4HhW82TJyrdl5wteB1L84uiQJqb_hANd106zLDOOpY4HKqclGv67noe-kpQn2vDDw`
  (same ID/URL preserved through every version bump).
- **Dispatcher image:**
  `europe-west2-docker.pkg.dev/savannah-media-worker/savannah-media-worker/media-worker:v11`
- **Render Job image:** `...media-worker:v7` — unchanged; nothing in tonight's
  media-worker hardening work was deployed (local commit only).
- **`@HEAD`/dev deployment:** `AKfycbzKc9br5b5ahLLmc35kMtKiWJ_I3j_wimh2K7o1U5d2`.

---

## TEST BASELINE (all zero-cost, no provider calls)

| Suite | Result |
|---|---|
| PromptAlignment | 27/27 |
| ScriptDurationValidation | 15/15 |
| CloudRunReconciliation | 12/12 |
| ProductionHardening | 25/25 |
| ScriptEngineOptionsResolution (new) | 7/7 |
| ScriptEngineDuplicateDeclaration (new, node-tests) | 2/2 |
| ProductionUI/Reconciliation (node-tests) | 12/12 |
| media-worker (`npm test`) | 52/52 (41 existing + 11 new) |
| **Total** | **152/152** |

Plus `testScriptPromptLibrary()` (smoke, not pass/fail) and `git diff --check` clean
throughout.

---

## KNOWN TECHNICAL DEBT (see tonight's hardening report for full detail)

- ~~`Scripts/Script_Engine.js` had `generatePreview` and `resolveOptions_` each
  declared twice in the same scope~~ — **fixed this branch** (`fb3da8f`). The
  `resolveOptions_` duplicate was load-bearing: the dead definition never resolved
  `maxValidationAttempts`, which `generateValidatedContent_`'s retry loop reads
  directly as its bound.
- `APPROVALS_REQUIRED.md` had documentation drift (said secret rotation was
  "waiting" when it was actually completed) — reconciled this branch, see below.
- Creatomate legacy code (8 Apps Script files + 2 media-worker files) still present;
  full removal-readiness audit produced tonight, no removal performed.
- Background automation (5-minute trigger) still needs manual `script.scriptapp`
  OAuth re-authorization — confirmed still "Disabled" in Production UI.
- Two unexplained stale historical Render Job rows ("Meet Dean: Ballycastle's App
  King!", "Raveena's Bold Escape Unveiled") remain, preserved not auto-failed, per
  standing design constraints.
- Retry lineage and automatic delivery recovery remain design-only (specs produced
  tonight, not implemented).
- Default music track is still a 60-second silent placeholder MP3.

---

## MERGE STRATEGY (not executed — analysis only)

Recommended stacked PR order once ready:

1. `feature/cloud-run-jobs-migration` → `sprint-3`
2. `fix/production-completed-render-actions` → `feature/cloud-run-jobs-migration`
3. `feature/render-status-reconciliation` → `fix/production-completed-render-actions`
4. `chore/post-duration-hardening` → `feature/render-status-reconciliation`

None of these branches have been merged. See tonight's hardening report for a
per-layer merge-readiness assessment.

---

## PROJECT COMPLETION ESTIMATE

**~87%.** The full pipeline (idea → script → approval → SEO → render → probe →
delivery → publish) is implemented and has now been proven end-to-end on the
current architecture with a real render. What remains is hardening, calibration,
and polish rather than missing core functionality — see tonight's roadmap for the
itemized remaining ~13%.

---

## NEXT SESSION STARTING POINT

Read this file, then the "PROJECT SAVANNAH OVERNIGHT HARDENING REPORT" delivered at
the end of the 19 August session (in conversation, not yet a repo file) for the full
Phase 5–15 audit/design output (security audit, Creatomate map, secret-pinning plan,
OAuth activation steps, duration table, music audit, retry-lineage spec,
delivery-recovery spec, YouTube/analytics gap map, P0–P3 backlog, roadmap). Decide
the branch-stack push/PR order next, and whether to act on the P0 `Script_Engine`
fix's residual finding (a deterministic `generatePreview` retry-behavior test would
need a new `AIService` mock — none exists yet).

---

<details>
<summary>Previous handoff (11–13 August 2026) — kept for history, superseded above</summary>

# Project Savannah — Session Handoff (11–13 August 2026)

Compact but complete state dump for a new Claude Code session picking up this work.
Everything below was verified directly (git/gcloud/clasp commands), not recalled from
memory, at the time this file was written.

---

## CURRENT GIT

- **Current branch:** `feature/render-status-reconciliation`
- **git status:** clean
- **Branch stack (each built on the last, oldest first):**
  1. `sprint-3` (`c8006c1`) — canonical branch, **untouched** by any of this work
  2. `feature/cloud-run-jobs-migration` (13 commits ahead of `sprint-3`) — the Railway→Cloud
     Run dispatcher+Job migration itself
  3. `fix/production-completed-render-actions` (1 commit ahead of #2) — the Ready-card
     `Create Short`/`View video`/`Re-render safely` frontend fix
  4. `feature/render-status-reconciliation` (4 commits ahead of #3, **current HEAD**) —
     the `/jobs/status` reconciliation-infrastructure increment
  - **Total: 18 commits ahead of `sprint-3`.**
- **Nothing is pushed or merged.** `git remote -v` shows only `origin`; none of the four
  working branches above have an `[origin/...]` upstream (only `main`, `sprint-2`,
  `sprint-3`, `chore/ai-development-stack` are tracked to `origin`). All work is local-only.

(Superseded — see "CURRENT GIT" above for live state; the branches above are now
pushed with upstream tracking, and this file's date has moved on.)

## CURRENT DEPLOYMENTS (as of 11–13 August, since superseded)

- **Dispatcher image:** `europe-west2-docker.pkg.dev/savannah-media-worker/savannah-media-worker/media-worker:v11`
- **Render Job image:** `...media-worker:v7`
- **Apps Script production version:** `84` ("Fix completed render actions")
- **Apps Script production Deployment ID:** `AKfycbzfD4HhW82TJyrdl5wteB1L84uiQJqb_hANd106zLDOOpY4HKqclGv67noe-kpQn2vDDw`
- **Railway:** retained untouched as rollback.

## ABSOLUTE SAFETY CONSTRAINTS (carried forward, still binding)

- No paid render unless explicitly authorized.
- No YouTube publishing.
- No manual Sheet edits.
- No Railway changes.
- No git push/merge without explicit authorization.
- Do not broaden IAM beyond what's already granted.
- Do not expose or print secrets.
- Do not reproduce the old (already-flagged-compromised) callback secret value
  anywhere, including in logs, tests, or this document.

</details>
