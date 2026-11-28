// 弹弹play 兼容接口：标题/季集解析、匹配与检索 URL
// 由原单文件测试 worker.test.js 机械拆分而来，用例名与断言未做改动。

import dotenv from 'dotenv';
dotenv.config();

import test from 'node:test';
import assert from 'node:assert';
import { extractTitleSeasonEpisode, buildSearchAnimeUrl, matchSeason, matchAniAndEp, fallbackMatchAniAndEp, filterSameEpisodeTitle, buildBangumiData, resolveEpisodeCount, applyEpisodeTitleFilter, filterEpisodesByTitle, filterEpisodesByEdition, classifyEpisodeEdition, detectExplicitEpisodeEdition, detectAnimeTitleEdition, withAvailableEpisodeCount, buildMatchScoring, resolveSegmentCommentCacheKey, checkEpisodeSatisfied } from '../../apis/dandan-api.js';
import { getSearchCache, setSearchCache } from '../../utils/cache-util.js';
import { addFavorite, removeFavorite, resolveFavoriteForSearchKeyword, saveFavorites } from '../../utils/favorite-util.js';
import { Globals, globals } from '../../configs/globals.js';
import { normalizeTitleForMatch } from '../../utils/common-util.js';
import { urlPrefix } from '../helpers/context.js';

test('buildSearchAnimeUrl should preserve special characters in keyword', async () => {
    const searchUrl = buildSearchAnimeUrl(`${urlPrefix}/api/v2/match`, 'Love & Death', 1, 2);

    assert.equal(searchUrl.pathname, '/api/v2/search/anime');
    assert.equal(searchUrl.searchParams.get('keyword'), 'Love & Death');
    assert.equal(searchUrl.searchParams.get('season'), '1');
    assert.equal(searchUrl.searchParams.get('episode'), '2');
    assert.equal(searchUrl.searchParams.has(' Death'), false);
  });
test('buildSearchAnimeUrl should derive /search/anime from /search/episodes requests', async () => {
    const searchUrl = buildSearchAnimeUrl(`${urlPrefix}/api/v2/search/episodes?anime=Love%20%26%20Death&episode=2`, 'Love & Death');

    assert.equal(searchUrl.pathname, '/api/v2/search/anime');
    assert.equal(searchUrl.searchParams.get('keyword'), 'Love & Death');
    assert.equal(searchUrl.searchParams.has('season'), false);
    assert.equal(searchUrl.searchParams.has('episode'), false);
  });
  // 测试标题解析
test('文件名版本标记识别 Pure/Plus/Special/Live，忽略清晰度编码', async () => {
  const cases = [
    ['Natural.High.S04E03.2026.1080p.TX.WEB-DL.H265.AAC', 'standard'],
    ['Natural.High.S04E03.Pure.2026.2160p.WEB-DL.H265', 'pure'],
    ['Natural.High.S04E03.Plus.2026.1080p.WEB-DL.H265', 'plus'],
    ['Natural.High.S04E03.Special.2026.1080p.WEB-DL.H265', 'special'],
    ['Natural.High.S04E03.Live.2026.1080p.WEB-DL.H265', 'live'],
    ['Natural.High.S04E03.2026.1080p.WEB-DL.H265.AAC-LiveGroup', 'standard'],
    ['Natural.High.S04E03.2026.1080p.WEB-DL.H265.SP-ReleaseGroup', 'standard'],
    ['Natural.High.S04E03.2026.WEBRip.HDR10.LiveGroup', 'standard'],
    ['Natural.High.S04E03.2026.BluRay.x265.SP-ReleaseGroup', 'standard'],
    ['Natural.High.S04E03.Special.2026.1080p.WEB-DL.H265.ReleaseGroup', 'special'],
  ];
  for (const [filename, edition] of cases) {
    const parsed = await extractTitleSeasonEpisode(filename);
    assert.equal(parsed.edition, edition, filename);
    assert.equal(parsed.title, 'Natural High');
    assert.equal(parsed.season, 4);
    assert.equal(parsed.episode, 3);
  }
});

test('版本标记支持空格和连字符分隔', async () => {
  const cases = [
    ['Natural High S04E03 Pure 2026 1080p', 'pure'],
    ['Natural High S04E03-Plus-2026-1080p', 'plus'],
    ['Natural High S04E03 Special 2026 1080p', 'special'],
    ['Natural High S04E03 Live 2026 1080p', 'live'],
  ];
  for (const [filename, edition] of cases) {
    const parsed = await extractTitleSeasonEpisode(filename);
    assert.equal(parsed.edition, edition, filename);
  }
});

test('中文综艺期数后紧跟全角括号时仍能识别版本', async () => {
  const plus = await extractTitleSeasonEpisode('自然高光 第3期（加更版）2026 1080p');
  assert.equal(plus.episode, 3);
  assert.equal(plus.edition, 'plus');
  const pure = await extractTitleSeasonEpisode('自然高光 第3期【纯享版】2026 1080p');
  assert.equal(pure.episode, 3);
  assert.equal(pure.edition, 'pure');
});

test('中文综艺第N期文件名也能识别期数后的版本标记', async () => {
  const parsed = await extractTitleSeasonEpisode('自然高光 第3期上 加更版 2026 1080p');
  assert.equal(parsed.episode, 3);
  assert.equal(parsed.edition, 'plus');
});

