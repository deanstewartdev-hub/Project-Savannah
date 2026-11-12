'use strict';
// Integration check across the main app and the worker, without paid calls:
//   main app (real VideoProcessingProvider.js and YouTube_Service.js, run in a VM with stubbed Apps Script
//   services) -> real HTTP -> a test worker (real job route, real music preparation with real ffprobe on a
//   generated audio file, real callback sender; narration, visuals, assembly and delivery are skipped)
//   -> real HTTP callback -> back in the main app, where the render is reviewed and its YouTube details built.
// Not covered here: Cloud Run, the dispatcher's Cloud Run calls (see media-worker/test/renderJobGuard.test.js),
// Sheets persistence, and the callback inbox. Those need a staging environment (RELEASE_READINESS.md §18d).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const workerDir = path.join(root, 'media-worker');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const TRACK_ID = 'scott-buckley-beyond-these-walls';
const CREDIT = "'Beyond These Walls' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au";
const WORKER_PORT = 18081;
const CALLBACK_PORT = 18082;
const SECRET = 'integration-submit-secret';
let passed = 0;
function check(name, run) { run(); passed++; console.log('PASS ' + name); }

const SCENES = Array.from({ length: 4 }, (_, i) => ({
  narration: Array.from({ length: 25 }, () => 'word').join(' '),
  visualDirection: 'blue street ' + i
}));
const SCRIPT = { id: 'SCR-INTEGRATION', title: 'Chefchaouen', scenes: SCENES };
const SEO = { id: 'SEO-1', titleOptions: ['Chefchaouen: The Blue City'], description: 'Owner text', hashtags: ['travel'], tags: ['travel'] };

