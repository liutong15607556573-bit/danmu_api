import BaseSource from './base.js';
import { globals } from '../configs/globals.js';
import { log } from '../utils/log-util.js';
import { httpGet, httpPost } from '../utils/http-util.js';
import { addAnime, removeEarliestAnime } from '../utils/cache-util.js';
import { convertToAsciiSum } from '../utils/codec-util.js';
import { generateValidStartDate } from '../utils/time-util.js';
import { titleMatches, extractYear } from '../utils/common-util.js';

// AcFun 用户投稿视频弹幕源。AcFun 不是专门的海外电影库，
// 这里只收录可搜索到且确实带有弹幕的长视频，避免把普通短剪辑混入电影结果。
export default class AcFunSource extends BaseSource {
  constructor() {
    super();
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Referer': 'https://www.acfun.cn/',
      'Origin': 'https://www.acfun.cn'
    };
  }

  _durationSeconds(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parts = String(value || '').split(':').map(Number);
    if (!parts.length || parts.some(n => !Number.isFinite(n))) return 0;
    return parts.reduce((total, part) => total * 60 + part, 0);
  }

  async search(keyword) {
    try {
      const url = `https://www.acfun.cn/rest/pc-direct/search/video?keyword=${encodeURIComponent(keyword)}&page=1&pageSize=30&sortType=0`;
      const response = await httpGet(url, { headers: this.headers, retries: 1 });
      const data = typeof response?.data === 'string' ? JSON.parse(response.data) : response?.data;
      if (!data || data.result !== 0 || !Array.isArray(data.videoList)) return [];

      const results = data.videoList.map(item => {
        const title = String(item.title || item.emTitle || '').replace(/<[^>]*>/g, '').trim();
        const durationSeconds = this._durationSeconds(item.playDuration);
        // ctime 是 AcFun 投稿时间，不是电影上映年份；只从标题显式提取年份，避免错配。 
        const year = extractYear(title);
        return {
          provider: 'acfun',
          mediaId: String(item.videoId || ''),
          contentId: String(item.contentId || item.id || ''),
          title,
          year: year && year >= 1900 && year <= 2100 ? year : null,
          imageUrl: item.coverUrl || null,
          durationSeconds,
          danmuCount: Number(item.danmuCount || 0)
        };
      }).filter(item =>
        item.mediaId &&
        item.title &&
        item.durationSeconds >= 1200 &&
        item.danmuCount > 0
      );

      log('info', `[acfun] 搜索“${keyword}”返回 ${results.length} 条带弹幕长视频`);
      return results;
    } catch (error) {
      log('error', '[acfun] 搜索失败:', error.message);
      return [];
    }
  }

  async getEpisodes(id) {
    return [{ url: String(id), title: '正片' }];
  }

  async handleAnimes(sourceAnimes, queryTitle, curAnimes, detailStore = null, querySeason = null) {
    if (!Array.isArray(sourceAnimes)) return [];
    const matched = sourceAnimes.filter(item =>
      item && item.mediaId && titleMatches(item.title, queryTitle, querySeason)
    );
    const created = [];

    for (const item of matched) {
      const animeId = convertToAsciiSum(item.mediaId);
      const links = [{
        name: '正片',
        url: String(item.mediaId),
        title: `【AcFun】${item.title}`
      }];
      const anime = {
        animeId,
        bangumiId: String(item.contentId || item.mediaId),
        animeTitle: `${item.title}${item.year ? `(${item.year})` : ''}【电影】from acfun`,
        type: '电影',
        typeDescription: '电影',
        imageUrl: item.imageUrl,
        startDate: generateValidStartDate(item.year),
        episodeCount: 1,
        rating: 0,
        isFavorited: true,
        source: 'acfun'
      };
      created.push(anime);
      addAnime({ ...anime, links }, detailStore);
      if (globals.animes.length > globals.MAX_ANIMES) removeEarliestAnime();
    }

    this.sortAndPushAnimesByYear(created, curAnimes);
    return created;
  }

  async getEpisodeDanmu(id) {
    const all = [];
    let cursor = '1';
    const seen = new Set();

    // 分页有上限，防止异常游标或上游数据导致无限请求。
    for (let page = 0; page < 50 && cursor && cursor !== 'no_more' && !seen.has(cursor); page++) {
      seen.add(cursor);
      try {
        const body = new URLSearchParams({
          resourceId: String(id),
          resourceType: '9',
          enableAdvanced: 'true',
          pcursor: cursor,
          count: '200',
          sortType: '1',
          asc: 'false'
        }).toString();
        const response = await httpPost('https://www.acfun.cn/rest/pc-direct/new-danmaku/list', body, {
          headers: { ...this.headers, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
          retries: 1
        });
        const data = typeof response?.data === 'string' ? JSON.parse(response.data) : response?.data;
        if (!data || data.result !== 0 || !Array.isArray(data.danmakus)) break;
        all.push(...data.danmakus);
        const next = String(data.pcursor || 'no_more');
        if (next === cursor) break;
        cursor = next;
        if (data.danmakus.length === 0) break;
      } catch (error) {
        log('error', `[acfun] 获取弹幕失败 (videoId=${id}):`, error.message);
        break;
      }
    }

    log('info', `[acfun] videoId=${id} 获取到 ${all.length} 条原始弹幕`);
    return all;
  }

  formatComments(comments) {
    if (!Array.isArray(comments)) return [];
    return comments
      .filter(item => item && typeof item.body === 'string' && item.body.trim() && Number.isFinite(Number(item.position)))
      .map(item => ({
        timepoint: (Number(item.position) / 1000).toFixed(2),
        ct: Number(item.mode) || 1,
        color: Number(item.color) || 16777215,
        content: item.body.trim()
      }));
  }

  async getEpisodeDanmuSegments() {
    return null;
  }

  async getEpisodeSegmentDanmu() {
    return [];
  }
}
