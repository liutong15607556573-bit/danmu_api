import BaseSource from './base.js';
import { globals } from '../configs/globals.js';
import { log } from '../utils/log-util.js';
import { httpGet } from '../utils/http-util.js';
import { convertToAsciiSum } from '../utils/codec-util.js';
import { generateValidStartDate } from '../utils/time-util.js';
import { addAnime, removeEarliestAnime } from '../utils/cache-util.js';
import { titleMatches, getExplicitSeasonNumber, extractSeasonNumberFromAnimeTitle } from '../utils/common-util.js';

const SITE = 'https://www.4kvm.net';
const DANMU_HOST = 'https://4k.dmservce.org';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';

function decodeHtml(value = '') {
  return String(value).replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function stripTags(value = '') {
  return decodeHtml(String(value).replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}
function attr(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = html.match(new RegExp('\\b' + escaped + '\\s*=\\s*["\\']([^"\\']*)["\\']', 'i'));
  return m ? decodeHtml(m[1]) : '';
}

export function parse4kSearchResults(html = '') {
  const results = [];
  const matches = [...String(html).matchAll(/<a\b[^>]*href=["']\/play\/([A-Za-z0-9]+)["'][^>]*data-vod=["'][^"']*["'][^>]*>[\s\S]*?(?=<a\b[^>]*href=["']\/play\/|$)/gi)];
  for (const match of matches) {
    const block = match[0];
    const slug = match[1];
    const title = stripTags(block.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1] || attr(block, 'alt'));
    if (!slug || !title || results.some(item => item.slug === slug)) continue;
    const image = attr(block, 'data-src') || attr(block, 'src');
    const year = Number((block.match(/(?:19|20)\d{2}/) || [])[0]) || null;
    results.push({ slug, title: title.replace(/\s*[-–]\s*第\s*\d+\s*集.*$/, '').trim(), imageUrl: image || null, year });
  }
  return results;
}

export function parse4kEpisodes(html = '', detailSlug = '') {
  const source = String(html);
  const pattern = /<a\b[^>]*href=["']\/play\/([A-Za-z0-9]+)["'][^>]*data-line=["'](\d+)["'][^>]*data-episode=["'](\d+)["'][^>]*dataid=["'](\d+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const episodes = [];
  for (const m of source.matchAll(pattern)) {
    const slug = m[1];
    const number = Number(m[3]);
    const title = stripTags(m[5]) || `第${number}集`;
    if (!slug || !Number.isFinite(number) || episodes.some(ep => ep.slug === slug)) continue;
    episodes.push({ slug, number, title, line: Number(m[2]), playId: m[4] });
  }
  // 某些单集详情页本身就是播放页；没有选集锚点时保留当前页作为一集。
  if (!episodes.length && detailSlug) episodes.push({ slug: detailSlug, number: 1, title: '正片', line: 1, playId: '' });
  return episodes.sort((a, b) => a.number - b.number);
}

export function parse4kPlayerMetadata(html = '') {
  const source = String(html);
  const player = source.match(/<[^>]*data-danmaku-api-url=["']([^"']+)["'][^>]*data-danmaku-enabled=["']true["'][^>]*>/i)
    || source.match(/<[^>]*data-danmaku-enabled=["']true["'][^>]*data-danmaku-api-url=["']([^"']+)["'][^>]*>/i);
  const videoId = source.match(/id=["']player-error-message-detail["'][^>]*data-v-id=["'](\d+)["']/i)
    || source.match(/data-v-id=["'](\d+)["'][^>]*id=["']player-error-message-detail["']/i);
  const manager = source.match(/x-data=["']episodeManager\(\s*\d+\s*,\s*(\d+)\s*,/i);
  const apiUrl = player ? decodeHtml(player[1]) : '';
  const id = videoId ? videoId[1] : '';
  const episode = manager ? Number(manager[1]) : null;
  if (!apiUrl || !id || !Number.isInteger(episode) || episode < 1) return null;
  try {
    const parsed = new URL(apiUrl, SITE);
    if (!['4k.dmservce.org'].includes(parsed.hostname)) return null;
    return { apiRoot: parsed.toString().replace(/\/$/, ''), videoId: id, episode };
  } catch {
    return null;
  }
}

export default class FourKSource extends BaseSource {
  constructor() {
    super();
    this.inflight = new Map();
  }

  async requestText(url) {
    const target = globals.makeProxyUrl ? globals.makeProxyUrl(url) : url;
    const response = await httpGet(target, {
      timeout: 9000,
      retries: 0,
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8' }
    });
    if (typeof response.data !== 'string') {
      if (response.data && typeof response.data === 'object') return response.data;
      throw new Error('4K影视返回了非文本响应');
    }
    return response.data;
  }

  async search(keyword) {
    try {
      const url = `${SITE}/search?q=${encodeURIComponent(keyword)}`;
      const html = await this.requestText(url);
      if (typeof html !== 'string') return [];
      return parse4kSearchResults(html).map(item => ({
        provider: '4k', mediaId: item.slug, title: item.title,
        type: '影视', year: item.year, imageUrl: item.imageUrl, episodeCount: 0
      }));
    } catch (error) {
      log('warn', `[4k] 搜索失败: ${error.message}`);
      return [];
    }
  }

  async getEpisodes(id) {
    try {
      const html = await this.requestText(`${SITE}/play/${encodeURIComponent(id)}`);
      if (typeof html !== 'string') return [];
      return parse4kEpisodes(html, id).map(ep => ({
        vid: ep.slug, id: ep.slug, title: ep.title,
        link: `${SITE}/play/${ep.slug}`
      }));
    } catch (error) {
      log('warn', `[4k] 选集获取失败: ${error.message}`);
      return [];
    }
  }

  async handleAnimes(sourceAnimes, queryTitle, curAnimes, detailStore = null, querySeason = null) {
    if (!Array.isArray(sourceAnimes)) return [];
    let filtered = sourceAnimes.filter(item => titleMatches(item.title, queryTitle, querySeason));
    const season = querySeason ?? getExplicitSeasonNumber(queryTitle);
    if (season !== null) {
      const matched = filtered.filter(item => {
        const current = extractSeasonNumberFromAnimeTitle(item.title).season;
        return current === season || (season === 1 && current === null);
      });
      if (matched.length) filtered = matched;
    }
    const created = [];
    await Promise.all(filtered.map(async item => {
      try {
        const episodes = await this.getEpisodes(item.mediaId);
        if (!episodes.length) return;
        const links = episodes.map(ep => ({ name: ep.title, url: ep.link, title: `【4K影视】${ep.title}` }));
        const anime = {
          animeId: convertToAsciiSum(item.mediaId),
          bangumiId: item.mediaId,
          animeTitle: `${item.title}(${item.year || 'N/A'})【${item.type || '影视'}】from 4k`,
          type: item.type || '影视', typeDescription: item.type || '影视',
          imageUrl: item.imageUrl || '', startDate: item.year ? generateValidStartDate(item.year) : '',
          episodeCount: links.length, rating: 0, isFavorited: true, source: '4k'
        };
        created.push(anime);
        addAnime({ ...anime, links }, detailStore);
        if (globals.animes.length > globals.MAX_ANIMES) removeEarliestAnime();
      } catch (error) {
        log('warn', `[4k] 处理 ${item.title} 失败: ${error.message}`);
      }
    }));
    this.sortAndPushAnimesByYear(created, curAnimes);
    return created;
  }

  async getEpisodeDanmu(id) {
    if (this.inflight.has(id)) return this.inflight.get(id);
    const task = (async () => {
      try {
        const html = await this.requestText(id);
        if (typeof html !== 'string') return [];
        const meta = parse4kPlayerMetadata(html);
        if (!meta) {
          log('info', '[4k] 播放页未提供有效的弹幕编号');
          return [];
        }
        const endpoint = `${meta.apiRoot}/video/${meta.videoId}.${meta.episode}`;
        const target = globals.makeProxyUrl ? globals.makeProxyUrl(endpoint) : endpoint;
        const response = await httpGet(target, {
          timeout: 9000, retries: 0,
          headers: { 'User-Agent': UA, 'Accept': 'application/json,*/*' }
        });
        const payload = response.data;
        if (!payload || payload.code !== 0 || !Array.isArray(payload.data)) return [];
        return payload.data.filter(item => item && typeof item.content === 'string' && Number.isFinite(Number(item.time)))
          .map(item => ({
            timepoint: Number(item.time),
            ct: Number.isFinite(Number(item.mode)) ? Number(item.mode) : 1,
            color: parseInt(String(item.color || '#FFFFFF').replace('#', ''), 16) || 16777215,
            content: item.content
          }));
      } catch (error) {
        log('warn', `[4k] 弹幕获取失败: ${error.message}`);
        return [];
      }
    })();
    this.inflight.set(id, task);
    try { return await task; } finally { this.inflight.delete(id); }
  }

  async getEpisodeDanmuSegments(id) {
    return { type: '4k', duration: 0, segmentList: [{ type: '4k', segment_start: 0, segment_end: 30000, url: id }] };
  }

  async getEpisodeSegmentDanmu(segment) {
    return segment?.url ? this.getEpisodeDanmu(segment.url) : [];
  }

  formatComments(comments) { return comments; }
}
