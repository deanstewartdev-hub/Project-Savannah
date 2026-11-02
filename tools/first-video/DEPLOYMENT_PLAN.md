# Deployment plan: visual-coverage change for the second Chefchaouen render

Status: **prepared, not executed.** Nothing here has been deployed, and no production script record has been changed. Each step needs the owner's separate approval.

Branch: `feat/visual-relevance-gate` (commits `4007bb6`, `9c17613`, `94f188f`).

## 1. Verified state (1–2 November 2026, read-only)

| Component | Live state | How it was checked |
|---|---|---|
| Main app (web app deployment in production) | **version 94** (commit `cdabdab`, the maintenance dry-run logging) | `clasp deployments` and `clasp versions` |
| Main app rollback target | **94**, not 92 | the deployment list above |
| Worker dispatcher | revision `savannah-media-worker-dispatcher-00013-jin` at **100%** | `gcloud run services describe`, europe-west2 |
| Render job | last execution `savannah-render-job-x8z8z` (the first Chefchaouen render), exit 0 | `gcloud run jobs executions list` |
| Callback bridge | **not verified here.** The handover says version 5, but the bridge project in this repo lists only version 1, under a different deployment. The live bridge needs checking in its own Apps Script project before any change. | `clasp deployments` in `CallbackBridge/` |

The deployed main app differs from this branch only in `Production/VideoProcessingProvider.js`, plus the three scene-builder files (`Models/Script.js`, `Scripts/Script_Formatter.js`, `Scripts/Script_Validator.js`). Approval records do not copy scene text, so the record update does not change any approval.

## 2. Tests before deployment

- Worker: `cd media-worker && npm test`: **122/122** pass.
- Main app: `node node-tests/run-local.cjs`: exit 0, **378** PASS lines.
- Visual-field pipeline: `node node-tests/ScriptVisualFields_Tests.js`: **4/4** pass.
- Shot selection, live read-only Pexels: `node tools/first-video/shot-selection.mjs`: 5 of 5 scenes covered.

## 3. Order of operations

The order matters, because the worker must not fail open with the current main app.

1. **Worker first.** The new worker only cuts footage per beat and fails closed: with no location fields, it derives keywords from the long scene direction, and if no clip passes the gate the job fails with `PRODUCTION_VISUAL_COVERAGE`. It does not substitute unrelated clips. Deploy as a new revision with **no traffic**, then smoke-test it.
   - Smoke test: a dispatcher request with `dryRun: true`. In `media-worker/src/job-runner.js:43` dry-run loads the request and exits before any paid call. It still starts one Cloud Run execution, so it needs approval.
2. **Production record update.** Run the dry run on an exported copy of the stored scenes (`tools/first-video/visual-fields-dry-run.mjs`), check the diff, back up the original through the Script Revision Backups sheet, then write the five `location` and `searchKeywords` fields. Narration, timing, IDs, status, approvals and SEO stay unchanged.
3. **Main app.** `clasp push`, then `clasp version`, then update the production deployment to the new version. This ships `VideoProcessingProvider.js` and the three scene builders.
4. **Verify without rendering.** Confirm the fields reach the worker: the record shows them, the provider passes them, and the worker plan lists them. No paid action.
5. **Shift worker traffic** to the new revision (only after steps 1–4 pass).
6. **Second render:** a separate approval, after the shot-list review.

## 4. Rollback

Each step has a rollback that can run on its own.

| Step | Rollback | Notes |
|---|---|---|
| Worker traffic | `gcloud run services update-traffic savannah-media-worker-dispatcher --project savannah-media-worker --region europe-west2 --to-revisions=savannah-media-worker-dispatcher-00013-jin=100` | Restores the current live revision. |
| Main app | `clasp redeploy <production-deployment-id> --versionNumber 94 --description "rollback to 94"` | Use the production deployment ID from `clasp deployments`. Version 94 is the last deployed version. |
| Production record | Restore the `before.json` scene values from the backup row in Script Revision Backups, and verify with a read. | The backup holds the original JSON, not a summary. |

Only the command syntax was checked, using `clasp redeploy --help` and `gcloud run services update-traffic --help`. The rollback itself has not been run, because it would change production.

## 5. Owner decisions needed

1. Approve the worker deployment (new revision with no traffic) and the dry-run execution.
2. Approve the production record update, after the dry-run diff is shown.
3. Approve the main-app deployment.
4. Confirm the live callback bridge version in its own project.
5. Approve the second render separately, after reviewing the shot list.
