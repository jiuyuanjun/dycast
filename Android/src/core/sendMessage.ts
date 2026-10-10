import { getAbogus } from './abogus';
import { getMsToken } from './signature';
import { isAndroid, sendDanmakuInWebView, withProxyOrigin } from '@/utils/tauriBridge';

const USER_AGENT =
  navigator.userAgent ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0';

/** 从 document.cookie 中读取指定 cookie 值（找不到返回 null） */
function readCookie(name: string): string | null {
  try {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

/** 编码版 query 拼接：每个值 encodeURIComponent，保证签名与最终发送的 URL 完全一致 */
function encodeUrlParams(params: Record<string, any>): string {
  return Object.keys(params)
    .map(k => `${k}=${encodeURIComponent(params[k] ?? '')}`)
    .join('&');
}

/**
 * 发送弹幕（网页版 webcast/room/chat 接口）
 * @param roomId 直播间 room_id
 * @param content 弹幕内容
 * @param secUid 当前登录用户的 sec_uid（未登录时无法发送）
 * @param webRid 直播间 web_rid（短房间号）：Android 隐藏 WebView 加载页面用，
 *                与 fetch 的 room_id 形态不同，缺省时回退用 roomId
 * @returns { ok, msg }
 */
export async function sendChatMessage(
  roomId: string,
  content: string,
  secUid?: string,
  webRid?: string
): Promise<{ ok: boolean; msg: string }> {
  const text = (content || '').trim();
  if (!text) return { ok: false, msg: '消息内容为空' };
  if (!roomId) return { ok: false, msg: '缺少直播间 ID' };
  if (!secUid) return { ok: false, msg: '账号信息未就绪，请到「设置 → 登录/更换账号」重新登录一次后再发送' };
  if (text.length > 100) return { ok: false, msg: '单条弹幕不能超过 100 字' };

  try {
    // 优先使用 cookie 中的真实 msToken（代理转发时会复用同源 cookie，风控更稳）；
    // 拿不到再退回随机模拟值（此前随机串含 = 会破坏 query 解析，编码后修复）。
    const msToken = readCookie('msToken') || getMsToken(184);
    const csrfToken = readCookie('X-Secsdk-Csrf-Token') || readCookie('x-secsdk-csrf-token');
    const t = Date.now();
    // 参考开源实现（cv-cat/Douyin_Spider sendMsgInRoom）对齐网页版浏览器真实请求参数：
    // browser_name 必须与 UA 一致（此前用 'Mozilla' 与 Edg UA 不符，是明显风控特征），
    // 并补上 language/enter_from/screen_*/type 等浏览器默认会带上的参数。
    const isBrowser = typeof window !== 'undefined';
    const baseParams = {
      aid: '6383',
      app_name: 'douyin_web',
      device_platform: 'web',
      language: 'zh-CN',
      enter_from: 'link_share',
      cookie_enabled: true,
      screen_width: isBrowser ? window.screen.width : 1920,
      screen_height: isBrowser ? window.screen.height : 1080,
      browser_language: 'zh-CN',
      browser_platform: 'Win32',
      browser_name: 'Chrome',
      browser_version: '136.0.0.0',
      browser_online: true,
      did_rule: 3,
      endpoint: 'live_pc',
      msToken,
      room_id: roomId,
      sec_uid: secUid,
      t: String(t),
      webcast_sdk_version: '1.0.15',
      live_id: '1',
      // content 以编码形式参与 query 与 a_bogus 签名（网页版签名覆盖完整 query）
      type: '0',
      content: text
    };

    // 签名参数：a_bogus 基于「编码后的完整 query（不含 a_bogus 自身）」计算，
    // 与实际发送的 URL 逐字节一致，避免因浏览器自动编码导致签名校验失败。
    const paramStr = encodeUrlParams(baseParams);
    const aBogus = getAbogus(paramStr, USER_AGENT);
    const pageUrl = `https://live.douyin.com/webcast/room/chat/?${paramStr}&a_bogus=${aBogus}`;
    if (await isAndroid()) {
      // WebView 加载的页面 URL 用 web_rid 形态（live.douyin.com/{web_rid}），
      // 与 fetch 接口的 room_id（数字 form）形态不同，二者解耦
      const pageResult = await sendDanmakuInWebView(webRid || roomId, pageUrl);
      // 页面编辑器链路是唯一可靠通道（实测 2026-09-28：页面上下文手动 fetch 与
      // 本地代理链路的写请求都会被风控降级——"接口成功但不广播"甚至直接 403，
      // 且失败请求会污染会话风控状态）。未确认也直接报错，绝不回落代理链路。
      let pageData: any = null;
      try { pageData = JSON.parse(pageResult.body); } catch { /* 非 JSON（风控页/HTML） */ }
      const pageCode = pageData?.status_code ?? pageData?.code;
      if (pageResult.ok && (pageCode === undefined || pageCode === 0)) {
        return { ok: true, msg: '发送成功' };
      }
      const pageMsg = pageData?.data?.prompts || pageData?.data?.message;
      return {
        ok: false,
        msg: pageMsg
          || (pageResult.status > 0 ? `发送失败（${pageCode}）` : '发送页面未就绪，请稍后重试')
      };
    }
    // 非 Android 环境的兜底（当前仅 Android 发版，此分支保留防御性）
    const fullUrl = await withProxyOrigin(`/dylive/webcast/room/chat/?${paramStr}&a_bogus=${aBogus}`);
    console.info('[sendMessage] POST', fullUrl.slice(0, 260) + '...(截断)');
    console.info('[sendMessage] UA =>', USER_AGENT.slice(0, 80));

    const res = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // 抖音 web 写接口的 CSRF 校验头（proxy.rs 已支持透传，此前遗漏导致被拦截）
        'X-Secsdk-Csrf-Request': '1',
        'X-Secsdk-Csrf-Version': '1.2.22',
        ...(csrfToken ? { 'X-Secsdk-Csrf-Token': csrfToken } : {})
      },
      // 弹幕内容同时放在 form body（兼容服务端两种解析方式）
      body: `content=${encodeURIComponent(text)}&room_id=${encodeURIComponent(roomId)}&sec_uid=${encodeURIComponent(secUid)}`
    });
    const rawText = await res.text();
    console.info('[sendMessage] HTTP', res.status, 'body =>', rawText.slice(0, 500));
    if (!res.ok) {
      return { ok: false, msg: `发送失败：HTTP ${res.status} ${rawText.slice(0, 80)}` };
    }
    let data: any = null;
    try {
      data = JSON.parse(rawText);
    } catch {
      return { ok: false, msg: `发送失败：响应无法解析 ${rawText.slice(0, 80)}` };
    }
    const statusCode = data?.status_code ?? data?.code ?? 0;
    if (statusCode !== 0) {
      const msg = data?.data?.prompts || data?.data?.message || `发送失败（${statusCode}）`;
      return { ok: false, msg };
    }
    return { ok: true, msg: '发送成功' };
  } catch (err) {
    console.error('[sendMessage] send failed =>', err);
    return { ok: false, msg: '发送失败，请检查网络后重试' };
  }
}