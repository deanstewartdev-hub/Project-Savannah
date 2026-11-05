# Staging archive: A10 (S8), A11 (S10), A12 (cleanup)

Recorded 5 November 2026. Sanitised: no secret values, no tokens, no callback URLs with secrets, no
production identifiers beyond those already in the repository. Results are also in GitHub Issue #28.

## Milestones

| Milestone | Result | Evidence |
|---|---|---|
| A10 / S8: non-allowlisted image refused | **PASS** | Job temporarily set to the earlier staging image `164c21e2…` (not in `RENDER_JOB_ALLOWED_IMAGES`, which is `ff5a8649…`). One dry-run `POST /jobs` with a fresh `cr-<uuid>` returned **HTTP 409**. Dispatcher log: "The shared render job is not running a music-verified image, so no render was started." Executions: 7 before, 7 after. Bucket: 9 objects before, 9 after. Job restored to `ff5a8649…`. |
| A11 / S10: rollback drill | **PASS** | Dispatcher traffic moved to `savannah-staging-dispatcher-00003-tt9` (100%), `/health` returned staging identity, then moved back to `00004-bnr` (100%), `/health` staging identity. Job image swapped to `164c21e2…` and back to `ff5a8649…`. Spreadsheet data-row counts: identical before and after (below). Bucket: 9 before, 9 after. Executions: 7 before, 7 after. |
| A12 | See the cleanup log in RELEASE_READINESS §18j | Performed after A10 and A11 both passed and this archive was written. |

## Spreadsheet data-row counts (`stagingRowCounts`, read-only)

| Table | Start of A10 | After A10 (S8) | After A11 (S10) |
|---|---|---|---|
| Render Jobs | 13 | 13 | 13 |
| Publishing Jobs | 1 | 1 | 1 |
| SEO Pack | 4 | 4 | 4 |
| Render Callback Inbox | 12 | 12 | 12 |

Export of the staging spreadsheet as CSV via the Drive API was refused (403) with the available token, so the
spreadsheet itself is preserved in Drive as the archive copy. It is not deleted, and it contains no production
references.

## Staging inventory and images

- `bucket-inventory-final.txt`: final object list of `savannah-staging-media` (9 objects).
- `executions-final.txt`: the 7 Cloud Run executions of `staging-render-job`.
- `dispatcher-traffic-final.txt`: dispatcher traffic at the end of the drill (100% on `00004-bnr`).
- `image-tags-final.txt`: staging image digests and tags. The allowlisted image is `ff5a8649…` (tag `s5s7-67eb5cf`).

## Test suites on the development branch

- Worker `node --test`: 277 / 277 pass.
- Main `node node-tests/run-local.cjs`: exit 0, 464 PASS, 0 FAIL.

## Production isolation (read-only, checked before A12 and again after A11)

- Dispatcher `savannah-media-worker-dispatcher`: 100% on `savannah-media-worker-dispatcher-00015-bay`. Unchanged.
- Render job `savannah-render-job`: image `d010ddcf…`. Unchanged.
- Production configuration contains no reference to the staging project ID, the staging job or dispatcher names,
  the staging bridge deployment, or the staging main script ID.
