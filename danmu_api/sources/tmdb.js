import BaseSource from './base.js';
import { log } from "../utils/log-util.js";
import { getDoubanInfoByImdbId } from "../utils/douban-util.js";
import { getTmdbExternalIds, searchTmdbTitles} from "../utils/tmdb-util.js";
import { getImdbepisodes, getImdbSeasons } from "../utils/imdb-util.js";
import { normalizeTitleForMatch } from "../utils/common-util.js";

// =====================
// 获取TMDB源播放链接
// =====================
export default class TmdbSource extends BaseSource {
  constructor(doubanSource) {
    super('BaseSource');
    this.doubanSource = doubanSource;
  }

  async _getDoubanInfo(finalImdbId, mediaType, doubanIds) {
    if (!finalImdbId) return;
    const doubanInfo = await getDoubanInfoByImdbId(finalImdbId);
    if (!doubanInfo || !doubanInfo?.data) return;
    const url = doubanInfo?.data?.id; // "https://api.douban.com/movie/1299131"
    if (url) {
      const parts = url.split("/"); // ["https:", "", "api.douban.com", "movie", "1299131"]
      const doubanId = parts.pop(); // 最后一个就是 ID
      const typeName = mediaType === 'movie' ? '电影' : '电视剧';
      if (doubanId) {
        doubanIds.push({
          layout: "subject", target_id: doubanId, type_name: typeName,
          target: {cover_url: doubanInfo.data?.image, title: doubanInfo.data?.alt_title}
        });
      }
    }
  }

  async getDoubanIdByTmdbId(mediaType, tmdbId) {
    try {
      const doubanIds = [];

      const response = await getTmdbExternalIds(mediaType, tmdbId);

      const imdbId = response.data?.imdb_id;

      if (!imdbId) return [];

      if (mediaType === 'movie') {
        await this._getDoubanInfo(imdbId, mediaType, doubanIds);
      } else {
        const seasons = await getImdbSeasons(imdbId);
        log("info", "[tmdb] imdb seasons:", seasons.data.seasons);

        const seasonPromises = (seasons?.data?.seasons ?? []).map(async (season) => {
          let finalImdbId = imdbId;
          log("info", "[tmdb] imdb season:", season.season);

          try {
            if (Number(season.season) !== 1) {
              const episodes = await getImdbepisodes(imdbId, season.season);
              finalImdbId = episodes.data?.episodes.find((ep) => ep.episodeNumber === 1)?.id ?? "";
            }

            await this._getDoubanInfo(finalImdbId, mediaType, doubanIds);
          } catch (error) {
            log("error", `[tmdb] 处理第 ${season.season} 季失败，继续执行其他季:`, error);
          }
        });

        await Promise.all(seasonPromises);
      }

      return doubanIds;
    } catch (error) {
      log("error", "[tmdb] getTmdbIds error:", {
        message: error.message,
        name: error.name,
        stack: error.stack,
      });
      return [];
    }
  }

  async search(keyword) {
    try {
      const response = await searchTmdbTitles(keyword);

      const data = response.data;

      let tmpAnimes = [];

      // 同时匹配 TMDB 的本地化标题与原始标题。欧美影片常见情况是：
      // Yamby/文件名使用英文原名，而 TMDB zh-CN 搜索返回中文译名；
      // 旧逻辑只比较 name/title，导致这些影片在进入豆瓣与平台匹配前被全部过滤。
      const normalizeQuery = value => normalizeTitleForMatch(
        String(value || '').replace(/[（(](?:19|20)\\d{2}[)）]$/, '').trim()
      ).toLowerCase();
      const queryKey = normalizeQuery(keyword);
      let tmdbItems = [];
      if (queryKey && data?.results?.length > 0) {
        tmdbItems = data.results.filter(item => {
          const localizedTitle = item.name || item.title || '';
          const originalTitle = item.original_name || item.original_title || '';
          return [localizedTitle, originalTitle].some(title => {
            const titleKey = normalizeQuery(title);
            return titleKey && titleKey === queryKey;
          });
        });
      }

      log("info", `[tmdb] tmdb items.length: ${tmdbItems.length} (localized/original exact title match)`);

      const doubanPromises = tmdbItems.map(async (tmdbItem) => {
        try {
          const mediaType = tmdbItem.media_type || (tmdbItem.name ? 'tv' : 'movie');
          const doubanIds = await this.getDoubanIdByTmdbId(mediaType, tmdbItem.id);
          // DoubanSource 会再次按 queryTitle 过滤候选。这里保留已经由 TMDB 原名/译名
          // 精确确认的检索词作为候选标题，避免英文原名被豆瓣中文译名二次过滤。
          return doubanIds.map(item => ({
            ...item,
            target: { ...(item.target || {}), title: keyword }
          }));
        } catch (error) {
          log("error", `[tmdb] 获取 TMDB ID ${tmdbItem.id} 的豆瓣 ID 失败，继续处理其他条目:`, error);
          return []; // 失败返回空数组，不中断合并
        }
      });

      const doubanResults = await Promise.all(doubanPromises);
      tmpAnimes = [...tmpAnimes, ...doubanResults.flat()];

      return tmpAnimes;
    } catch (error) {
      log("error", "[tmdb] getTmdbAnimes error:", {
        message: error.message,
        name: error.name,
        stack: error.stack,
      });
      return [];
    }
  }

  async getEpisodes(id) {}

  /**
   * 转发搜索结果处理至豆瓣源
   * @param {Array} sourceAnimes 原始数据
   * @param {string} queryTitle 关键词
   * @param {Array} curAnimes 结果池
   * @param {Map|null} detailStore 详情缓存
   * @param {number|null} querySeason 目标季度
   */
  async handleAnimes(sourceAnimes, queryTitle, curAnimes, detailStore = null, querySeason = null) {
    return this.doubanSource.handleAnimes(sourceAnimes, queryTitle, curAnimes, detailStore, querySeason);
  }

  async getEpisodeDanmu(id) {}

  formatComments(comments) {}
}
