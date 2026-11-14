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
- [ ] Separate embedded self-test functions from production files (6 files)
- [ ] `App/ScriptsController.js` — request parsing and response shaping extracted
- [ ] `Scripts/Script_Engine.js` — split by responsibility
- [ ] `Models/Approval.js`
- [ ] `Scripts/Scripts_Repository.js`
- [ ] `AI/AI_AIService.js`
- [ ] `Ideas/Ideas_Repository.js`, `App/IdeasController.js`
- [ ] `App/App.js` (shell and routing)
- [ ] Hot set (`App/ProductionController.js`, `Production/VideoProcessingProvider.js`,
      `Scripts/Script_Validator.js`, `Models/Script.js`, `media-worker/src/pipeline/visualSelection.js`,
      `Frontend/Assets/Scripts/Production.html`) — after #31/#32 stop moving, or exception
- [ ] Frontend scripts (`Frontend/Assets/Scripts/Scripts.html`)

### Phase 4–6
- [ ] Full suites green locally after the last module
- [ ] GitHub Actions green on the branch
- [ ] Completion report
