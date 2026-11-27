import test from 'node:test';
import assert from 'node:assert/strict';
import { Globals } from '../../configs/globals.js';
import {
  extractEpisodeNumberFromTitle,
  extractSeasonNumberFromAnimeTitle,
  getExplicitSeasonNumber,
  titleMatches,
} from '../../utils/common-util.js';

test('综艺第N期不再被误判为第N季', () => {
  Globals.init({});
  assert.equal(getExplicitSeasonNumber('奔跑吧第1期'), null);
  assert.equal(getExplicitSeasonNumber('奔跑吧第9季'), 9);
  assert.equal(extractSeasonNumberFromAnimeTitle('奔跑吧第1期').season, null);
  assert.equal(extractSeasonNumberFromAnimeTitle('奔跑吧第9季').season, 9);
});

test('按综艺期数搜索时匹配节目标题而不做跨季过滤', () => {
  Globals.init({});
  assert.equal(titleMatches('奔跑吧第9季', '奔跑吧第1期'), true);
  assert.equal(titleMatches('奔跑吧第9季', '奔跑吧第9季第1期'), true);
  assert.equal(titleMatches('奔跑吧第8季', '奔跑吧第9季第1期'), false);
});

test('综艺期数可从分集标题中提取，且不混淆季数', () => {
  assert.equal(extractEpisodeNumberFromTitle('第1期上 周深教孟子义唱歌'), 1);
  assert.equal(extractEpisodeNumberFromTitle('第十二期：嘉宾挑战'), 12);
  assert.equal(extractEpisodeNumberFromTitle('奔跑吧第9季 第1期'), 1);
  assert.equal(extractEpisodeNumberFromTitle('第9季'), null);
});
