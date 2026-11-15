# Compatibility rules, guarantees and risks

## Rules every change on this branch follows

1. **Move, do not rewrite.** Code is relocated verbatim. Logic, messages, defaults, thresholds
   and the order of side effects stay exactly as they were.
2. **Public names are permanent.** Every global in `node-tests/fixtures/public-interface.json`
   keeps its name, type and public members. The original file keeps the public object and
   delegates to the new module (a compatibility facade), so no caller changes.
3. **No load-order dependence.** A new module is only ever referenced from inside a function
   body, never while a file is loading. The contract test loads all files forwards and
   backwards and requires an identical result.
4. **No duplicate global names.** New module names are unique across the project.
5. **Do not merge look-alike helpers.** Several closures have private helpers with the same
   name. They are consolidated only where a characterisation test proves the copies behave
   identically for the inputs in use; otherwise each stays with its owner.
6. **Stay inside the existing folders.** `.claspignore` decides what deploys. New Apps Script
   files go into folders that are already pushed, so the deployment rules are untouched.
7. **No Node module syntax in Apps Script files.** No `import`, `require` or `module.exports`.
8. **Tests are never loosened.** A test file is edited only to add a new source file to the
   list it loads. Expected values, assertions and safety checks are not changed.
9. **Data contracts are frozen.** Sheet names and columns, serialised model fields, script
   property names, callback payloads and worker request/response shapes do not change.

## What a relocated self-test means for deployment

Hand-run `test…` functions moved out of production files into `Tests/` are still global
functions with the same names, still pushed (`Tests/**` is in `.claspignore`), and still
runnable from the Apps Script editor's function list. Only the file they live in changes.

## Migration notes for the owner

- Nothing on this branch requires a production migration, a property change or a new trigger.
- No sheet name, column, serialised field, script property, callback payload or worker
  request/response shape changed. The Scripts sheet format is pinned by a suite that compares
  every write and the final sheet contents.
- Deployment procedure is unchanged: `clasp push` (and `tools/staging/prepare-staging-push.cjs`,
  which reads `.claspignore`) pick the new files up automatically because they sit in folders
  that are already pushed. `.claspignore` and `appsscript.json` are untouched.
- A push from this branch **adds 21 server files and 3 HTML files** to the Apps Script project
  and shrinks 9 existing ones. Notes that describe a deployment as "differs only in file X"
  (for example `tools/first-video/DEPLOYMENT_PLAN.md`) describe the pre-refactor layout: the
  behaviour is the same, the file list is longer.
- A partial push would break the app. The new modules and the files that delegate to them
  must go up together, which `clasp push` does. Do not copy single files by hand.
- The media worker image needs no change: `Dockerfile` copies `src/` whole.
- Each node test that loads source files by explicit path now also loads the new sibling
  module where one was extracted, and two tests read relocated self-tests from `Tests/`. Those
  are the only edits to existing tests; no assertion or expected value changed.

## Interaction with PR #31 and PR #32

The branch was cut from the tip of #32 (`4e4967c`). #32 received no further commits while the
refactor ran (last checked 15 November 2026), so nothing needed merging in.

| File | Changed by #31/#32 | Handling here |
|---|---|---|
| `media-worker/src/pipeline/visualSelection.js` | yes, heavily | **Split** once #32 had been quiet for several hours. It stays the import point with the same 31 exports |
| `Scripts/Script_Validator.js` | yes (montage and scene-control rules) | **Split**; those rules are now in `Script_Validator_Scenes.js`, unchanged |
| `Scripts/Script_Formatter.js`, `Models/Script.js` | yes, small | Only their trailing self-tests moved out |
| `media-worker/src/pipeline/visuals.js`, `assemble.js`, `runJob.js`, `lib/dispatcherApp.js`, `lib/submitIntent.js`, `config.js` | yes | Untouched |
| `App/ProductionController.js`, `Production/VideoProcessingProvider.js`, `Production/StagingVerification_Service.js`, `Production/YouTube_Service.js`, `Frontend/Assets/Scripts/Production.html` | yes | Untouched (see exceptions) |

If #32 gets more commits: merge it into this branch (`git merge origin/fix/photogenic-scene-metadata`,
never a rebase). A change to a file that was split here will conflict in the original file;
apply the incoming change to the module that now holds that code (MODULES.md says which), run
that module's characterisation suite, and regenerate its fixture **only** for the scenarios the
incoming change is meant to alter. Nothing on this branch edits, merges or closes #31 or #32.

