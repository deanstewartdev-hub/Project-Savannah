# Modular refactoring — working record

Branch: `refactor/modular-architecture` · Draft PR base: `fix/photogenic-scene-metadata` (PR #32)
Started: 14 November 2026 · Owner authorisation: standing, for this branch and its draft PR only.

This folder is the canonical record of the refactor. A new session resumes from the
**Progress checklist** below; nothing here depends on chat history.

| Document | What it holds |
|---|---|
| [BASELINE.md](BASELINE.md) | Test counts before any code moved, and how to reproduce them |
| [ARCHITECTURE_MAP.md](ARCHITECTURE_MAP.md) | Module inventory, entrypoints, dependencies, findings, target structure |
| [COMPATIBILITY.md](COMPATIBILITY.md) | Rules that keep behaviour identical, interface guarantees, risks, exceptions |

## Goal and limits

Reorganise the code into focused modules **with no change in behaviour**. Not in scope, and
not done on this branch: deployments, renders, uploads, spending, live Sheets or Apps Script
property changes, merges, and any weakening of a safety, approval, billing or publishing
control. `Production/Creatomate_Service.js` and `CreatomateProviderAdapter` stay.

## Why this base

GitHub `main` is stale (it is the sprint-2 merge). The working model is a stack of draft PRs
the owner merges bottom-up; the newest code is the tip of that stack, PR #32
(`fix/photogenic-scene-metadata`, on #31, on `fix/planner-narration-alignment`, which contains
the PR #15 integration branch). Refactoring anything older would mean reorganising code that
the stack has already replaced. The branch was cut from #32 at `4e4967c`.

PR #32 is still receiving commits from another session. Consequences, by design:

- Files #31/#32 changed, or are still changing, are the **hot set**. They are refactored last
  or left as documented exceptions, so this branch does not fight in-flight work.
- New #32 commits are brought in with a normal merge (`git merge origin/fix/photogenic-scene-metadata`),
  never a rebase or force-push.
- Nothing on this branch edits, merges or closes PR #31 or #32.

## Method (every step)

1. Record the current behaviour and public interface (the scope-contract fixture does this for
   every global name; add characterisation tests where a module has none).
2. Move code verbatim into a focused file. The original file keeps its public name and
   delegates, so callers and Apps Script entrypoints are untouched.
3. Run the scope contract, then the full app runner and worker suite.
4. Commit one module per commit, push, update the checklist.

## Progress checklist

Legend: `[x]` done and verified · `[ ]` planned · `[~]` justified exception (see COMPATIBILITY.md)

### Phase 1 — audit and safety net
- [x] Fetch, inspect branches and open PRs, choose base, create separate worktree and branch
- [x] Tested baseline recorded (BASELINE.md)
- [x] Global-scope contract test + baseline fixture (`node-tests/ApplicationScopeContract_Tests.js`)
- [x] Static dependency map (`tools/refactor/dependency-map.cjs`)
- [x] Architecture map and target structure (ARCHITECTURE_MAP.md)

### Phase 3 — module work (updated as each lands)
- [x] Separate embedded self-test functions from production files (8 files, 2,393 lines moved verbatim to `Tests/*_SelfTests.js`)
- [x] `App/ScriptsController.js` — 2,192 → 1,189 lines; request parsing, response shaping and value helpers now in `ScriptsController_Requests.js`, `_Responses.js`, `_Values.js` (94-scenario characterisation suite added first)
- [x] `Scripts/Script_Engine.js` — 2,114 → 703 lines; idea and option resolution, prompt building, repair-loop support and result assembly now in `Script_Engine_Inputs.js`, `_Prompt.js`, `_Repair.js`, `_Results.js` (84-scenario characterisation suite added first)
- [ ] `Models/Approval.js`
- [x] `Scripts/Scripts_Repository.js` — 1,368 → 665 lines; row ↔ model mapping now in `Scripts_Repository_Rows.js`. The sheet schema (headers, column numbers) stays in the repository (70-scenario characterisation suite over an in-memory sheet added first)
- [x] `AI/AI_AIService.js` — 1,229 → 322 lines; request validation, response normalisation and shared values now in `AI_AIService_Requests.js`, `_Responses.js`, `_Values.js`. The retry loop and provider routing stay in the service, untouched (100-scenario characterisation suite added first)
- [ ] `Ideas/Ideas_Repository.js`, `App/IdeasController.js`
- [ ] `App/App.js` (shell and routing)
- [x] `Scripts/Script_Validator.js` — 1,432 → 612 lines; scene rules and text-quality rules now in `Script_Validator_Scenes.js` and `Script_Validator_Text.js` (179-scenario characterisation suite added first)
- [x] `media-worker/src/pipeline/visualSelection.js` — 696 → 308 lines; search queries, clip judging, montage rules and the unpaid preflight now in `visualQueries.js`, `clipSelection.js`, `montageRules.js`, `footagePreflight.js`. `visualSelection.js` stays the single import point and re-exports the same 31 names
- [x] Frontend application script — `Scripts.html` 4,215 → 547 lines (shared helpers and start-up); the dashboard, ideas and scripts sections now in `Dashboard.html`, `Ideas.html`, `ScriptWorkspace.html`, loaded by `Index.html` straight after it. All 87 functions identical by hash; the three pages checked before and after in a real browser

### Phase 4–6
- [ ] Full suites green locally after the last module
- [ ] GitHub Actions green on the branch
- [ ] Completion report

## How each split is done (so the next one is done the same way)

1. Write a characterisation suite for the module if it has none (`node-tests/*Characterization_Tests.js`,
   built on `node-tests/lib/characterization.cjs`), check that its success paths really succeed,
   capture the fixture with `--update`, and commit it **before** moving code.
2. Move the private functions verbatim into sibling files; leave one-line delegates behind.
3. Prove it: characterisation suite unchanged, scope contract green, every removed line present
   in the new files, full app runner green.
4. Add the new files to any node test that loads the original file by explicit path.

`node-tests/ScriptEngineDuplicateDeclaration_Tests.js` counts declarations in `Script_Engine.js`:
keep exactly one `function resolveOptions_(` and one `function generatePreview(` there.
