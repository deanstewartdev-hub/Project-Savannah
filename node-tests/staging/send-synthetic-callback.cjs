#!/usr/bin/env node
'use strict';
// STAGING ONLY. Sends one synthetic media-worker callback to a STAGING callback
// bridge so the inbox pipeline can be verified without a real render.
// See CALLBACK_INBOX_STAGING.md for the full procedure. Not run by CI.
//
// The bridge URL and secret come from environment variables (never argv) so the
// secret stays out of shell history and process listings:
//   SAVANNAH_STAGING_BRIDGE_URL      the STAGING bridge's /exec URL (no query string)
//   SAVANNAH_STAGING_CALLBACK_SECRET the STAGING bridge's MEDIA_WORKER_SHARED_SECRET
//
// Usage:
//   node node-tests/staging/send-synthetic-callback.cjs --i-am-targeting-staging <scenario> <cr-render-id>
// Scenarios: completed | link-refresh | failed | no-video | http-video | mismatched-job | bad-secret |
//            malformed-id | unknown-status
const { randomUUID } = require('node:crypto');

// Known production deployments (see HANDOFF.md). Refuse them outright.
const PRODUCTION_MARKERS = [
  'AKfycbzfD4HhW82TJyrdl5wteB1L84uiQJqb_hANd106zLDOOpY4HKqclGv67noe-kpQn2vDDw'
];
const RENDER_ID = /^cr-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SYNTHETIC_VIDEO = 'https://example.invalid/savannah-staging/synthetic-callback.mp4';

class Refused extends Error {}

function fail(message) {
  console.error('REFUSED: ' + message);
  process.exit(2);
}

function payloadFor(scenario, renderId) {
  const gcsPath = 'renders/' + renderId + '/final.mp4';
  switch (scenario) {
    case 'completed':
      // gcsPath mirrors media-worker/src/pipeline/deliver.js so a later link refresh can match it.
      return { jobId: renderId, status: 'completed',
        video: { url: SYNTHETIC_VIDEO, gcsPath, durationSeconds: 40, width: 1080, height: 1920 },
        probe: { durationSeconds: 40, width: 1080, height: 1920, synthetic: true } };
    case 'link-refresh':
      // What delivery recovery sends: the same artifact, re-signed under a new URL.
      return { jobId: renderId, status: 'completed',
        video: { url: SYNTHETIC_VIDEO + '?refreshed=1', gcsPath, durationSeconds: 40, width: 1080, height: 1920 },
        probe: { durationSeconds: 40, width: 1080, height: 1920, synthetic: true } };
    case 'failed':
      return { jobId: renderId, status: 'failed', error: { message: 'Synthetic staging failure callback.' } };
    case 'no-video':
      return { jobId: renderId, status: 'completed', video: {}, probe: { synthetic: true } };
    case 'http-video':
      return { jobId: renderId, status: 'completed', video: { url: 'http://example.invalid/insecure.mp4' }, probe: {} };
    case 'mismatched-job':
      return { jobId: 'cr-' + randomUUID(), status: 'completed', video: { url: SYNTHETIC_VIDEO }, probe: {} };
    case 'bad-secret':
      return { jobId: renderId, status: 'completed', video: { url: SYNTHETIC_VIDEO }, probe: {} };
    case 'malformed-id':
      return { jobId: 'RND-NOT-A-CLOUD-RUN-ID', status: 'completed', video: { url: SYNTHETIC_VIDEO }, probe: {} };
    case 'unknown-status':
      return { jobId: renderId, status: 'succeeded', video: { url: SYNTHETIC_VIDEO }, probe: {} };
    default:
      return null;
  }
}

// Throws Refused (never sends) unless the target is clearly a staging bridge.
function stagingTarget(env) {
  const base = String(env.SAVANNAH_STAGING_BRIDGE_URL || '').trim();
  const secret = String(env.SAVANNAH_STAGING_CALLBACK_SECRET || '');
  if (!base) throw new Refused('SAVANNAH_STAGING_BRIDGE_URL is not set.');
  if (!secret) throw new Refused('SAVANNAH_STAGING_CALLBACK_SECRET is not set.');
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/?#]+\/exec$/.test(base)) {
    throw new Refused('bridge URL must be a bare https://script.google.com/macros/s/<id>/exec URL.');
  }
  if (PRODUCTION_MARKERS.some(marker => base.includes(marker))) throw new Refused('that is the PRODUCTION deployment.');
  return { base, secret };
}

async function send(target, scenario, renderId) {
  if (!RENDER_ID.test(String(renderId || ''))) throw new Refused('render ID must look like cr-<uuid>.');
  const payload = payloadFor(scenario, renderId);
  if (!payload) throw new Refused('unknown scenario "' + scenario + '".');
  const usedSecret = scenario === 'bad-secret' ? 'wrong-' + randomUUID() : target.secret;
  const url = target.base + '?route=media-worker-callback&secret=' + encodeURIComponent(usedSecret);
  // Apps Script answers POST with a 302 to a GET echo URL; fetch follows it.
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch (ignored) {}
  // Never return the URL: it carries the secret.
  return { scenario, renderId: payload.jobId, httpStatus: response.status, response: body || text.slice(0, 300) };
}

function redact(error) {
  return String(error && error.message || error).replace(/secret=[^&\s]+/g, 'secret=REDACTED');
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] !== '--i-am-targeting-staging') fail('first argument must be --i-am-targeting-staging.');
  const [, scenario, renderId] = args;
  let target;
  try {
    target = stagingTarget(process.env);
    if (!RENDER_ID.test(String(renderId || ''))) throw new Refused('render ID must look like cr-<uuid>.');
    if (!payloadFor(scenario, renderId)) throw new Refused('unknown scenario "' + scenario + '".');
  } catch (error) {
    if (error instanceof Refused) fail(error.message);
    throw error;
  }
  console.log(JSON.stringify(await send(target, scenario, renderId), null, 2));
}

module.exports = { Refused, payloadFor, stagingTarget, send, redact, RENDER_ID };

if (require.main === module) {
  main().catch(error => {
    console.error('Request failed: ' + redact(error));
    process.exit(1);
  });
}
