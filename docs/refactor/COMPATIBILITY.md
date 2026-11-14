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
- Deployment is unchanged in procedure: the same `clasp push` uploads a few more, smaller files.
- Each node test that loads source files by explicit path now also loads the new sibling
  module where one was extracted. Those are the only test edits.

## Interaction with PR #31 and PR #32

| File | Changed by #31/#32 | Handling here |
|---|---|---|
| `media-worker/src/pipeline/visualSelection.js`, `visuals.js`, `assemble.js`, `runJob.js`, `lib/dispatcherApp.js`, `lib/submitIntent.js`, `config.js` | yes, heavily | untouched until the stack settles |
| `App/ProductionController.js`, `Production/VideoProcessingProvider.js`, `Production/StagingVerification_Service.js`, `Production/YouTube_Service.js`, `Frontend/Assets/Scripts/Production.html` | yes | untouched until the stack settles |
| `Scripts/Script_Validator.js`, `Scripts/Script_Formatter.js`, `Models/Script.js`, `Scripts/Script_Revision_Maintenance.js` | yes, small | structural change deferred |
| Everything else | no | in scope |

New commits on #32 are merged into this branch; if a merge touches a file already split here,
the incoming change is re-applied to the new module in a separate, labelled commit.

## Outstanding risks

| Risk | Mitigation |
|---|---|
| A real Apps Script runtime differs from the offline scope model | The model checks names, shapes and order independence only. A staging `clasp push` and smoke run by the owner remains the final proof before any deployment; this branch does not deploy |
| PR #32 keeps moving | Hot set deferred; merges, never rebases |
| A private helper captured closure state that a moved copy no longer sees | Helpers are moved only when they use nothing but their arguments and other moved helpers; anything touching closure constants stays, or receives them as explicit arguments |

## Justified exceptions

Recorded here as they are decided, with the reason.
