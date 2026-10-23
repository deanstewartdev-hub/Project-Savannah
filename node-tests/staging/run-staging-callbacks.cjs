#!/usr/bin/env node
'use strict';
// STAGING ONLY. Sends the full synthetic callback sequence to a STAGING callback
// bridge and checks every bridge response. Step 2 of 3 in CALLBACK_INBOX_STAGING.md:
//   1. In the staging Apps Script editor run stagingSeedRenderJobs(); it prints the
//      exact command for this step, including the five render IDs.
//   2. Run that command here.
//   3. In the staging editor run stagingVerifyRun(); it checks the end state.
//
// Same environment variables and guards as send-synthetic-callback.cjs. Not run by CI.
//
// Usage:
//   node node-tests/staging/run-staging-callbacks.cjs --i-am-targeting-staging <id1> <id2> <id3> <id4> <unmatchedId>
const { Refused, stagingTarget, send, redact, RENDER_ID } = require('./send-synthetic-callback.cjs');

const QUEUED = r => r && r.success === true && r.queued === true;
const REJECTED = pattern => r => r && r.success === false && pattern.test(String(r.error || ''));

// Order matters: the inbox applies receipts in arrival order.
function plan(ids) {
  const [id1, id2, id3, id4, unmatched] = ids;
  return [
    ['T1  completed delivery is accepted', 'completed', id1, QUEUED],
    ['T5a duplicate completed delivery is accepted (inbox ignores it later)', 'completed', id1, QUEUED],
    ['T5b late failure after completion is accepted (inbox ignores it later)', 'failed', id1, QUEUED],
    ['T9  delivery recovery re-signs the same video', 'link-refresh', id1, QUEUED],
    ['T6a wrong secret is refused', 'bad-secret', id2, REJECTED(/Unauthorized/)],
    ['T6b malformed render ID is refused', 'malformed-id', id2, REJECTED(/Malformed render ID/)],
    ['T6c unknown status is refused', 'unknown-status', id2, REJECTED(/Unknown or missing status/)],
    ['T6d completed without a video is accepted (inbox rejects it later)', 'no-video', id2, QUEUED],
    ['T6e completed with an http:// video is accepted (inbox rejects it later)', 'http-video', id2, QUEUED],
    ['T6f delivery for an unknown render is accepted (inbox defers it)', 'completed', unmatched, QUEUED],
    ['T7  delivery before its render job exists is accepted (inbox defers it)', 'completed', id3, QUEUED],
    ['T8  failure delivery is accepted', 'failed', id4, QUEUED]
  ];
}

async function run(argv, env, sender) {
  const args = argv.slice();
  if (args[0] !== '--i-am-targeting-staging') throw new Refused('first argument must be --i-am-targeting-staging.');
  const ids = args.slice(1, 6);
  if (ids.length !== 5 || !ids.every(id => RENDER_ID.test(id))) {
    throw new Refused('expected five cr-<uuid> render IDs, exactly as printed by stagingSeedRenderJobs().');
  }
  if (new Set(ids).size !== 5) throw new Refused('the five render IDs must all be different.');
  const target = stagingTarget(env);
  const results = [];
  for (const [label, scenario, renderId, expect] of plan(ids)) {
    let outcome;
    try { outcome = await sender(target, scenario, renderId); } catch (error) { outcome = { error: redact(error) }; }
    const ok = !outcome.error && expect(outcome.response);
    results.push({ label, ok, response: outcome.error || outcome.response });
  }
  return results;
}

async function main() {
  let results;
  try {
    results = await run(process.argv.slice(2), process.env, send);
  } catch (error) {
    if (error instanceof Refused) { console.error('REFUSED: ' + error.message); process.exit(2); }
    console.error('Run failed: ' + redact(error)); process.exit(1);
  }
  for (const r of results) {
    console.log((r.ok ? 'PASS ' : 'FAIL ') + r.label + (r.ok ? '' : '\n     bridge said: ' + JSON.stringify(r.response)));
  }
  const failed = results.filter(r => !r.ok).length;
  console.log(failed ? `\n${failed} of ${results.length} bridge checks FAILED. Do not continue; see CALLBACK_INBOX_STAGING.md "If something fails".` :
    `\nAll ${results.length} bridge checks passed. Now run stagingVerifyRun() in the staging Apps Script editor.`);
  process.exit(failed ? 1 : 0);
}

module.exports = { run, plan };
if (require.main === module) main();