test('版本筛选严格隔离特殊版，不让普通版命中特殊版', () => {
  const episodes = [
    { episodeId: 'standard', episodeTitle: '第3集 正片' },
    { episodeId: 'pure', episodeTitle: '第3集 Pure 纯享版' },
    { episodeId: 'plus', episodeTitle: '第3集 Plus 加更版' },
    { episodeId: 'special', episodeTitle: '第3集 Special 特辑' },
    { episodeId: 'live', episodeTitle: '第3集 Live 直播回放' },
  ];
  for (const edition of ['standard', 'pure', 'plus', 'special', 'live']) {
    assert.deepEqual(filterEpisodesByEdition(episodes, edition).map(ep => ep.episodeId), [edition]);
  }
  assert.deepEqual(
    filterEpisodesByEdition([{ episodeId: 'series-plus', episodeTitle: '第3集' }], 'plus', 'Natural High (Plus)').map(ep => ep.episodeId),
    ['series-plus'],
    '分集标题没有版本词时，可使用节目条目标题中的版本标记'
  );
  assert.deepEqual(
    filterEpisodesByEdition([{ episodeId: 'unknown', episodeTitle: '第3集' }], 'standard').map(ep => ep.episodeId),
    ['unknown'],
    '未标记候选兼容普通正片，避免常规剧集全部失去匹配'
  );
  assert.deepEqual(
    filterEpisodesByEdition([{ episodeId: 'unknown', episodeTitle: '第3集' }], 'plus'),
    [],
    '特殊版本没有明确版本证据时必须拒绝匹配'
  );
  assert.deepEqual(
    filterEpisodesByEdition([
      { episodeId: 'unknown', episodeTitle: '第3集' },
      { episodeId: 'standard', episodeTitle: '第3集 正片' },
    ], 'standard').map(ep => ep.episodeId),
    ['unknown', 'standard'],
    '普通正片可兼容未标记候选，但排除明确标记的特殊版本'
  );
  assert.equal(detectExplicitEpisodeEdition('第3集'), null);
  assert.equal(detectExplicitEpisodeEdition('第3集 正片'), 'standard');
  assert.equal(detectExplicitEpisodeEdition('Special Investigation 第3集'), null, '集标题正文出现 Special 不应误判版本');
  assert.equal(detectExplicitEpisodeEdition('Natural High Live Concert 第3集'), null, '节目正文出现 Live 不应误判版本');
  assert.equal(detectAnimeTitleEdition('Live With Kelly'), null, '节目正式名称包含 Live 不应误判');
  assert.equal(detectAnimeTitleEdition('Special Forces'), null, '节目正式名称包含 Special 不应误判');
  assert.equal(detectAnimeTitleEdition('Natural High Live'), null, '节目名称末尾普通 Live 单词不应误判');
  assert.equal(detectAnimeTitleEdition('Natural High (Live)'), 'live', '节目标题括号中的 Live 标签应识别');
  assert.equal(detectAnimeTitleEdition('Natural High - (Plus)'), 'plus', '节目标题括号中的 Plus 标签应识别');
  assert.deepEqual(
    filterEpisodesByEdition([{ episodeId: 'series-live', episodeTitle: '第3集' }], 'live', 'Natural High Live'),
    [],
    '节目正式名称以 Live 结尾时不能当作 Live 版本标签'
  );
  assert.deepEqual(
    filterEpisodesByEdition([{ episodeId: 'series-live-tag', episodeTitle: '第3集' }], 'live', 'Natural High (Live)'),
    [{ episodeId: 'series-live-tag', episodeTitle: '第3集' }],
    '节目标题括号中的明确 Live 标签可以作为版本证据'
  );
});

test('PARSE TitleSeasonEpisode', async () => {
    let title, season, episode;
    ({title, season, episode} = await extractTitleSeasonEpisode("生万物 S02E08"));
    assert(title === "生万物" && season == 2 && episode == 8, `Expected title === "生万物" && season == 2 && episode == 8, but got ${title} ${season} ${episode}`);

    ({title, season, episode} = await extractTitleSeasonEpisode("无忧渡.S02E08.2160p.WEB-DL.H265.DDP.5.1"));
    assert(title === "无忧渡" && season == 2 && episode == 8, `Expected title === "无忧渡" && season == 2 && episode == 8, but got ${title} ${season} ${episode}`);

    // ({title, season, episode} = await extractTitleSeasonEpisode("Blood.River.S02E08"));
    // assert(title === "暗河传" && season == 2 && episode == 8, `Expected title === "暗河传" && season == 2 && episode == 8, but got ${title} ${season} ${episode}`);

    ({title, season, episode} = await extractTitleSeasonEpisode("爱情公寓.ipartment.2009.S02E08.H.265.25fps.mkv"));
    assert(title === "爱情公寓" && season == 2 && episode == 8, `Expected title === "爱情公寓" && season == 2 && episode == 8, but got ${title} ${season} ${episode}`);

    ({title, season, episode} = await extractTitleSeasonEpisode("亲爱的X S02E08"));
    assert(title === "亲爱的X" && season == 2 && episode == 8, `Expected title === "亲爱的X" && season == 2 && episode == 8, but got ${title} ${season} ${episode}`);

    ({title, season, episode} = await extractTitleSeasonEpisode("宇宙Marry Me? S02E08"));
    assert(title === "宇宙Marry Me?" && season == 2 && episode == 8, `Expected title === "宇宙Marry Me?" && season == 2 && episode == 8, but got ${title} ${season} ${episode}`);
  });
