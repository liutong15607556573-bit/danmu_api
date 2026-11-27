import test from 'node:test';
import assert from 'node:assert/strict';
import { Globals } from '../../configs/globals.js';
import { extractTitleSeasonEpisode, filterSameEpisodeTitle } from '../../apis/dandan-api.js';
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


test('文件名解析保留季号并单独识别综艺期数上下半期', async () => {
  Globals.init({});
  const parsed = await extractTitleSeasonEpisode('现在就出发 第4季 S4E2 第1期下：神秘的热带雨林');
  assert.equal(parsed.title, '现在就出发');
  assert.equal(parsed.season, 4);
  assert.equal(parsed.episode, 1);
  assert.equal(parsed.periodPart, '下');
  assert.equal(parsed.isVarietyPeriod, true);
});

test('综艺同一期的上、下、加更候选不会在去重时互相吞掉', () => {
  Globals.init({});
  const candidates = [
    { episodeId: 1, episodeTitle: '【qq】 第1期上：出发团变落汤鸡' },
    { episodeId: 2, episodeTitle: '【qq】 第1期下：雨林挑战' },
    { episodeId: 3, episodeTitle: '【qq】 第1期加更：幕后花絮' },
  ];
  const filtered = filterSameEpisodeTitle(candidates, { includePeriod: true });
  assert.deepEqual(filtered.map(item => item.episodeId), [1, 2, 3]);
});
