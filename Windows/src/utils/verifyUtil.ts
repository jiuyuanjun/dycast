/**
 * 验证房间号
 * @param value
 * @returns
 */
export function verifyRoomNum(value: string) {
  const reg = /^[0-9]{3,20}$/;
  return reg.test(value);
}

/**
 * 从 URL 中提取直播间房间号。
 * 只认可靠模式：live.douyin.com/{房间号} 与 www.douyin.com/root/live/{房间号}。
 * 注意：不能从 webcast.amemv.com/douyin/webcast/reflow/{id} 或任意路径末段提取数字——
 * reflow 路径里是 19 位 room_id 而非房间号（webRid），任意末段数字会把视频页 ID 误当房间号。
 * @param url
 * @returns 房间号，或空字符串
 */
export function extractRoomNumFromUrl(url: string): string {
  // 标准 live.douyin.com/123456
  const reg = /live\.douyin\.com\/(\d{5,20})(?:[/?&]|$)/;
  const match = reg.exec(url);
  if (match) return match[1];
  // www.douyin.com/root/live/123456
  const rootLiveMatch = url.match(/www\.douyin\.com\/root\/live\/(\d{5,20})(?:[/?&]|$)/);
  if (rootLiveMatch) return rootLiveMatch[1];
  return '';
}

/**
 * 从一段混合文本中提取第一个抖音链接（优先带协议；无协议时自动补全 https://）。
 * 支持 https://v.douyin.com/xxx、https://live.douyin.com/xxx、https://www.douyin.com/xxx。
 * @param text
 * @returns 提取到的链接；未匹配到时原样返回
 */
export function extractDouyinUrlFromText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const withProto = /https?:\/\/(?:v\.douyin\.com|live\.douyin\.com|www\.douyin\.com)\/[^\s\u3000\n\r]*/i.exec(trimmed);
  if (withProto) return withProto[0];
  // 无协议形式（如 v.douyin.com/xxx 直接贴在文案中）
  const noProto = /(?:^|[^\w./@-])((?:v\.douyin\.com|live\.douyin\.com|www\.douyin\.com)\/[^\s\u3000\n\r]*)/i.exec(trimmed);
  if (noProto) return `https://${noProto[1]}`;
  return trimmed;
}

export async function resolveShortUrl(shortUrl: string): Promise<string> {
  // Tauri 环境优先走 Rust 侧解析（桌面 UA 与代理一致，无 WebView 跨域限制）
  try {
    const { resolveShortUrlRust } = await import('@/utils/tauriBridge');
    const resolved = await resolveShortUrlRust(shortUrl);
    if (resolved && resolved !== shortUrl) return resolved;
  } catch {
    // fallthrough to in-WebView fetch
  }
  try {
    const res = await fetch(shortUrl, {
      method: 'HEAD',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
      }
    });
    return res.url;
  } catch {
    try {
      const res = await fetch(shortUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
        }
      });
      return res.url;
    } catch {
      return shortUrl;
    }
  }
}

/**
 * 从房间号或抖音直播链接中提取房间号
 * @param value
 * @returns 提取到的房间号，或空字符串
 */
export function extractRoomNum(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (verifyRoomNum(trimmed)) return trimmed;
  return extractRoomNumFromUrl(extractDouyinUrlFromText(trimmed));
}

/** 输入类型分析结果（同步判定，不发网络请求） */
export interface InputAnalysis {
  /**
   * roomNum=纯数字房间号；liveUrl=直播间直链（房间号可直接提取）；
   * shareText=分享文案夹 v.douyin.com 短链（需解析真实房间号）；streamerName=主播名称等文字
   */
  type: 'roomNum' | 'liveUrl' | 'shareText' | 'streamerName';
  /** 提取出的干净链接（链接类输入时存在，无协议已补全 https://） */
  url?: string;
  /** 无需网络即可直接得到的房间号（roomNum / liveUrl 时存在） */
  roomNum?: string;
}

