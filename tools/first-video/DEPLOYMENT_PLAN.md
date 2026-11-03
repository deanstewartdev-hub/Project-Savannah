# Deployment plan: visual-coverage change for the second Chefchaouen render

Status: **prepared, not executed.** Nothing here has been deployed, and the production script record has not been changed. Each step needs the owner's separate approval.

Branch: `feat/visual-relevance-gate` (latest commit `e8086ff`; all commits are pushed).

## 1. Verified live state (read-only, 2 November 2026)

| Component | Live state | How it was checked |
|---|---|---|
| Main app, production web app deployment | **version 94** (commit `cdabdab`) | `clasp deployments` and `clasp versions` in the root project |
| Main app rollback target | **94**, not 92 | the same listing |
| Callback bridge, production project "Savannah bridge" | deployment at **version 5**, the verify-route build, as the handover records | `clasp deployments` from a temporary folder, pointed at the production bridge project (read-only) |
| Worker dispatcher | revision `savannah-media-worker-dispatcher-00013-jin` at **100%** | `gcloud run services describe`, europe-west2 |
| Render job | last execution `savannah-render-job-x8z8z` (the first Chefchaouen render), exit 0 | `gcloud run jobs executions list` |

**Config mismatch to fix before any push:** `CallbackBridge/.clasp.json` points to a different Apps Script project (one that has only version 1 and is not the production bridge). A `clasp push` from that folder would target the wrong project. This needs an owner decision. Nothing has been changed.

The deployed main app (version 94) differs from this branch only in `Production/VideoProcessingProvider.js` and the three scene-builder files (`Models/Script.js`, `Scripts/Script_Formatter.js`, `Scripts/Script_Validator.js`), plus the new `Scripts/Visual_Fields_Maintenance.js`. Approval records do not copy scene text, so the record update does not change any approval.

## 2. Tests before deployment (all pass)

- Worker: `cd media-worker && node --test` → **122/122**.
- Main app: `node node-tests/run-local.cjs` → exit 0, **394** PASS lines. It includes:
  - `ScriptVisualFields_Tests.js`: 4/4. The visual fields survive the validator, formatter and model; narration and timing are unchanged.
  - `VisualFieldsMaintenance_Tests.js`: 16/16. Dry run, backup order, unrelated fields unchanged, other scripts untouched, each refusal, read-back mismatch, and restore.
- Shot selection (live, read-only Pexels): `tools/first-video/shot-selection.mjs` → 5 of 5 scenes covered. The seven selected clips are in `tools/first-video/SHOT_SELECTION.md` for human review.

## 3. Integration check (what is and is not proven)

- **Script repository → provider:** the repository stores and returns scene JSON unchanged. The provider passes `location` and `searchKeywords` into each beat. Read by code and the pass-through test.
- **Dispatcher → worker:** the dispatcher forwards whole beat objects. `validateBeats` does not reject extra fields.
- **Worker planning and cutting:** unit tests cover the gate, coverage and cut distribution. An ffmpeg run of the segmented assembly produced 9.000 s at 1080×1920.
- **Not proven:** the full path with the real stored record and a real render. That needs the deployment steps below.

## 4. Order of operations

The order matters. The worker fails closed on its own, but the editor can only run the new maintenance function after the main-app code is deployed.

1. **Worker, no traffic.** Deploy the new revision with no traffic. Smoke test with a dispatcher request with `dryRun: true`. The worker's dry-run path (`media-worker/src/lib/renderRequest.js (dry-run branch, called by job-runner.js)`) loads the request and exits before any paid call. It still starts one Cloud Run execution, so it needs approval.
2. **Main app code.** Resolve the `CallbackBridge/.clasp.json` mismatch first (it does not affect the main app push). Then `clasp push` from the root, `clasp version`, and update the production deployment to the new version. This ships the provider change, the scene builders, and the maintenance functions (inert until run).
3. **Editor dry run (read-only).** Run `previewChefchaouenVisualFieldsDryRun` from the editor. It reads the saved record through the repository and logs the five changes and the unchanged-field check. Review the log.
4. **Apply, with approval.** Run `applyChefchaouenVisualFields`. It backs up the original JSON to Script Revision Backups, saves once, and reads the record back. The result is logged with `verified=true`.
5. **Verify without rendering.** Check that the stored record carries the five fields and version 5, status still APPROVED, and that the approval queue and SEO pack are unchanged.
6. **Worker traffic shift** to the new revision, only after steps 1–5 pass.
7. **Second render:** a separate approval, after the shot-list review.