test('综艺「第N期」文件名解析为节目名和期数，不误当作季度', async () => {
  let parsed = await extractTitleSeasonEpisode('奔跑吧第1期上 周深教孟子义唱歌');
  assert.equal(parsed.title, '奔跑吧');
  assert.equal(parsed.season, 0);
  assert.equal(parsed.episode, 1);

  parsed = await extractTitleSeasonEpisode('奔跑吧第9季第12期下 嘉宾挑战');
  assert.equal(parsed.title, '奔跑吧');
  assert.equal(parsed.season, 9);
  assert.equal(parsed.episode, 12);

  parsed = await extractTitleSeasonEpisode('种地吧 第十二期');
  assert.equal(parsed.title, '种地吧');
  assert.equal(parsed.season, 0);
  assert.equal(parsed.episode, 12);
});
test('综艺未标明季数时允许匹配平台返回的任意季标题', () => {
  const anime = { animeTitle: '奔跑吧第9季(2025)【综艺】', source: 'tencent' };
  assert.equal(matchSeason(anime, '奔跑吧', 0), true);
  assert.equal(matchSeason({ ...anime, animeTitle: '王牌对王牌第9季(2025)【综艺】' }, '奔跑吧', 0), false);
});
test('明确第三季候选不得匹配《指环王：力量之戒》第一季', () => {
  const queryTitle = '指环王：力量之戒';
  const wrongSeason = {
    animeTitle: '指环王：力量之戒 第三季(2026)【电视剧】 from renren',
    source: 'renren',
    aliases: [],
  };
  const firstSeason = {
    animeTitle: '指环王：力量之戒 第一季(2022)【电视剧】 from renren',
    source: 'renren',
    aliases: [],
  };

  assert.equal(matchSeason(wrongSeason, queryTitle, 1), false);
  assert.equal(matchSeason(firstSeason, queryTitle, 1), true);
  assert.equal(matchSeason(wrongSeason, queryTitle, 3), true);
});

test('season matching unifies traditional and simplified titles', () => {
  const queryTitle = '无职转生 ～到了异世界就拿出真本事～';

  // 繁体别名与简体查询词指向同一作品同一季时必须命中；季号不一致则不得命中
  assert.equal(matchSeason({ animeTitle: '無職轉生～到了異世界就拿出真本事～第三季', source: 'dandan' }, queryTitle, 3), true);
  assert.equal(matchSeason({ animeTitle: '無職轉生～到了異世界就拿出真本事～第3季', source: 'dandan' }, queryTitle, 3), true);
  assert.equal(matchSeason({ animeTitle: '無職轉生～到了異世界就拿出真本事～第三季', source: 'dandan' }, queryTitle, 2), false);

  // 季号标识插在主体名称中间时查询词不是标题前缀，不得命中
  assert.equal(matchSeason({ animeTitle: '无职转生Ⅲ ～到了异世界就拿出真本事～', source: 'dandan' }, queryTitle, 3), false);
  assert.equal(matchSeason({ animeTitle: '无职转生 第三季 ～到了异世界就拿出真本事～', source: 'dandan' }, queryTitle, 3), false);

  // 主体一致但无季号：仅第 1 季命中；有其它季号则不得命中
  assert.equal(matchSeason({ animeTitle: '無職轉生～到了異世界就拿出真本事～', source: 'dandan' }, queryTitle, 1), true);
  assert.equal(matchSeason({ animeTitle: '無職轉生～到了異世界就拿出真本事～', source: 'dandan' }, queryTitle, 3), false);
  assert.equal(matchSeason({ animeTitle: '無職轉生～到了異世界就拿出真本事 第二季', source: 'dandan' }, queryTitle, 3), false);

  // 归一化不得把不同作品视为同一作品
  assert.equal(normalizeTitleForMatch('无职英雄 技能什么的毫无用处').includes(normalizeTitleForMatch(queryTitle)), false);
  assert.equal(matchSeason({ animeTitle: '无职英雄 技能什么的毫无用处(2025)', source: 'dandan' }, queryTitle, 3), false);
});
test('generic favorite snapshot from a later season must not satisfy an S1 search', () => {
  Globals.init({ LOG_LEVEL: 'error', ENABLE_ANIME_EPISODE_FILTER: 'false', GROUP_MINUTE: '0', DANMU_LIMIT: '0', CONVERT_COLOR: 'default', BLOCKED_WORDS: '' });

  const thirdSeason = {
    animeId: 9303,
    bangumiId: '9303',
    animeTitle: '指环王：力量之戒 第三季(2026)【电视剧】 from renren',
    aliases: [],
    source: 'renren',
    episodeCount: 8,
    links: [{ id: '930301', title: 'E1【renren】', url: 'https://example.invalid/s3e1' }],
  };
  addFavorite('指环王：力量之戒', [thirdSeason], [thirdSeason]);
  const favorite = resolveFavoriteForSearchKeyword('指环王：力量之戒_S1');
  assert.ok(favorite, 'generic favorite is currently eligible for seasonal lookup');
  assert.equal(checkEpisodeSatisfied(favorite.entry.results, 1, 1, new Map([[9303, thirdSeason]]), null), false,
    'a generic favorite containing only S3 must be rejected for S1E1');
  removeFavorite('指环王：力量之戒');
});

test('episode satisfaction must not treat a later season E1 as the requested season E1', () => {
  Globals.init({ LOG_LEVEL: 'error', ENABLE_ANIME_EPISODE_FILTER: 'false', GROUP_MINUTE: '0', DANMU_LIMIT: '0', CONVERT_COLOR: 'default', BLOCKED_WORDS: '' });

  const buildSeason = (animeId, season) => ({
    animeId,
    bangumiId: String(animeId),
    animeTitle: `某多季剧 第${season}季(2026)【电视剧】from dandan`,
    aliases: [],
    source: 'dandan',
    startDate: '2026-01-01T00:00:00.000Z',
    episodeCount: 2,
    links: [
      { id: animeId * 10 + 1, title: '【测试源】第1集', url: `test-${animeId}-1` },
      { id: animeId * 10 + 2, title: '【测试源】第2集', url: `test-${animeId}-2` },
    ],
  });

  const firstSeason = buildSeason(9101, 1);
  const thirdSeason = buildSeason(9103, 3);
  const detailStore = new Map([[9101, firstSeason], [9103, thirdSeason]]);

  assert.equal(checkEpisodeSatisfied([thirdSeason], 1, 1, detailStore, null), false,
    'S3E1 must not satisfy an S1E1 search');
  assert.equal(checkEpisodeSatisfied([firstSeason], 1, 1, detailStore, null), true,
    'S1E1 should satisfy an S1E1 search');
  assert.equal(checkEpisodeSatisfied([thirdSeason], 3, 1, detailStore, null), true,
    'S3E1 should still satisfy an S3E1 search');
});

