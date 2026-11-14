# Confirming the exact next render version before a paid submission

Status: procedure only. It is read-only and is run by the owner (or by an engineer with the owner's read approval). Nothing here writes to a sheet, a Script property or Cloud Storage.

Script: `The Most Photogenic Places on Earth`, `SCR-6928b7a7-8575-42e1-925d-5d2bc8a8d6ef`.

## Why this check exists

The Apps Script computes the render version when it submits (`nextVersion_` in `App/ProductionController.js`). The worker refuses a version that another request has already claimed. Both rules are safe, but neither tells the owner, before the paid click, which number will be used. This check does, from the production records, so the owner can approve a known number.

## Facts the check depends on (verified in the code)

- The render version is stored in the Render Jobs row's **Request JSON** column, as `requestPayload.version`.
- A row without a stored version counts as **version 1** (`versionOf_`). Rows created before versions existed have none.
- The row's own **Version** column is the optimistic-lock revision of the row (`RenderJobModel`, `merged.version = Number(job.version) + 1`). It is **not** the render version. Do not read it.
- The worker's version claim is at `renders-by-version/<scriptId>/v<version>.json` in the job-state bucket. An intent claim is at `submit-intents/<submitIntentId>.json`.

## Procedure

1. **Filter the Render Jobs sheet** to rows whose script ID is the one above. Read only; change nothing.
2. **Read each row's Request JSON** and take its `version`. If the field is absent, count the row as version 1. Include FAILED rows: they still use up a number.
3. **Compute the next version**: the largest version found, plus one. For Photogenic, the two 10 November rows have no stored version and both failed, so the largest is 1 and the next version is **2**. Confirm this against the sheet; the earlier reading of those two rows' Request JSON is still outstanding.
4. **Check for active rows.** Stop if any row for the script is QUEUED, PLANNED, SUBMITTING or RENDERING, or if an upload is in progress for it.
5. **Check the worker's claim for that number** (read-only, in the job-state bucket): the object `renders-by-version/SCR-6928b7a7-8575-42e1-925d-5d2bc8a8d6ef/v<next>.json` must not exist. If it exists, stop. Do not submit under that number. Its contents name the intent that holds it.
6. **Record the approval note before submitting**: script ID, the next version, and one request ID for this owner action (generated once; a double click or a refresh must reuse it, which the page does).
7. **Submit once**, with the submission gate open and the contract check passed (see `deployment-safety.md`). Afterwards, confirm the new row's Request JSON shows `version` equal to the number you recorded. If it does not, stop and record the mismatch: the submission has already been made.

## Cross-checks, not replacements

- The Apps Script's own number is the one in the new row. Step 7 confirms it matches the number predicted here.
- The sheet's error text can disagree with the backend job (see RND-B375A60D in `release-readiness.md`). Judge a render from its Request JSON and its worker state, not from the error text.

## What this does not establish

- It does not prove the sheet is complete. A row missing from the sheet would be invisible to both this check and the Apps Script. The worker's claim in step 5 is the independent check for that case.
- It does not read the two 10 November Request JSON values. Those are still outstanding and should be read before the approval.