async function main() {
  // 1. A generated audio file stands in for the downloaded track: 60 s, real MP3, real ffprobe.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'savannah-chain-'));
  const musicFile = path.join(tmp, 'track.mp3');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=60', '-ac', '2', '-b:a', '128k', '-y', musicFile]);

  // 2. The manifest the test worker uses: the same entry shape and credit text as the production candidate.
  const manifest = { tracks: [{
    id: TRACK_ID, file: 'music/scott-buckley-beyond-these-walls.mp3', title: 'Beyond These Walls', licence: 'CC-BY-4.0',
    sourceUrl: 'https://www.scottbuckley.com.au/library/beyond-these-walls/',
    termsUrl: 'https://www.scottbuckley.com.au/library/beyond-these-walls/',
    verifiedBy: 'integration-test', verifiedOn: '2026-11-03', attributionRequired: true, attribution: CREDIT,
    monetizationAllowed: true
  }] };

  // 3. Callback receiver: records what the worker posts back, as Apps Script would receive it.
  const callbacks = [];
  const callbackServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      callbacks.push({ url: req.url, body: JSON.parse(body || '{}') });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });
  });
  await new Promise(resolve => callbackServer.listen(CALLBACK_PORT, '127.0.0.1', resolve));

  // 4. Test worker in its own process, so the main app's synchronous HTTP calls do not block it.
  const worker = spawn(process.execPath, ['scripts/chain-integration-server.mjs'], {
    cwd: workerDir,
    env: Object.assign({}, process.env, {
      PORT: String(WORKER_PORT), JOB_SUBMIT_SECRET: SECRET, TEST_MANIFEST_JSON: JSON.stringify(manifest),
      TEST_MUSIC_FILE: musicFile, GCS_BUCKET: 'integration', CLOUD_RUN_PROJECT: 'integration', RENDER_JOB_NAME: 'integration',
      ELEVENLABS_VOICE_ID: 'integration', OPENAI_API_KEY: 'integration', ELEVENLABS_API_KEY: 'integration', PEXELS_API_KEY: 'integration'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let workerLog = '';
  worker.stdout.on('data', chunk => { workerLog += chunk; });
  worker.stderr.on('data', chunk => { workerLog += chunk; });
  const stopAll = () => { worker.kill(); callbackServer.close(); };
  try {
    await waitFor(async () => (await fetch('http://127.0.0.1:' + WORKER_PORT + '/health').catch(() => null))?.ok, 20000, 'the test worker to start\n' + workerLog);

    // 5. Main app, in a VM. UrlFetchApp is a synchronous HTTP call (curl), as in Apps Script.
    const requests = [];
    const context = vm.createContext({
      Utilities: {
        getUuid: randomUUID,
        DigestAlgorithm: { SHA_256: 'SHA_256' },
        computeDigest: (algorithm, text) => Array.from(require('node:crypto').createHash('sha256').update(text).digest(), byte => (byte << 24) >> 24)
      },
      Secrets: {
        getMediaWorkerUrl: () => 'http://127.0.0.1:' + WORKER_PORT,
        getMediaWorkerCallbackUrl: () => 'http://127.0.0.1:' + CALLBACK_PORT + '/exec',
        getMediaWorkerJobSubmitSecret: () => SECRET,
        getMediaWorkerSharedSecret: () => 'callback-secret-integration',
        getVideoProvider: () => 'cloud-run'
      },
      UrlFetchApp: {
        fetch(url, options) {
          const method = (options && options.method || 'get').toUpperCase();
          const args = ['-s', '-S', '-X', method, '-w', '\n__STATUS__%{http_code}', url];
          const headers = (options && options.headers) || {};
          Object.keys(headers).forEach(name => args.push('-H', name + ': ' + headers[name]));
          if (options && options.contentType) args.push('-H', 'Content-Type: ' + options.contentType);
          const input = options && options.payload ? options.payload : undefined;
          if (input !== undefined) args.push('--data-binary', '@-');
          requests.push({ method, url, payload: input ? JSON.parse(input) : null });
          // Windows ships curl.exe; the Linux CI runner ships curl. Same arguments either way.
          const out = execFileSync(process.platform === 'win32' ? 'curl.exe' : 'curl', args, { input: input, encoding: 'utf8' });
          const cut = out.lastIndexOf('\n__STATUS__');
          const status = Number(out.slice(cut + '\n__STATUS__'.length));
          const text = out.slice(0, cut);
          return { getResponseCode: () => status, getContentText: () => text, getBlob: () => null };
        }
      },
      assertNotStaging_: () => {},
      Logger: { log() {} }
    });
    vm.runInContext(read('Production/VideoProcessingProvider.js'), context, { filename: 'VideoProcessingProvider.js' });
    vm.runInContext(read('Production/YouTube_Service.js'), context, { filename: 'YouTube_Service.js' });

    // 6. A valid render request through the main app. The worker must run it with the verified track.
    const renderId = 'cr-' + randomUUID();
    context.__script = SCRIPT; context.__seo = SEO; context.__renderId = renderId;
    const submitted = vm.runInContext('VideoProcessingProvider.get("cloud-run").submitRender(__script, __seo, { renderId: __renderId })', context);
    const submitRequest = requests.filter(r => r.url.endsWith('/jobs'))[0];
    check('the main app sends the verified track ID and no path, object or placeholder flag', () => {
      assert.equal(submitRequest.payload.musicTrackId, TRACK_ID);
      assert.equal(submitRequest.payload.musicTrackPath, undefined);
      assert.equal(submitRequest.payload.legacyPlaceholderMusic, undefined);
      assert.equal(submitRequest.payload.jobId, renderId);
    });
    check('the worker accepts the request and returns the verified track summary with the credit', () => {
      assert.equal(submitted.render.id, renderId);
      assert.equal(submitted.payload.music.id, TRACK_ID);
      assert.equal(submitted.payload.music.attribution, CREDIT);
      assert.equal(submitted.payload.music.attributionRequired, true);
    });

    // 7. The callback arrives after the worker has prepared the music (real download, real ffprobe).
    const callback = await waitFor(async () => callbacks.filter(c => c.body.jobId === renderId)[0], 60000, 'the render callback');
    check('the callback reports a completed render that used the verified track', () => {
      assert.equal(callback.body.status, 'completed');
      assert.equal(callback.body.music.id, TRACK_ID);
      assert.equal(callback.body.music.attribution, CREDIT);
      assert.match(callback.body.video.url, /final\.mp4$/);
    });
    check('the callback secret travels in the body, not in the URL', () => {
      assert.equal(callback.url.indexOf('callback-secret'), -1);
    });

    // 8. The render row the main app keeps: its music record comes from the 202, not from the callback.
    const renderRow = { id: renderId, scriptId: SCRIPT.id, seoPackId: SEO.id, status: 'SUCCEEDED',
      videoUrl: callback.body.video.url, requestPayload: submitted.payload };
    context.__row = renderRow;
    const review = vm.runInContext('YouTubeService.previewUpload(__row, __seo, { title: "Chefchaouen: The Blue City", uploadAttemptId: "PUB-CHAIN001" })', context);
    check('the review shows the exact title, description and credit the upload will send', () => {
      assert.equal(review.title, 'Chefchaouen: The Blue City');
      assert.ok(review.description.indexOf('Music: ' + CREDIT) !== -1);
      assert.equal(review.music.id, TRACK_ID);
      assert.match(review.metadataHash, /^[0-9a-f]{64}$/);
    });

    // 9. Refusals at the worker: none of these may start a job.
    const runsBefore = (await (await fetch('http://127.0.0.1:' + WORKER_PORT + '/__runs')).json()).length;
    const post = async (body) => fetch('http://127.0.0.1:' + WORKER_PORT + '/jobs', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + SECRET },
      body: JSON.stringify(Object.assign({ jobId: 'cr-' + randomUUID(), beats: SCENES.map(s => ({ text: s.narration, visualQuery: s.visualDirection })), callbackUrl: 'http://127.0.0.1:' + CALLBACK_PORT + '/exec' }, body))
    });
    // Each refusal must be refused for the music reason it names, not for some other field.
    const refusals = [
      ['no music field', {}, /musicTrackId from the verified manifest is required/],
      ['an unknown track ID', { musicTrackId: 'not-a-track' }, /not an approved track/],
      ['a file path', { musicTrackId: TRACK_ID, musicTrackPath: 'music/x.mp3' }, /musicTrack and musicTrackPath are not accepted/],
      ['a track object', { musicTrack: { id: TRACK_ID } }, /musicTrack and musicTrackPath are not accepted/],
      ['a placeholder flag that also names a track', { legacyPlaceholderMusic: true, musicTrackId: TRACK_ID }, /cannot also name a musicTrackId/]
    ];
    for (const [label, body, message] of refusals) {
      const response = await post(body);
      const text = await response.text();
      assert.equal(response.status, 400, label + ' is refused with 400');
      assert.match(text, message, label + ' is refused for the music reason');
    }
    const runsAfter = (await (await fetch('http://127.0.0.1:' + WORKER_PORT + '/__runs')).json()).length;
    check('no refused request starts a job', () => assert.equal(runsAfter, runsBefore));

    // 10. A placeholder run is accepted only when it says so, and its callback records no licensed track.
    const legacyId = 'cr-' + randomUUID();
    const legacy = await post({ jobId: legacyId, legacyPlaceholderMusic: true });
    assert.equal(legacy.status, 202);
    const legacyCallback = await waitFor(async () => callbacks.filter(c => c.body.jobId === legacyId)[0], 60000, 'the placeholder callback');
    check('a placeholder run records no music track', () => {
      assert.equal(legacyCallback.body.music.id, '');
      assert.equal(legacyCallback.body.music.attribution, '');
    });
    context.__legacyRow = { id: legacyId, scriptId: SCRIPT.id, seoPackId: SEO.id, status: 'SUCCEEDED',
      videoUrl: legacyCallback.body.video.url, requestPayload: { provider: 'cloud-run' } };
    const legacyRefused = vm.runInContext('(function(){ try { YouTubeService.previewUpload(__legacyRow, __seo, {title:"x", uploadAttemptId:"PUB-CHAIN002"}); return "allowed"; } catch (e) { return e.message; } })()', context);
    check('a placeholder render cannot be previewed or uploaded as if it were licensed', () => {
      assert.match(legacyRefused, /no verified music record/);
    });

    console.log('Chain integration (main app -> worker -> callback): ' + passed + '/' + passed + ' passed.');
  } finally {
    stopAll();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function waitFor(probe, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for ' + label);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