## Behaviour observed and deliberately left as it is

Characterisation turned these up. They are current behaviour, pinned as-is, and not changed
here because changing them would be a behaviour change needing its own approval:

- `ScriptsRepository.saveScript` accepts a script that has only an ID, and even a bare string,
  because `ScriptModel.create` fills in defaults. It saves a mostly empty row.
- The validator's markdown rule catches code fences and headings at the start of a line only;
  bold, lists, inline code and links in narration are accepted.
- `ScriptValidator` accepts `minimumDurationSeconds: 0` as a rule option.
- A weak-hook or placeholder rejection message prints the regular expression that matched.

## Outstanding risks

| Risk | Mitigation |
|---|---|
| A real Apps Script runtime differs from the offline scope model | The model checks names, shapes and order independence; the characterisation suites run the real code. Neither is a real Apps Script run. A push to the **staging** project and a click-through of Ideas, Scripts and Queue by the owner is the remaining proof before any production deployment. This branch does not deploy |
| Apps Script HTML service differs from a plain browser for the split client script | The split relies only on inline scripts running in order before the page-start event, which the existing `Queue.html`, `Seo.html` and `Production.html` scripts already rely on in production. Checked in a real browser with static builds; not checked inside Apps Script |
| PR #32 changes a file that was split here | Procedure above; the characterisation suites show exactly what an incoming change alters |
| Fixtures are large (about 0.9 MB of JSON in `node-tests/fixtures/`) | They are the "before" record. They can be trimmed once the refactor is merged and trusted |

## Justified exceptions

Modules from the plan that were examined and deliberately left whole.

| Module | Decision | Reason |
|---|---|---|
| `App/ProductionController.js` (1,108 lines) | Not split | It is the gate for paid renders and YouTube uploads. Its actions (submit, retry, refresh, publish, abandon) call each other and share one set of lock, recovery and callback-drain helpers, so moving groups of them verbatim would produce modules that depend on each other in a circle. A real decomposition means redesigning that shared plumbing, which is a behaviour-affecting change in the most safety-critical file and needs the owner's separate approval. It is also the Apps Script file #31/#32 changed most. Recommended later design, for approval: a leaf `ProductionController_Support` (response wrapper, error, script lock, callback drain), then `_Rendering`, `_Preparation` (legacy scene flow) and `_Publishing` on top of it, each with a characterisation suite first |
| `App/ProductionController.js` ↔ `Production/ProductionQueue_Service.js` cycle | Left | Both sides call the other only inside functions, so it is harmless at load time. Breaking it needs a handler registered when a file loads, which would make behaviour depend on file load order: the opposite of what this refactor guarantees |
| `Production/VideoProcessingProvider.js` (510 lines) | Not split | Holds `CreatomateProviderAdapter`, which the repository's critical v1.4 rule protects, and the render-beat builder #32 changed. Moderate size, loaded by path in 15 suites; splitting by adapter is worthwhile only after the Creatomate decision is made |
| `Frontend/Assets/Scripts/Production.html` (1,078 lines) | Not split | One page's script in a single closure, changed by #31/#32 and covered by its own browser-level suites; no shared-object seam like `SavannahApp` |
| `Models/Approval.js` (1,048), `Models/Script.js` (975) | Self-tests moved out only | Each is one cohesive, pure model: constructors, validation and status transitions over shared status constants. Splitting would scatter those constants across files for no gain |
| `Ideas/Ideas_Repository.js` (900) | Not split | One object literal whose every member, including helpers, is part of its public shape, so moving code out would add indirection without shrinking the interface |
| `App/App.js` (597), `App/IdeasController.js` (603), `Scripts/Script_Formatter.js` (619) | Left | Already one responsibility each and of moderate size |
| Small hand-run self-tests in 24 other production files | Left in place | A few short functions per file; two are read in place by `node-tests/LiveTestGuard_Tests.js`. Moving them would touch a safety test for little benefit |
| Look-alike private helpers (`clone_`, `normaliseOptionalString_`, `firstNonEmptyString_`, error factories) | Not merged across owners | The copies differ in small ways (error type, message prefix, handling of `undefined`). Each owner now has its own `_Values` module; a single shared helper file would change which errors callers see |
| Media worker apart from `visualSelection.js` | Left | Already one responsibility per file with explicit imports; nothing else is oversized |
