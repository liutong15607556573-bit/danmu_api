import test from 'node:test';
import assert from 'node:assert/strict';
import { parse4kEpisodes, parse4kPlayerMetadata, parse4kSearchResults, normalize4kDanmaku } from '../../sources/4k.js';

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

test('4K API comments normalize seconds, modes and all hex colors including black', () => {
  assert.deepEqual(normalize4kDanmaku([
    { time: 48, mode: 0, color: '#000000', content: '黑色弹幕' },
    { time: '12.5', mode: 1, color: '#FFFFFF', content: '白色弹幕' },
    { time: 'bad', mode: 1, color: '#FFFFFF', content: 'invalid' },
    { time: 5, mode: 1, color: '#FFFFFF', content: '' }
  ]), [
    { timepoint: 48, ct: 0, color: 0, content: '黑色弹幕' },
    { timepoint: 12.5, ct: 1, color: 16777215, content: '白色弹幕' },
    { timepoint: 5, ct: 1, color: 16777215, content: '' }
  ]);
});


test('4K real-page-shaped markup extracts player metadata and episode slugs', () => {
  // 精简自公开的 4K 影视播放页 HTML 结构，保留真实属性顺序与 Alpine 参数形态。
  const html = `
    <div class="player" x-data="artPlayer()" data-danmaku-enabled="true"
      data-danmaku-api-url="https://4k.dmservce.org/api/v1/danmuku"></div>
    <p id="player-error-message-detail" data-v-id="5496"></p>
    <div x-data="episodeManager(1, 1, [
      { lineName: 'alists', episodeCount: 60 }
    ])"></div>
    <a href="/play/ch4rt1ctb" @click.prevent="handleEpisodeClick($el.getAttribute('href'), '41755', 1, 1)"
      x-show="showEpisode(1)" data-line="1" data-episode="1" dataid="41755">1</a>
    <a href="/play/ch4rt1ctc" @click.prevent="handleEpisodeClick($el.getAttribute('href'), '41756', 1, 2)"
      x-show="showEpisode(2)" data-line="1" data-episode="2" dataid="41756">2</a>
  `;
  assert.deepEqual(parse4kPlayerMetadata(html), {
    apiRoot: 'https://4k.dmservce.org/api/v1/danmuku', videoId: '5496', episode: 1
  });
  assert.deepEqual(parse4kEpisodes(html).map(ep => [ep.slug, ep.number, ep.playId]), [
    ['ch4rt1ctb', 1, '41755'], ['ch4rt1ctc', 2, '41756']
  ]);
});
