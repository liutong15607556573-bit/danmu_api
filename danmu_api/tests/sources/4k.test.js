import test from 'node:test';
import assert from 'node:assert/strict';
import { parse4kEpisodes, parse4kPlayerMetadata, parse4kSearchResults } from '../../sources/4k.js';

test('4K search cards extract play slug and title, not data-vod', () => {
  const html = '<a href="/play/AbC123" data-vod="vod-x"><img data-src="/cover.jpg"><h3>测试剧集</h3></a>';
  assert.deepEqual(parse4kSearchResults(html), [{
    slug: 'AbC123', title: '测试剧集', imageUrl: '/cover.jpg', year: null
  }]);
});

test('4K detail episode anchors use href slug and data-episode, not dataid', () => {
  const html = '<a href="/play/EpA" data-line="1" data-episode="1" dataid="41755">第1集</a>'
    + '<a href="/play/EpB" data-line="1" data-episode="2" dataid="41756">第2集</a>';
  assert.deepEqual(parse4kEpisodes(html).map(ep => [ep.slug, ep.number, ep.playId]), [
    ['EpA', 1, '41755'], ['EpB', 2, '41756']
  ]);
});

test('4K playback page maps the actual data-v-id and episode number to the API', () => {
  const html = '<div id="player-error-message-detail" data-v-id="2274"></div>'
    + '<div data-danmaku-api-url="https://4k.dmservce.org/api/v1/danmuku" data-danmaku-enabled="true"></div>'
    + '<div x-data="episodeManager(1, 1, [])"></div>';
  assert.deepEqual(parse4kPlayerMetadata(html), {
    apiRoot: 'https://4k.dmservce.org/api/v1/danmuku', videoId: '2274', episode: 1
  });
});

test('4K metadata rejects missing IDs and untrusted API hosts', () => {
  assert.equal(parse4kPlayerMetadata('<div x-data="episodeManager(1, 1, [])"></div>'), null);
  const html = '<div id="player-error-message-detail" data-v-id="1"></div>'
    + '<div data-danmaku-api-url="https://evil.example/api" data-danmaku-enabled="true"></div>'
    + '<div x-data="episodeManager(1, 1, [])"></div>';
  assert.equal(parse4kPlayerMetadata(html), null);
});
