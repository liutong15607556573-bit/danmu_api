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
  assert.equal(getExplicitSeasonNumber('奔跑吧第1期', false), null);
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
  assert.equal(extractEpisodeNumberFromTitle('第1期上 周深教孟子义唱歌', false, true), 1);
  assert.equal(extractEpisodeNumberFromTitle('第十二期：嘉宾挑战', false, true), 12);
  assert.equal(extractEpisodeNumberFromTitle('奔跑吧第9季 第1期', false, true), 1);
  assert.equal(extractEpisodeNumberFromTitle('第9季'), null);
});


test('综艺上下半期与加更必须区分，不能只按期数合并', async () => {
  const { extractEpisodePartFromTitle } = await import('../../utils/common-util.js');
  assert.equal(extractEpisodePartFromTitle('【qq】 第1期上：出发团集合'), '上');
  assert.equal(extractEpisodePartFromTitle('【qq】 第1期下：雨林挑战'), '下');
  assert.equal(extractEpisodePartFromTitle('【qq】 第1期加更：幕后花絮'), '加更');
  assert.equal(extractEpisodePartFromTitle('【qq】 先导片下'), null);
  assert.equal(extractEpisodePartFromTitle('【qq】 第2集'), null);
});
