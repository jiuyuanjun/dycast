/**
 * 输入归一化：用户输入（房间号 / 直播间直链 / 分享短链）→ 统一解析结果。
 *
 * 全软件只有一个入口 `resolveRoomInput()`：
 *  - 首页输入框、最近进入、分享文案、房间搜索页等所有入口都走这里；
 *  - 统一产出 webRid（房间号形态）+ anchorId（主播维度接口参数）+ 输入类型判定；
 *  - 短链解析复用 Rust 侧（short_link.rs / resolveShortUrlRust），桌面 UA 跟随重定向更稳。
 *
 * 语义约定：
 *  - webRid：live.douyin.com/{webRid} 路径中的短房间号（8~20 位），连接/HTML 抓取用；
 *  - anchorId：直播间链接 query 中的 anchor_id，ranklist 等主播维度接口参数，无则空串。
 */

import { extractDouyinUrlFromText } from '@/utils/verifyUtil';

export type RoomInputType = 'roomNum' | 'liveUrl' | 'shareText' | 'invalid';

export interface ResolvedRoom {
  /** 归一化后的干净链接（链接类输入存在；房间号输入为空） */
  url?: string;
  /** 输入类型：纯房间号 / 直播间直链 / 分享短链 / 无法识别 */
  type: RoomInputType;
  /** webRid（房间号形态）。短链/复杂直链可能需要网络解析后才得到，未解析时为空 */
  webRid: string;
  /** 直播间链接中的 anchor_id；无则空串 */
  anchorId: string;
  /** 是否需要网络解析（短链 / 无法从路径提取房间号的直链） */
  needResolve: boolean;
}

/** 纯数字房间号判定（3~20 位）：与 verifyUtil.verifyRoomNum 对齐 */
export function isPureRoomNum(value: string): boolean {
  return /^[0-9]{3,20}$/.test(value.trim());
}

/**
 * 从直播间 URL 提取房间号（webRid）。只认可靠模式：
 * live.douyin.com/{id} / [?&]live_web_rid= / www.douyin.com/root/live/{id}
 */
export function extractWebRidFromUrl(url: string): string {
  const m =
    url.match(/live\.douyin\.com\/(\d{5,20})(?:[/?&]|$)/) ||
    url.match(/[?&]live_web_rid=(\d{5,20})(?:[&]|$)/) ||
    url.match(/www\.douyin\.com\/root\/live\/(\d{5,20})(?:[/?&]|$)/);
  return m ? m[1] : '';
}

/** 从直播间链接提取 anchor_id（主播维度接口参数），无则空串 */
export function extractAnchorIdFromUrl(url: string): string {
  const m = url.match(/[?&]anchor_id=(\d{5,25})(?:[&]|$)/);
  return m ? m[1] : '';
}

/**
 * 同步判定输入类型与可直接提取的字段（不发网络请求）。
 * 短链 / 提取不到房间号的直链标记 needResolve，由 resolveRoomInput 做网络解析。
 */
export function analyzeRoomInput(input: string): ResolvedRoom {
  const trimmed = (input || '').trim();
  if (!trimmed) return { type: 'invalid', webRid: '', anchorId: '', needResolve: false };
  // 纯数字房间号：直接作为 webRid
  if (isPureRoomNum(trimmed)) {
    return { type: 'roomNum', webRid: trimmed, anchorId: '', needResolve: false };
  }
  const url = extractDouyinUrlFromText(trimmed);
  // 分享短链：v.douyin.com/xxx，必须网络解析
  if (/v\.douyin\.com\//i.test(url)) {
    return { type: 'shareText', url, webRid: '', anchorId: extractAnchorIdFromUrl(url), needResolve: true };
  }
  // 直播间直链：尝试直接提取 webRid
  const webRid = extractWebRidFromUrl(url);
  if (/live\.douyin\.com\//i.test(url)) {
    return {
      type: 'liveUrl',
      url,
      webRid,
      anchorId: extractAnchorIdFromUrl(url),
      needResolve: !webRid
    };
  }
  // 含抖音域名但路径不明（如 www.douyin.com 视频页）→ 尝试网络解析
  if (/https?:\/\/(?:v\.douyin\.com|live\.douyin\.com|www\.douyin\.com)\//i.test(url)) {
    return { type: 'liveUrl', url, webRid, anchorId: extractAnchorIdFromUrl(url), needResolve: !webRid };
  }
  return { type: 'invalid', webRid: '', anchorId: '', needResolve: false };
}

/**
 * 统一输入解析（可含网络解析短链）。所有房间输入入口都应调用本函数。
 * @returns 解析失败时返回 null（webRid 为空），由调用方提示用户重新输入
 */
export async function resolveRoomInput(input: string): Promise<ResolvedRoom | null> {
  const analysis = analyzeRoomInput(input);
  // 无需网络：直接返回
  if (!analysis.needResolve) {
    return analysis.webRid ? analysis : null;
  }
  // 短链：经 Rust（桌面 UA）跟随重定向后从落地页提取
  if (analysis.type === 'shareText' && analysis.url) {
    const { resolveShortUrlRust } = await import('@/utils/tauriBridge');
    const resolved = await resolveShortUrlRust(analysis.url);
    const webRid = extractWebRidFromUrl(resolved || '');
    return {
      ...analysis,
      webRid,
      anchorId: extractAnchorIdFromUrl(resolved || '') || analysis.anchorId,
      needResolve: false
    };
  }
  // 直链但提不到房间号：大概率是落地页仍是 reflow 中转页，用 Rust 解析一次
  if (analysis.url) {
    const { resolveShortUrlRust } = await import('@/utils/tauriBridge');
    const resolved = await resolveShortUrlRust(analysis.url);
    const webRid = extractWebRidFromUrl(resolved || '') || analysis.webRid;
    return {
      ...analysis,
      webRid,
      anchorId: extractAnchorIdFromUrl(resolved || '') || analysis.anchorId,
      needResolve: false
    };
  }
  return null;
}