test('movie matching unifies traditional and simplified titles', async () => {
  Globals.init({ LOG_LEVEL: 'error' });

  const buildMovie = (animeId, animeTitle) => ({
    animeId,
    bangumiId: String(animeId),
    animeTitle,
    aliases: [],
    source: 'dandan',
    startDate: '2020-01-01T00:00:00.000Z',
    links: [{ id: animeId * 10 + 1, title: '【测试源】 正片', url: `test-${animeId}-1` }]
  });

  const traditional = buildMovie(3001, '某電影(2020)【电影】');
  const withColon = buildMovie(3002, '某电影：终章(2020)【电影】');
  const different = buildMovie(3003, '另一部电影(2020)【电影】');
  const sequel = buildMovie(3004, '某电影2(2020)【电影】');
  const detailStore = new Map([[3001, traditional], [3002, withColon], [3003, different], [3004, sequel]]);

  const matchMovie = async (animes, title) => {
    const result = await matchAniAndEp(null, null, null, { animes }, title, null, null, null, null, detailStore);
    return result.resAnime ? result.resAnime.animeId : null;
  };

  // 繁简与全半角/冒号写法差异不影响电影标题相等判定
  assert.equal(await matchMovie([traditional], '某电影'), 3001);
  assert.equal(await matchMovie([withColon], '某电影: 终章'), 3002);

  // 不同作品与续作编号仍视为不同作品
  assert.equal(await matchMovie([different], '某电影'), null);
  assert.equal(await matchMovie([sequel], '某电影'), null);
});
test('fallback matching prefers the candidate of the target season', async () => {
  Globals.init({ LOG_LEVEL: 'error' });

  const buildAnime = (animeId, animeTitle, aliases = []) => ({
    animeId,
    bangumiId: String(animeId),
    animeTitle,
    aliases,
    source: 'dandan',
    startDate: '2020-01-01T00:00:00.000Z',
    links: Array.from({ length: 12 }, (_, i) => ({ id: animeId * 100 + i + 1, title: `【测试源】 第${i + 1}话`, url: `test-${animeId}-${i + 1}` }))
  });

  const secondSeason = buildAnime(2001, '某测试动画 第二季(2023)【TV动画】from dandan');
  const thirdSeason = buildAnime(2002, '某测试动画 第三季(2026)【TV动画】from dandan');
  const thirdSeasonByAlias = buildAnime(2003, '某测试动画(2026)【TV动画】from dandan', ['某测试动画 第三季']);
  const detailStore = new Map([[2001, secondSeason], [2002, thirdSeason], [2003, thirdSeasonByAlias]]);

  const matchFallback = async (animes, season) => {
    const result = await fallbackMatchAniAndEp({ animes }, null, season, 12, null, '某测试动画', null, null, null, detailStore);
    return result.resAnime ? result.resAnime.animeId : null;
  };

  // 目标季优先于候选列表顺序
  assert.equal(await matchFallback([secondSeason, thirdSeason], 3), 2002);
  assert.equal(await matchFallback([thirdSeason, secondSeason], 3), 2002);
  assert.equal(await matchFallback([secondSeason, thirdSeason], 2), 2001);

  // 季号仅出现在别名中时同样参与优先判断
  assert.equal(await matchFallback([secondSeason, thirdSeasonByAlias], 3), 2003);

  // 无同季候选或未指定季号时保持原有取值顺序
  assert.equal(await matchFallback([secondSeason], 3), 2001);
  assert.equal(await matchFallback([secondSeason, thirdSeason], null), 2001);
});

test('episode-number deduplication prefers the requested platform', () => {
  const episodes = [
    { episodeId: 'imgo-1', episodeTitle: '【imgo】第1集 初遇' },
    { episodeId: 'qq-1', episodeTitle: '【qq】第1集 重逢' },
    { episodeId: 'qq-1-copy', episodeTitle: '【qq】第1集 重逢' },
    { episodeId: 'imgo-2', episodeTitle: '【imgo】第2集' }
  ];

  assert.deepEqual(
    filterSameEpisodeTitle(episodes).map(item => item.episodeId),
    ['imgo-1', 'imgo-2']
  );
  assert.deepEqual(
    filterSameEpisodeTitle(episodes, { preferredPlatform: 'qq' }).map(item => item.episodeId),
    ['qq-1', 'imgo-2']
  );
});

test('an unscoped alias cannot make an explicitly third-season candidate match S01', async () => {
  Globals.init({ REMEMBER_LAST_SELECT: 'true', LOG_LEVEL: 'error' });

  const buildThirdSeason = (animeId, animeTitle, aliases) => ({
    animeId,
    bangumiId: String(animeId),
    animeTitle,
    aliases,
    source: 'renren',
    type: 'tvseries',
    episodeCount: 12,
    links: Array.from({ length: 12 }, (_, index) => ({
      id: animeId * 100 + index + 1,
      title: `【renren】 第${String(index + 1).padStart(2, '0')}集`,
      url: `https://example.com/${animeId}/episode-${index + 1}`,
    })),
  });

  const thirdSeasonWithBaseAlias = buildThirdSeason(
    98732,
    '指环王：力量之戒 第三季(2026)【电视剧】 from renren',
    ['指环王：力量之戒']
  );
  const unscopedTitleWithThirdSeasonAlias = buildThirdSeason(
    98733,
    '指环王：力量之戒(2026)【电视剧】 from renren',
    ['指环王：力量之戒 第三季']
  );

  for (const candidate of [thirdSeasonWithBaseAlias, unscopedTitleWithThirdSeasonAlias]) {
    const result = await matchAniAndEp(
      1,
      1,
      null,
      { animes: [candidate], tmdbSeasonBoundaries: [{ order: 1, startEpisode: 1 }, { order: 2, startEpisode: 9 }, { order: 3, startEpisode: 17 }] },
      '指环王：力量之戒',
      new Request('http://localhost/api/v2/match'),
      null,
      String(candidate.animeId),
      null,
      new Map([[String(candidate.animeId), candidate]])
    );

    assert.equal(result.resAnime, null, `candidate ${candidate.animeId} must not match S01`);
    assert.equal(result.resEpisode, null);
  }

  Globals.init({ REMEMBER_LAST_SELECT: 'false', LOG_LEVEL: 'error' });
});