## 5. Rollback

Each step can be rolled back on its own.

| Step | Rollback | Notes |
|---|---|---|
| Worker traffic | `gcloud run services update-traffic savannah-media-worker-dispatcher --project savannah-media-worker --region europe-west2 --to-revisions=savannah-media-worker-dispatcher-00013-jin=100` | Restores the live revision. |
| Main app | `clasp redeploy <production-deployment-id> --versionNumber 94 --description "rollback to 94"` | Get the deployment ID from `clasp deployments`. |
| Production record | Editor: `previewChefchaouenVisualFieldsRestore`, then `restoreChefchaouenVisualFieldsFromBackup`. It restores the latest backup of this script with the next version number, backing up the replaced record first. | Verified by a read-back. |

Only the command syntax was checked, using `clasp redeploy --help` and `gcloud run services update-traffic --help`. The rollback commands have not been run, because they would change production. The editor restore path is covered by the 16 tests, which run against a mocked repository and backup sheet.

## 6. Owner decisions needed

1. Approve the worker deployment (new revision, no traffic) and its dry-run execution.
2. Decide the `CallbackBridge/.clasp.json` mismatch. Pointing it at the production bridge project is the likely fix.
3. Approve the main-app push and deployment.
4. Approve the editor dry run (read-only, no approval needed for the dry run itself; approval is needed to run the editor function if you want me to wait for it).
5. Approve the record apply, after the dry-run log is reviewed.
6. Approve the second render separately, after reviewing the seven clips.

## 7. Container test of worker v14 (completed, non-rendering)

- Image: `media-worker@sha256:d010ddcf9efb250d4b0ec7aeac5e7067edf24c61796b6507c4ee1f184f5d34ee` (the v14-visual build of commit `64812b7`).
- Method: a temporary Cloud Run job, `savannah-visual-v14-test`, on that digest, with the command overridden to load `src/pipeline/visualSelection.js` and run the planner against live Pexels search (read-only). It had only the Pexels secret, the render job's service account and five beats with the approved fields. It had no OpenAI, ElevenLabs or GCS settings, no callback, and no write path.
- Execution: `savannah-visual-v14-test-2bgb4`, exit 0.
- Result: 5 scenes, 7 unique clips, 0 duplicates, 0 AI images, 12 Pexels searches. Every scene resolved from its queries (for example `chefchaouen blue city`).
- Cleanup: the temporary job was deleted. The production render job still runs `sha256:67fe…` (v13).
- Limits: relevance is judged from Pexels metadata only; the clips have been checked by contact sheet, but not in a real render. The gate accepts some clips on one subject word.

## 8. Promotion (needs approval; not executed)

Important: the main app (version 95) is live and sends the location fields. Until the render job runs the v14 image, a render would use the old selection, so **no render should be submitted before step 2.**

1. Check there are no running executions of `savannah-render-job`.
2. Update the render job image to the v14 digest: `gcloud run jobs update savannah-render-job --region europe-west2 --project savannah-media-worker --image europe-west2-docker.pkg.dev/savannah-media-worker/savannah-media-worker/media-worker@sha256:d010ddcf9efb250d4b0ec7aeac5e7067edf24c61796b6507c4ee1f184f5d34ee`
3. Shift dispatcher traffic to the candidate: `gcloud run services update-traffic savannah-media-worker-dispatcher --region europe-west2 --project savannah-media-worker --to-revisions=savannah-media-worker-dispatcher-00015-bay=100`
4. Check `/health` on the production dispatcher URL returns 200, and the unauthenticated submit returns 401.

**Rollback** (both are one command each):
- Dispatcher: `--to-revisions=savannah-media-worker-dispatcher-00013-jin=100`
- Render job: `gcloud run jobs update savannah-render-job --region europe-west2 --project savannah-media-worker --image europe-west2-docker.pkg.dev/savannah-media-worker/savannah-media-worker/media-worker@sha256:67fe155194286c4ca9b748a8febedaefaa06845186cbf75a1c54402921604902`
- Main app (only if needed): `clasp redeploy <production-deployment-id> --versionNumber 94`. The record can be restored with the editor function `restoreChefchaouenVisualFieldsFromBackup` (backup row 3 holds version 4).
