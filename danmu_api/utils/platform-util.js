import { simplized } from './zh-util.js';

export function platformTitleKey(title) {
  return simplized(String(title || '').normalize('NFKC')).trim().replace(/\s+/g, ' ').toLowerCase();
}

const sourceAliases = new Map([
  ['tencent', 'qq'],
  ['腾讯', 'qq'],
  ['腾讯视频', 'qq'],
  ['qq视频', 'qq'],
  ['iqiyi', 'qiyi'],
  ['爱奇艺', 'qiyi'],
  ['奇艺', 'qiyi'],
  ['bilibili', 'bilibili1'],
  ['哔哩哔哩', 'bilibili1'],
  ['哔哩', 'bilibili1'],
  ['b站', 'bilibili1'],
  ['优酷视频', 'youku'],
  ['优酷', 'youku'],
  ['芒果tv', 'imgo'],
  ['芒果视频', 'imgo'],
  ['咪咕视频', 'migu'],
  ['搜狐视频', 'sohu'],
  ['乐视视频', 'leshi'],
  ['西瓜视频', 'xigua'],
  ['抖音', 'xigua'],
  ['埋堆堆', 'maiduidui'],
  ['爱壹帆', 'aiyifan']
]);

export function platformKey(source) {
  const key = source.trim().toLowerCase();
  return sourceAliases.get(key) || key;
}

export function normalizePlatformGroup(value, allowedPlatforms) {
  if (typeof value !== 'string' || !value) return '';
  const parts = value.split(/[&＆]/).map(platformKey);
  return parts.every(part => allowedPlatforms.includes(part)) ? [...new Set(parts)].join('&') : '';
}