test('remembered preference must not override an explicitly different season', async () => {
  Globals.init({ REMEMBER_LAST_SELECT: 'true', LOG_LEVEL: 'error' });

  const thirdSeason = {
    animeId: 98731,
    bangumiId: '98731',
    animeTitle: '指环王：力量之戒 第三季(2026)【电视剧】 from renren',
    aliases: [],
    source: 'renren',
    type: 'tvseries',
    episodeCount: 1,
    links: [{ id: 987311, title: '【renren】 第01集', url: 'https://example.com/season3/episode1' }],
  };

  const result = await matchAniAndEp(
    1,
    1,
    null,
    { animes: [thirdSeason] },
    '指环王：力量之戒',
    new Request('http://localhost/api/v2/match'),
    null,
    '98731',
    null,
    new Map([['98731', thirdSeason]])
  );

  assert.equal(result.resAnime, null);
  assert.equal(result.resEpisode, null);
  Globals.init({ REMEMBER_LAST_SELECT: 'false', LOG_LEVEL: 'error' });
});

test('normal matching keeps the requested platform and exact episode', async () => {
  Globals.init({ REMEMBER_LAST_SELECT: 'false', LOG_LEVEL: 'error' });

  const anime = {
    animeId: 7781,
    bangumiId: '7781',
    animeTitle: '平台测试',
    source: '360',
    type: 'tvseries',
    episodeCount: 2,
    links: [
      { id: 11, title: '【imgo】 第1集', url: 'https://www.mgtv.com/b/test/1.html' },
      { id: 12, title: '【qq】 第1集', url: 'https://v.qq.com/x/cover/test/1.html' },
      { id: 13, title: '【qq】 第2集', url: 'https://v.qq.com/x/cover/test/2.html' }
    ]
  };

  const unrelated = {
    animeId: 7782,
    bangumiId: '7782',
    animeTitle: '别的番剧',
    source: '360',
    type: 'tvseries',
    episodeCount: 1,
    links: [{ id: 14, title: '【qq】 第1集', url: 'https://v.qq.com/x/cover/other/1.html' }],
  };

  const result = await matchAniAndEp(
    1,
    1,
    null,
    { animes: [unrelated, anime] },
    '平台测试',
    new Request('http://localhost/api/v2/match'),
    'qq',
    null,
    null,
    new Map([['7781', anime]])
  );

  assert.equal(result.resAnime?.animeId, 7781);
  assert.equal(result.resEpisode?.episodeId, 12);
  assert.equal(result.resEpisode?.episodeTitle, '【qq】 第1集');
  // 每个候选都带判定阶段，标题不符的候选同样列出
  assert.equal(result.candidates.length, 2);
  const scored = result.candidates.find(item => item.stage === '参与评分');
  assert.equal(scored.title, '平台测试');
  assert.equal(typeof scored.score, 'number');
  assert.equal(scored.score > 0, true, '命中偏好平台应为正分');
  assert.equal(scored.episodeTitle, '【qq】 第1集');
  const missed = result.candidates.find(item => item.title === '别的番剧');
  assert.equal(missed.stage, '标题未命中');
});

// 真实数据样本：腾讯《现在就出发 第4季》第5话，21 集里 11 集是「先导片」「加更」，过滤后剩 10 集正片
const episodeFilterSample = () => {
  const titles = [
    '第1期上：出发团变落汤鸡', '第1期下：目击狼人杀升级',
    '第2期上：腾腾公主飙戏', '第2期下：编瞎话大赏爆笑来袭',
    '第3期上：小白安宇笨狼合体', '第3期下：空降龙餐馆',
    '第4期上：现发KTV全员唱到发了狠', '第4期下：全员黑脸',
    '第5期上：沈腾踩着范丞丞起飞', '第5期下：沈腾满地滚',
    '先导片上：沈腾沙滩十八滚', '先导片下：贾冰爆炒沈腾',
    '第1期加更：王楚然猜词', '第1期还有加更：王安宇脑力下线',
    '第2期加更：沈腾胡先煦范丞丞', '第2期还有加更：沈腾陷入跳舞循环',
    '第3期加更：王安宇被打开心扉', '第3期还有加更：沈腾范丞丞炫酒瓶',
    '第4期加更：沈腾黄景瑜双簧帮唱', '第4期还有加更：白敬亭林一雷霆',
    '第5期加更：王楚然山东话表白',
  ];
  return {
    animeId: 6568352,
    bangumiId: 'mzc002001bk7moh',
    animeTitle: '现在就出发 第4季(2026)【综艺】',
    startDate: '2026-01-01T00:00:00Z',
    type: '综艺',
    typeDescription: '综艺',
    isFavorited: true,
    rating: 0,
    source: 'tencent',
    episodeCount: 21,
    links: titles.map((title, index) => ({ id: 41021 + index, title: `【qq】${title}`, url: `https://v.qq.com/x/cover/mzc002001bk7moh/ep${index + 1}.html` })),
  };
};

