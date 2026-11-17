# Tested baseline

Taken on 14 November 2026 at commit `4e4967c` (tip of PR #32), before any code was moved.
Machine: Windows 11, Node v24.18.0, FFmpeg/FFprobe 8.1.2. All runs are local and offline: no
Google, OpenAI, ElevenLabs, Pexels or YouTube call is made, nothing is rendered or uploaded.

| Suite | Command | Result |
|---|---|---|
| App runner (syntax check, Apps Script fixtures, upload recovery, chain integration, every `node-tests/*_Tests.js`) | `node node-tests/run-local.cjs` | exit 0 · **498 PASS lines, 0 FAIL** · syntax: 87 server files, 9 frontend scripts |
| Media worker | `cd media-worker && npm test` | **431 tests, 431 pass, 0 fail**, 0 skipped |

Pre-existing failures: **none**. Flaky tests observed: none in the baseline run.

Earlier notes quote 343 and 394 worker tests; those were older points on the stack. 431 is the
count at this base.

## What the refactor adds to the baseline

- `node-tests/ApplicationScopeContract_Tests.js` (7 checks) with
  `node-tests/fixtures/public-interface.json`: 307 global names from 87 pushed files, captured
  at the baseline commit. It is picked up by the app runner automatically.

The fixture is the "before" picture. It is regenerated only on purpose
(`--update`), never to make a failing run pass.

## Test log

| Date | Commit | App runner | Worker | Note |
|---|---|---|---|---|
| 2026-11-14 | `4e4967c` | 498 PASS / 0 FAIL | 431 / 431 | baseline |
| 2026-11-14 | self-test relocation | 505 PASS / 0 FAIL (498 + 7 contract checks) | not re-run (no worker file changed) | 8 production files now hold production code only |
| 2026-11-14 | ScriptsController split | 599 PASS / 0 FAIL (505 + 94 characterisation scenarios) | not re-run (no worker file changed) | 747 removed lines all present in the new modules |
| 2026-11-14 | Script_Engine split | 683 PASS / 0 FAIL (599 + 84 characterisation scenarios) | not re-run (no worker file changed) | 1,081 removed lines all present in the new modules |
| 2026-11-14 | AIService split | 783 PASS / 0 FAIL (683 + 100 characterisation scenarios) | not re-run (no worker file changed) | 622 removed lines all present in the new modules |
| 2026-11-14 | ScriptsRepository split | 853 PASS / 0 FAIL (783 + 70 characterisation scenarios) | not re-run (no worker file changed) | 282 removed lines all present in the new module |
| 2026-11-14 | Frontend script split | 856 PASS / 0 FAIL (853 + 3 structure checks) | not re-run (no worker file changed) | Dashboard, Ideas and Scripts pages loaded in a browser before and after: no errors, same server calls, same rendered text |
| 2026-11-14 | Worker visualSelection split | not re-run (no app file changed) | 435 / 435 (431 + 4 import-surface checks) | 378 removed lines all present in the new modules; one line changed (`framingFor` gained `export`) |
| 2026-11-14 | ScriptValidator split | 1,035 PASS / 0 FAIL (856 + 179 characterisation scenarios) | 435 / 435 (no worker file changed since) | 549 removed lines all present in the new modules |
| 2026-11-15 | final, after all modules | **1,035 PASS / 0 FAIL**, exit 0 | **435 / 435** | both suites re-run in full; safety-critical areas unchanged by diff |
| 2026-11-17 | `d0811a2` staging acceptance | **1,035 PASS / 0 FAIL**, exit 0 | **435 / 435** | pushed to the staging Apps Script project only; 15 of 16 in-app checks completed on base and refactor alike, 1 pre-existing failure on both (STAGING_ACCEPTANCE.md) |
| 2026-11-17 | `2fca32c` (PR #32 merged + fixture correction) | **1,047 PASS / 0 FAIL**, exit 0 | **445 / 445** on rerun; 1 intermittent PR #32 failure in an earlier run (2 in 52 runs of that test) | live staging pages pass; STAGING_ACCEPTANCE.md round 2 |
| 2026-11-17 | `bca17b4` (PR #34 merged in) | **1,047 PASS / 0 FAIL**, exit 0 | **452 / 452**; concurrency test 50 / 50 | live interactive checks pass; PR #31 tree 464/0 and 343/343 with FFmpeg |
