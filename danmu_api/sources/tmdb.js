import BaseSource from './base.js';
import { log } from "../utils/log-util.js";
import { getDoubanInfoByImdbId } from "../utils/douban-util.js";
import { getTmdbExternalIds, getTmdbAlternativeTitles, searchTmdbTitles} from "../utils/tmdb-util.js";
import { getImdbepisodes, getImdbSeasons } from "../utils/imdb-util.js";
import { normalizeTitleForMatch } from "../utils/common-util.js";
import { isNonChinese } from "../utils/zh-util.js";

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
      const normalizeQuery = value => normalizeTitleForMatch(
        String(value || '').replace(/[（(](?:19|20)\\d{2}[)）]$/, '').trim()
      ).toLowerCase();
      const queryKey = normalizeQuery(keyword);
      if (!queryKey) return [];

      // 保留原有 zh-CN 搜索，同时为英文文件名补充 en-US 搜索。
      // 两种语言结果合并去重，避免只因 TMDB 本地化标题不同而漏片。
      const searches = [searchTmdbTitles(keyword)];
      if (isNonChinese(keyword)) {
        searches.push(searchTmdbTitles(keyword, "multi", { language: "en-US", maxPages: 2 }));
      }
      const responses = await Promise.all(searches);
      const resultMap = new Map();
      for (const response of responses) {
        const data = typeof response?.data === "string" ? JSON.parse(response.data) : response?.data;
        for (const item of data?.results || []) {
          if (!['movie', 'tv'].includes(item.media_type)) continue;
          resultMap.set(`${item.media_type}:${item.id}`, item);
        }
      }

      const candidates = [...resultMap.values()];
      const requestedYear = String(keyword).match(/[（(]?((?:19|20)\\d{2})[)）]?\\s*$/)?.[1] || "";
      const yearMatches = item => {
        if (!requestedYear) return true;
        const date = item.release_date || item.first_air_date || "";
        const resultYear = date.slice(0, 4);
        return !resultYear || resultYear === requestedYear;
      };
      const hasTitle = (item, values) => {
        const titles = [
          item.name, item.title, item.original_name, item.original_title,
          ...values
        ];
        return titles.some(title => {
          const titleKey = normalizeQuery(title);
          return titleKey && titleKey === queryKey;
        });
      };

      // 先用主标题/原名快速精确匹配；未命中的候选再核对 TMDB 地区别名。
      // 别名核验限制在搜索排名靠前的候选，避免无节制增加外部请求。
      const directMatches = candidates.filter(item => yearMatches(item) && hasTitle(item, []));
      const directIds = new Set(directMatches.map(item => `${item.media_type}:${item.id}`));
      const aliasCandidates = candidates
        .filter(item => !directIds.has(`${item.media_type}:${item.id}`) && yearMatches(item))
        .slice(0, 12);
      const aliasMatches = await Promise.all(aliasCandidates.map(async item => {
        try {
          const response = await getTmdbAlternativeTitles(item.media_type, item.id);
          const data = response?.data;
          const entries = data?.results || data?.titles || [];
          const aliases = entries.map(entry => entry.title || entry.name || "").filter(Boolean);
          return hasTitle(item, aliases) ? item : null;
        } catch (error) {
          log("warn", `[tmdb] 查询候选 ${item.id} 地区别名失败: ${error.message}`);
          return null;
        }
      }));
      const tmdbItems = [...directMatches, ...aliasMatches.filter(Boolean)];

      log("info", `[tmdb] TMDB候选 ${candidates.length} 条，主标题命中 ${directMatches.length} 条，地区别名命中 ${aliasMatches.filter(Boolean).length} 条`);

      const doubanPromises = tmdbItems.map(async (tmdbItem) => {
        try {
          const mediaType = tmdbItem.media_type;
          const doubanIds = await this.getDoubanIdByTmdbId(mediaType, tmdbItem.id);
          // 已由 TMDB 标题/地区别名精确确认，保留原检索词避免豆瓣中文译名二次过滤。
          return doubanIds.map(item => ({
            ...item,
            target: { ...(item.target || {}), title: keyword }
          }));
        } catch (error) {
          log("error", `[tmdb] 获取 TMDB ID ${tmdbItem.id} 的豆瓣 ID 失败，继续处理其他条目:`, error);
          return [];
        }
      });

      const doubanResults = await Promise.all(doubanPromises);
      return doubanResults.flat();
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