test('buildBangumiData 过滤开启时按过滤后的可用集数上报总集数', () => {
  Globals.init({ ENABLE_ANIME_EPISODE_FILTER: 'true', GROUP_MINUTE: '0', DANMU_LIMIT: '0', CONVERT_COLOR: 'default', BLOCKED_WORDS: '' });
  const result = buildBangumiData(episodeFilterSample());

  assert.equal(result.bangumi.episodes.length, 10, '过滤后只剩 10 集正片');
  assert.equal(result.bangumi.seasons[0].episodeCount, 10, '总集数应与实际返回的集数一致');
});

test('buildBangumiData 过滤关闭时保持平台声明的总集数', () => {
  Globals.init({ ENABLE_ANIME_EPISODE_FILTER: 'false', GROUP_MINUTE: '0', DANMU_LIMIT: '0', CONVERT_COLOR: 'default', BLOCKED_WORDS: '' });
  const result = buildBangumiData(episodeFilterSample());

  assert.equal(result.bangumi.episodes.length, 21, '未开启过滤时返回全部集数');
  assert.equal(result.bangumi.seasons[0].episodeCount, 21, '未开启过滤时保持平台声明值');
});

test('buildBangumiData 过滤开启时声明集数更小则以声明值为准', () => {
  Globals.init({ ENABLE_ANIME_EPISODE_FILTER: 'true', GROUP_MINUTE: '0', DANMU_LIMIT: '0', CONVERT_COLOR: 'default', BLOCKED_WORDS: '' });
  const anime = episodeFilterSample();
  anime.episodeCount = 1;
  anime.links = anime.links.slice(0, 3);
  const result = buildBangumiData(anime);

  assert.equal(result.bangumi.seasons[0].episodeCount, 1, '声明值更小时以声明值为准');
});

test('resolveEpisodeCount 取声明值与可用集数中的较小值', () => {
  assert.equal(resolveEpisodeCount(21, 10), 10);
  assert.equal(resolveEpisodeCount(21, 21), 21);
  assert.equal(resolveEpisodeCount(1, 3), 1);
  assert.equal(resolveEpisodeCount(0, 5), 5);
  assert.equal(resolveEpisodeCount(21, 0), 21);
});

test('applyEpisodeTitleFilter 过滤剧集并把可用集数写回动漫', () => {
  Globals.init({ ENABLE_ANIME_EPISODE_FILTER: 'true', GROUP_MINUTE: '0', DANMU_LIMIT: '0', CONVERT_COLOR: 'default', BLOCKED_WORDS: '' });
  const anime = episodeFilterSample();
  const episodes = applyEpisodeTitleFilter(anime, anime.links);

  assert.equal(episodes.length, 10, '过滤后只剩 10 集正片');
  assert.equal(anime.episodeCount, 10, '动漫的集数写回为过滤后的可用集数');
});

test('filterEpisodesByTitle 同时检查 episodeTitle 与 title，防止先导片伪装成正片集号', () => {
  Globals.init({ ENABLE_ANIME_EPISODE_FILTER: 'true', GROUP_MINUTE: '0', DANMU_LIMIT: '0', CONVERT_COLOR: 'default', BLOCKED_WORDS: '' });
  const episodes = [
    { episodeTitle: '第1期上：正片', title: '先导片上：正片预告' },
    { episodeTitle: '', title: '先导片下：先导内容' },
    { episodeTitle: '第1期下：正片', title: '第1期下：正片' },
  ];

  const filtered = filterEpisodesByTitle(episodes);
  assert.deepStrictEqual(filtered.map(ep => ep.episodeTitle), ['第1期下：正片']);
});

test('filterEpisodesByTitle 按集标题过滤剧集', () => {
  Globals.init({ ENABLE_ANIME_EPISODE_FILTER: 'true', GROUP_MINUTE: '0', DANMU_LIMIT: '0', CONVERT_COLOR: 'default', BLOCKED_WORDS: '' });
  const episodes = [{ episodeTitle: '第1期上：正片' }, { episodeTitle: '第1期加更：加更' }, { episodeTitle: '先导片上：先导' }];
  const filtered = filterEpisodesByTitle(episodes);

  assert.deepStrictEqual(filtered.map(ep => ep.episodeTitle), ['第1期上：正片'], '加更与先导片按集标题过滤规则被剔除');
});

test('withAvailableEpisodeCount 为缓存命中的动漫上报过滤后的可用集数', () => {
  Globals.init({ ENABLE_ANIME_EPISODE_FILTER: 'true', GROUP_MINUTE: '0', DANMU_LIMIT: '0', CONVERT_COLOR: 'default', BLOCKED_WORDS: '' });
  const anime = episodeFilterSample();
  const reported = withAvailableEpisodeCount([anime], () => ({ links: anime.links }));

  assert.strictEqual(reported.length, 1, '不改变动漫数量');
  assert.strictEqual(reported[0].episodeCount, 10, '缓存命中的动漫上报过滤后的可用集数');
  assert.strictEqual(anime.episodeCount, 21, '不改写缓存里的动漫对象');
});

test('withAvailableEpisodeCount 过滤关闭时保持平台声明的集数', () => {
  Globals.init({ ENABLE_ANIME_EPISODE_FILTER: 'false', GROUP_MINUTE: '0', DANMU_LIMIT: '0', CONVERT_COLOR: 'default', BLOCKED_WORDS: '' });
  const anime = episodeFilterSample();
  const reported = withAvailableEpisodeCount([anime], () => ({ links: anime.links }));

  assert.strictEqual(reported[0].episodeCount, 21, '过滤关闭时保持平台声明值');
});

