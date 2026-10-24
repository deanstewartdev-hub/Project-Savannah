'use strict';
// YouTubeAnalyticsService.capture(): first CI coverage for the Analytics stage.
// YouTube Data API and the snapshot sheets are in-memory fakes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }

function setup(videoCount, options) {
  const opts = options || {};
  const published = Array.from({ length: videoCount }, (_, i) => ({
    id: 'PUB-' + i, scriptId: 'SCR-' + i, status: 'PUBLISHED', youtubeVideoId: 'VID' + i, title: 'Video ' + i, createdAt: '2026-10-01T00:00:00Z'
  }));
  const requests = [];
  const saved = [];
  const context = vm.createContext({
    PublishingJobRepository: { getAll: () => published.concat(opts.extraJobs || []) },
    YouTube: {
      Videos: { list: (parts, query) => {
        const ids = query.id.split(',');
        requests.push(ids.length);
        if (ids.length > 50) throw new Error('YouTube rejects more than 50 IDs per request');
        return { items: ids.filter(id => !(opts.deleted || []).includes(id)).map(id => ({
          id, snippet: { title: 'T ' + id, publishedAt: '2026-10-02T00:00:00Z' },
          statistics: { viewCount: String(1000 + Number(id.slice(3))), likeCount: '7', commentCount: '2' },
          contentDetails: { duration: 'PT41S' }, status: { privacyStatus: 'public' }
        })) };
      } },
      Channels: { list: () => ({ items: [{ id: 'CHAN', snippet: { title: 'Savannah Atlas' }, statistics: { subscriberCount: '10', viewCount: '5000', videoCount: '3' } }] }) }
    },
    AnalyticsSnapshotRepository: {
      getLatestByVideoId: () => null,
      save: record => { saved.push(record); return record; }
    },
    ChannelAnalyticsRepository: { save: r => r, getAll: () => [], latest: () => null }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'Analytics/YouTubeAnalytics_Service.js'), 'utf8'), context, { filename: 'YouTubeAnalytics_Service.js' });
  const result = JSON.parse(JSON.stringify(vm.runInContext('YouTubeAnalyticsService.capture()', context)));
  return { result, requests, saved };
}

test('per-video snapshots record view counts (previously always 0)', () => {
  const t = setup(3);
  assert.equal(t.saved.length, 3);
  assert.deepEqual(t.saved.map(s => s.views), ['1000', '1001', '1002']);
  assert.equal(t.saved[0].likes, '7');
});

test('more than 50 published videos are captured in batches of at most 50', () => {
  const t = setup(120);
  assert.deepEqual(t.requests, [50, 50, 20]);
  assert.equal(t.saved.length, 120);
  assert.deepEqual(t.result.missing, [], 'Videos after the 50th were reported missing.');
});

test('a video deleted from YouTube is reported missing, not dropped silently', () => {
  const t = setup(60, { deleted: ['VID55'] });
  assert.deepEqual(t.result.missing, ['VID55']);
  assert.equal(t.saved.length, 59);
});

test('only PUBLISHED uploads with a video ID are requested', () => {
  const t = setup(2, { extraJobs: [
    { id: 'PUB-X', status: 'RECONCILE', youtubeVideoId: 'VIDX' },
    { id: 'PUB-Y', status: 'PUBLISHED', youtubeVideoId: '' }
  ] });
  assert.deepEqual(t.requests, [2]);
});

console.log(`Analytics capture: ${passed}/${passed} passed.`);