/**
 * 判断用户在连接直播间页面输入的是哪种情况：
 *  - 情况一：分享文案夹 v.douyin.com 短链 → 'shareText'
 *  - 情况二：live.douyin.com 直链 → 'liveUrl'（房间号直接提取，无需网络）
 *  - 纯数字房间号 → 'roomNum'；其他文字 → 'streamerName'（走主播搜索）
 * @param value
 */
export function analyzeInputType(value: string): InputAnalysis {
  const trimmed = value.trim();
  if (!trimmed) return { type: 'streamerName' };
  if (verifyRoomNum(trimmed)) return { type: 'roomNum', roomNum: trimmed };
  const url = extractDouyinUrlFromText(trimmed);
  // 情况一：分享文案中的 v.douyin.com 短链
  if (/v\.douyin\.com\//i.test(url)) return { type: 'shareText', url };
  // 情况二：直播间直链
  const roomNum = extractRoomNumFromUrl(url);
  if (roomNum) return { type: 'liveUrl', url, roomNum };
  // 含抖音域名但提取不到房间号（如 www.douyin.com 视频页）→ 仍按链接走解析/兜底流程
  if (/https?:\/\/(?:v\.douyin\.com|live\.douyin\.com|www\.douyin\.com)\//i.test(url)) {
    return { type: 'liveUrl', url };
  }
  return { type: 'streamerName' };
}

/**
 * 解析抖音链接（支持短链接）并提取房间号
 * @param url 抖音链接（可以是短链接或直接链接，也可以混在文案中）
 * @returns 提取到的房间号，或空字符串
 */
export async function resolveDouyinUrlAndExtractRoomNum(url: string): Promise<string> {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (verifyRoomNum(trimmed)) return trimmed;

  // 先从混合文本中提取干净链接（无协议会自动补全）
  const cleanUrl = extractDouyinUrlFromText(trimmed);

  // 直链直接提取（免网络）
  const fromPath = extractRoomNumFromUrl(cleanUrl);
  if (fromPath) return fromPath;

  // 短链：经 Rust（桌面 UA）跟随重定向后从落地页提取。
  // 落地 live.douyin.com → 提取房间号；仍是 reflow 链接 → 提取不到（路径里是
  // 19 位 room_id 不是房间号），返回空字符串交给上层走 WebView 兜底。
  const shortLinkReg = /v\.douyin\.com\/([^/?\s&]+)/i;
  if (shortLinkReg.test(cleanUrl)) {
    const resolvedUrl = await resolveShortUrl(cleanUrl);
    return extractRoomNumFromUrl(resolvedUrl);
  }
  return '';
}

/**
 * 判断输入是否为链接或短链接（含显式协议、www 前缀、带路径的域名，或混在文案中的抖音链接）。
 * @param value
 */
export function isLinkOrShortUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  // 显式协议
  if (/^https?:\/\//i.test(trimmed)) return true;
  // www 前缀
  if (/^www\./i.test(trimmed)) return true;
  // 带路径/参数的域名形式，如 v.douyin.com/xxxxx、live.douyin.com/123
  if (/^[a-z0-9]+([-.][a-z0-9]+)*\.[a-z]{2,}([/?#].*|$)/i.test(trimmed)) return true;
  // 混合文案中只要包含抖音链接也按链接处理
  if (/https?:\/\/(?:v\.douyin\.com|live\.douyin\.com|www\.douyin\.com)/i.test(trimmed)) return true;
  return false;
}

/**
 * 验证房间号或直播链接
 * @param value
 * @returns
 */
export function verifyRoomInput(value: string) {
  const roomNum = extractRoomNum(value);
  return { flag: !!roomNum, roomNum };
}

/**
 * 验证 wss 地址
 * @param value
 * @returns
 */
export function verifyWsUrl(value: string) {
  const reg = /^wss?:\/\/(?:\[[^\]]+\]|[^/:]+)(?::\d+)?(?:\/.*)?$/i;
  return reg.test(value);
}