test('withAvailableEpisodeCount 不改写搜索缓存里的动漫对象', () => {
  Globals.init({ ENABLE_ANIME_EPISODE_FILTER: 'true', GROUP_MINUTE: '0', DANMU_LIMIT: '0', CONVERT_COLOR: 'default', BLOCKED_WORDS: '' });
  const anime = episodeFilterSample();
  const detailsMap = new Map();
  setSearchCache('集过滤缓存用例', [anime], detailsMap);
  const cached = getSearchCache('集过滤缓存用例', detailsMap);
  assert.strictEqual(cached[0], anime, '搜索缓存返回的是缓存里的同一批对象');

  const reported = withAvailableEpisodeCount(cached, () => ({ links: anime.links }));

  assert.strictEqual(reported[0].episodeCount, 10, '上报的是过滤后的可用集数');
  assert.strictEqual(cached[0].episodeCount, 21, '缓存里的动漫对象不被改写');

  globals.searchCache.delete('集过滤缓存用例');
});

test('withAvailableEpisodeCount 返回的副本保留动漫的其余字段', () => {
  Globals.init({ ENABLE_ANIME_EPISODE_FILTER: 'true', GROUP_MINUTE: '0', DANMU_LIMIT: '0', CONVERT_COLOR: 'default', BLOCKED_WORDS: '' });
  const anime = episodeFilterSample();
  const reported = withAvailableEpisodeCount([anime], () => ({ links: anime.links }));

  assert.notStrictEqual(reported[0], anime, '返回的是副本而不是原对象');
  assert.strictEqual(reported[0].animeId, anime.animeId);
  assert.strictEqual(reported[0].animeTitle, anime.animeTitle);
  assert.strictEqual(reported[0].source, anime.source);
});

test('withAvailableEpisodeCount 不改写收藏缓存的持久化内容', () => {
  Globals.init({ ENABLE_ANIME_EPISODE_FILTER: 'true', GROUP_MINUTE: '0', DANMU_LIMIT: '0', CONVERT_COLOR: 'default', BLOCKED_WORDS: '' });
  const anime = episodeFilterSample();
  addFavorite('集过滤收藏用例', [anime], []);
  const persistedBefore = JSON.stringify(saveFavorites());

  withAvailableEpisodeCount([anime], () => ({ links: anime.links }));

  assert.strictEqual(JSON.stringify(saveFavorites()), persistedBefore, '收藏缓存的持久化内容不被改写');

  removeFavorite('集过滤收藏用例');
});

test('回填可用集数后匹配到的剧集与平台声明集数时一致', async () => {
  Globals.init({ ENABLE_ANIME_EPISODE_FILTER: 'true', LOG_LEVEL: 'error' });
  const buildAnime = (episodeCount) => ({
    animeId: 4001,
    bangumiId: '4001',
    animeTitle: '某测试剧集(2026)【TV动画】from dandan',
    aliases: [],
    source: 'dandan',
    type: 'TV动画',
    typeDescription: 'TV动画',
    episodeCount,
    startDate: '2026-01-01T00:00:00.000Z',
    links: Array.from({ length: 10 }, (_, i) => ({ id: 40010 + i, title: `【测试源】 第${i + 1}话`, url: `test-${i + 1}` }))
  });
  const matchWith = async (anime) => {
    const detailStore = new Map([[4001, anime]]);
    const result = await matchAniAndEp(1, 3, 2026, { animes: [anime] }, '某测试剧集', null, null, null, null, detailStore);
    return { animeId: result.resAnime?.animeId, episodeId: result.resEpisode?.episodeId };
  };

  const withDeclaredCount = await matchWith(buildAnime(21));
  const withAvailableCount = await matchWith(buildAnime(10));

  assert.equal(withDeclaredCount.episodeId, 40012, '声明集数为 21 时匹配到第 3 话');
  assert.deepStrictEqual(withAvailableCount, withDeclaredCount, '可用集数为 10 时匹配结果不变');
});

test('buildMatchScoring 选中项与同分候选并列时标注顺序优先', () => {
  const attempts = [{
    platform: 'qq',
    selected: true,
    candidates: [
      { title: '钢铁侠2(2010)【外语电影】from tencent', animeId: 1001, source: 'tencent', episodeTitle: '第1集', score: -99, stage: '参与评分', detail: '无平台偏好 +1、单集兜底 -100、合计 -99' },
      { title: '钢铁侠2(2010)【外语电影】from youku', animeId: 1002, source: 'youku', episodeTitle: '第1集', score: -99, stage: '参与评分', detail: '无平台偏好 +1、单集兜底 -100、合计 -99' },
    ],
  }];
  const { rows } = buildMatchScoring(attempts, { animeTitle: '钢铁侠2(2010)【外语电影】from tencent', animeId: 1001, source: 'tencent' });
  const selected = rows.find(row => row.结果 === '选中');
  assert.match(selected.结果说明, /同分候选并列，按候选顺序优先/, '同分并列时说明选中依据');
  assert.equal(selected.尝试.includes('qq'), true);
  // 未选中项不带并列说明
  assert.doesNotMatch(rows.find(row => row.结果 === '未选中').结果说明, /同分候选并列/);
});

test('buildMatchScoring 跨源同标题候选只标记实际选中的一条', () => {
  const attempts = [{
    platform: '默认',
    selected: true,
    candidates: [
      { title: '同名剧', animeId: 1, source: 'bilibili', episodeTitle: '第1集', score: 100, stage: '参与评分' },
      { title: '同名剧', animeId: 2, source: 'tencent', episodeTitle: '第1集', score: 100, stage: '参与评分' },
    ],
  }];
  const { rows } = buildMatchScoring(attempts, { animeTitle: '同名剧', animeId: 1, source: 'bilibili' });
  const selectedRows = rows.filter(row => row.结果 === '选中');
  assert.equal(selectedRows.length, 1, '同标题不同源的两条候选只能有一条被标为选中');
  assert.match(selectedRows[0].候选, /同名剧/);
});

