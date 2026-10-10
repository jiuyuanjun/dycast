import { getAbogus } from './abogus';
import { getMsToken } from './signature';
import { makeUrlParams } from './util';
import { withProxyOrigin } from '@/utils/tauriBridge';

const USER_AGENT =
  navigator.userAgent ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0';

/**
 * 发送弹幕（网页版 webcast/chat/post 接口）
 * @param roomId 直播间 room_id
 * @param content 弹幕内容
 * @param secUid 当前登录用户的 sec_uid（未登录时无法发送）
 * @returns { ok, msg }
 */
export async function sendChatMessage(
  roomId: string,
  content: string,
  secUid?: string
): Promise<{ ok: boolean; msg: string }> {
  const text = (content || '').trim();
  if (!text) return { ok: false, msg: '消息内容为空' };
  if (!roomId) return { ok: false, msg: '缺少直播间 ID' };
  if (!secUid) return { ok: false, msg: '请先登录抖音账号后再发送弹幕' };
  if (text.length > 100) return { ok: false, msg: '单条弹幕不能超过 100 字' };

  try {
    const msToken = getMsToken(184);
    const t = Date.now();
    const baseParams = {
      aid: '6383',
      app_name: 'douyin_web',
      device_platform: 'web',
      browser_language: 'zh-CN',
      browser_name: 'Mozilla',
      browser_online: true,
      browser_platform: 'Win32',
      cookie_enabled: true,
      did_rule: 3,
      endpoint: 'live_pc',
      msToken,
      room_id: roomId,
      sec_uid: secUid,
      t: String(t),
      webcast_sdk_version: '1.0.15',
      live_id: '1'
    };

    // 签名参数：a_bogus 基于完整 query 字符串计算
    const paramStr = makeUrlParams(baseParams);
    const aBogus = getAbogus(paramStr, USER_AGENT);
    const fullParams = { ...baseParams, a_bogus: aBogus };

    const url = await withProxyOrigin(`/dylive/webcast/chat/post/?${makeUrlParams(fullParams)}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      // 弹幕内容通过 form body 传递（修复：此前未携带 body，导致消息发送无任何反应）
      body: `content=${encodeURIComponent(text)}`
    });
    if (!res.ok) {
      return { ok: false, msg: `发送失败：HTTP ${res.status}` };
    }
    const data = await res.json();
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