test('buildMatchScoring 按轮次列出未评分候选与评分候选', () => {
  const attempts = [
    {
      platform: 'qq',
      candidates: [
        { title: '钢铁侠2', source: 'iqiyi', episodeTitle: '第1集', score: 1, stage: '参与评分' },
        { title: '钢铁侠2 普通话', source: 'iqiyi', stage: '无分集' },
        { title: '钢铁侠3', source: 'iqiyi', stage: '标题未命中' },
      ],
    },
    {
      platform: 'bilibili&animeko',
      selected: true,
      candidates: [
        { title: '钢铁侠2', animeId: 1003, source: 'iqiyi', episodeTitle: '第1集', score: 100, stage: '参与评分' },
        { title: '钢铁侠3', source: 'iqiyi', stage: '标题未命中' },
      ],
    },
  ];
  const { rows, counts } = buildMatchScoring(attempts, { animeTitle: '钢铁侠2', animeId: 1003, source: 'iqiyi' });
  // 每一轮尝试独立成行，同一候选在不同偏好组的重复参与可辨识
  const rejected = rows.filter(row => row.结果 === '标题未命中');
  assert.equal(rejected.length, 2);
  assert.deepEqual(rejected.map(row => row.尝试), ['第 1 轮 · qq', '第 2 轮 · bilibili、animeko']);
  assert.match(rejected[0].结果说明, /qq 偏好组下淘汰/);
  assert.equal(counts.标题未命中, 2);
  assert.equal(counts.无分集, 1);
  // 评分候选按轮次展开并按分数降序
  const scored = rows.filter(row => row.结果 === '选中' || row.结果 === '未选中');
  assert.equal(scored.length, 2);
  assert.equal(scored[0].尝试, '第 1 轮 · qq');
  assert.equal(scored[1].尝试, '第 2 轮 · bilibili、animeko');
  assert.equal(scored.filter(row => row.结果 === '选中').length, 1, '只有实际命中的偏好组标记选中');
  assert.equal(scored.find(row => row.结果 === '选中').尝试, '第 2 轮 · bilibili、animeko');
});

test('matchAniAndEp 电影模式记录平台不匹配的候选', async () => {
  Globals.init({ REMEMBER_LAST_SELECT: 'false', LOG_LEVEL: 'error' });

  const anime = {
    animeId: 8848,
    bangumiId: '8848',
    animeTitle: '平台测试电影',
    source: 'youku',
    type: 'movie',
    episodeCount: 1,
    links: [{ id: 21, title: '【youku】 正片', url: 'https://v.youku.com/x/other/1.html' }],
  };

  const result = await matchAniAndEp(
    null, null, null,
    { animes: [anime] },
    '平台测试电影',
    new Request('http://localhost/api/v2/match'),
    'qq',
    null, null,
    new Map([['8848', anime]]),
  );

  // 资源挂在 youku，偏好组 qq 下无可用集：候选带阶段出现而不是消失
  assert.equal(result.resAnime, null);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].stage, '资源平台不匹配偏好组');
  assert.equal(result.candidates[0].detail, 'qq');
});

test('matchAniAndEp 剧集模式记录无匹配集数的候选', async () => {
  Globals.init({ REMEMBER_LAST_SELECT: 'false', LOG_LEVEL: 'error' });

  const anime = {
    animeId: 9900,
    bangumiId: '9900',
    animeTitle: '集数测试',
    source: '360',
    type: 'tvseries',
    episodeCount: 2,
    links: [
      { id: 31, title: '【imgo】 第1集', url: 'https://www.mgtv.com/x/test/1.html' },
      { id: 32, title: '【imgo】 第2集', url: 'https://www.mgtv.com/x/test/2.html' },
    ],
  };

  const result = await matchAniAndEp(
    1, 9, null,
    { animes: [anime] },
    '集数测试',
    new Request('http://localhost/api/v2/match'),
    null,
    null, null,
    new Map([['9900', anime]]),
  );

  assert.equal(result.resAnime, null);
  const candidate = result.candidates.find(item => item.stage === '无匹配集数');
  assert.ok(candidate, '无匹配集数的候选应带阶段出现');
  assert.equal(candidate.detail, '');
});


test('segment comment cache keys isolate full comments, platforms, and time ranges', () => {
  const base = { type: 'dandan', url: 'episode-123', segment_start: 0, segment_end: 60 };
  const sameRange = resolveSegmentCommentCacheKey({ ...base });
  const nextRange = resolveSegmentCommentCacheKey({ ...base, segment_start: 60, segment_end: 120 });
  const otherPlatform = resolveSegmentCommentCacheKey({ ...base, type: 'animeko' });
  const noRange = resolveSegmentCommentCacheKey({ type: 'dandan', url: 'episode-123' });

  assert.equal(resolveSegmentCommentCacheKey({ ...base }), sameRange, '相同分段应稳定命中同一缓存键');
  assert.notEqual(sameRange, nextRange, '不同时间范围不能共用缓存');
  assert.notEqual(sameRange, otherPlatform, '不同平台不能共用分段缓存');
  assert.notEqual(sameRange, noRange, '缺少范围的请求不能误命中有范围的缓存');
  assert.notEqual(sameRange, base.url, '分段缓存必须与普通整集 URL 缓存隔离');
});

test('文件名中括号包裹的 Pure/Plus/Special/Live 版本标记可正确识别', async () => {
  const cases = [
    ['Natural.High.S04E03.(Pure).2026.1080p.WEB-DL.H265', 'pure'],
    ['Natural.High.S04E03.(Plus).2026.1080p.WEB-DL.H265', 'plus'],
    ['Natural.High.S04E03.(Special).2026.1080p.WEB-DL.H265', 'special'],
    ['Natural.High.S04E03.(Live).2026.1080p.WEB-DL.H265', 'live'],
    ['自然高光 第3期（加更版）2026 1080p', 'plus'],
  ];
  for (const [filename, edition] of cases) {
    const parsed = await extractTitleSeasonEpisode(filename);
    assert.equal(parsed.edition, edition, filename);
  }
});
