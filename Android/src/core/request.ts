import { getAbogus } from './abogus';
import type { DyImInfo } from './dycast';
import { decodeResponse } from './model';
import { getMsToken } from './signature';
import { makeUrlParams, parseLiveHtml } from './util';
import { withProxyOrigin } from '@/utils/tauriBridge';

/**
 * 请求直播间信息
 */
export const fetchLiveInfo = async function (id: string) {
  try {
    const url = await withProxyOrigin(`/dylive/${id}`);
    console.info('[Request] fetchLiveInfo =>', url);
    const res = await fetch(url);
    console.info('[Request] fetchLiveInfo status =>', res.status);
    if (!res.ok) {
      return Promise.reject(Error(`获取直播间信息失败：HTTP ${res.status}`));
    }
    const html = await res.text();
    return html;
  } catch (err) {
    console.error('[Request] fetchLiveInfo failed =>', err);
    if (err instanceof Error) return Promise.reject(err);
    return Promise.reject(Error('获取直播间信息失败'));
  }
};

/**
 * 通过弹幕发送 WebView 页面上下文抓取直播间页 HTML。
 * WebView 挂在 live.douyin.com 域下，fetch 自带完整 cookie 且页面 secsdk 自动补风控头，
 * 比本地裸代理稳定（代理裸 sessionid 常拿到风控降级页，统计字段缺失）。
 * 页面未就绪时原生侧会挂起、加载完自动补发，这里轮询取结果即可。
 */
async function fetchRoomHtmlViaWebView(webRid: string): Promise<string | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const started = await invoke<boolean>('page_fetch', {
      roomId: webRid,
      url: `https://live.douyin.com/${encodeURIComponent(webRid)}`
    });
    if (!started) return null;
    // 冷启动要等页面加载完（可能 10s+），最长等 20s 后放弃并回落代理
    for (let i = 0; i < 80; i++) {
      const result = await invoke<string | null>('take_page_fetch');
      if (result) {
        const parsed = JSON.parse(result);
        if (parsed.ok && parsed.status === 200 && typeof parsed.body === 'string') {
          console.info('[Request] WebView 房间页 HTML 长度 =>', parsed.body.length);
          return parsed.body;
        }
        console.warn('[Request] WebView 房间页抓取失败 =>', parsed.status, String(parsed.body).slice(0, 80));
        return null;
      }
      await new Promise(r => setTimeout(r, 250));
    }
  } catch (e) {
    console.warn('[Request] WebView 抓取房间页不可用，回落代理 =>', e);
  }
  return null;
}

/**
 * 获取直播间信息（无降级机制）：
 * 优先走 WebView 页面上下文抓取（Android：完整 cookie + 页面 secsdk 自动补风控头，
 * 比本地裸代理稳定）。任一环节失败直接抛错，由上层提示用户重新输入，不静默回落。
 */
export const getLiveInfo = async function (id: string) {
  // 优先 WebView 页面上下文抓取（Android）；抓取或解析失败直接报错，不回落代理
  const webviewHtml = await fetchRoomHtmlViaWebView(id);
  if (webviewHtml) {
    const viaWebview = parseLiveHtml(webviewHtml);
    if (viaWebview) return viaWebview;
    throw new Error('无法获取直播间信息（页面解析失败），请重新输入房间号后再试');
  }
  // WebView 不可用（非 Tauri / 冷启动超时）时走本地代理抓一次；
  // 首次请求无 cookie => __ac_nonce 可能拿不到数据，再请求一次；仍失败则报错
  const html = await fetchLiveInfo(id);
  const first = parseLiveHtml(html);
  if (first) return first;
  const realHtml = await fetchLiveInfo(id);
  const second = parseLiveHtml(realHtml);
  if (second) return second;
  throw new Error('无法获取直播间信息，请确认房间号正确后重新输入');
};

/**
 * 用户请求
 *  - 用于增加cookie
 */
export const fetchUser = async function () {
  try {
    const url = await withProxyOrigin(`/dylive/webcast/user/`);
    console.info('[Request] fetchUser =>', url);
    const res = await fetch(url, {
      method: 'HEAD',
      headers: {
        'X-Secsdk-Csrf-Request': '1',
        'X-Secsdk-Csrf-Version': '1.2.22'
      }
    });
    console.info('[Request] fetchUser status =>', res.status);
    if (!res.ok) {
      return Promise.reject(Error(`获取用户信息失败：HTTP ${res.status}`));
    }
    return res;
  } catch (err) {
    console.error('[Request] fetchUser error =>', err);
    return Promise.reject(err instanceof Error ? err : Error('获取用户信息失败'));
  }
};

const USER_AGENT =
  navigator.userAgent ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0';
const BROWSER_VERSION =
  navigator.appVersion ||
  '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0';
const BROWSER_NAME = navigator.appCodeName || 'Mozilla';
const VERSION_CODE = 180800;

/**
 * 接口默认参数
 *  - /webcast/im/fetch
 */
const defaultIMFetchParams = {
  aid: 6383,
  app_name: 'douyin_web',
  browser_language: 'zh-CN',
  browser_name: BROWSER_NAME,
  browser_online: true,
  browser_platform: 'Win32',
  browser_version: BROWSER_VERSION,
  cookie_enabled: true,
  cursor: '',
  device_id: '',
  device_platform: 'web',
  did_rule: 3,
  endpoint: 'live_pc',
  fetch_rule: 1,
  identity: 'audience',
  insert_task_id: '',
  internal_ext: '',
  last_rtt: 0,
  live_id: 1,
  live_reason: '',
  need_persist_msg_count: 15,
  resp_content_type: 'protobuf',
  screen_height: 1080,
  screen_width: 1920,
  support_wrds: 1,
  tz_name: 'Asia/Shanghai',
  version_code: VERSION_CODE
};

/**
 * 请求初次连接信息
 *  - im/fetch
 * @param roomId
 * @param uniqueId
 * @param roomNum 房间号；暂不需要
 */
export const fetchImInfo = async function (roomId: string, uniqueId: string) {
  // 请求需要一些关键参数：msToken、a_bogus
  // 请求成功后会响应 protobuf 二进制数据，解码为 model 的 Response 类型
  // 主要需要里面的 cursor、internal_ext 值
  try {
    const msToken = getMsToken(184);
    const baseParams = Object.assign({}, defaultIMFetchParams, {
      msToken,
      room_id: roomId,
      user_unique_id: uniqueId,
      live_pc: roomId
    });
    // a_bogus 必须基于"与最终发送 URL 完全一致（含 msToken/live_pc）"的 query 计算，
    // 否则签名与服务器校验的字节不一致，im/fetch 会被风控拒绝（与 sendMessage 同一条规则）。
    const paramStr = makeUrlParams(baseParams);
    const aBogus = getAbogus(paramStr, USER_AGENT);
    const params = Object.assign({}, baseParams, { a_bogus: aBogus });
    const url = await withProxyOrigin(`/dylive/webcast/im/fetch/?${makeUrlParams(params)}`);
    console.info('[Request] fetchImInfo =>', url);
    // 不清楚接口是否有 referer 验证，需要的话，得在服务器跨域配置处设置，这里配置无效
    // const headers = {
    //   Referer: `https://live.douyin.com/${roomNum}`
    // };
    const res = await fetch(url);
    console.info('[Request] fetchImInfo status =>', res.status);
    if (!res.ok) {
      return Promise.reject(Error(`获取连接信息失败：HTTP ${res.status}${res.status === 403 ? '（疑似登录态失效）' : ''}`));
    }
    const buffer = await res.arrayBuffer();
    return buffer;
  } catch (err) {
    console.error('[Request] fetchImInfo failed =>', err);
    if (err instanceof Error && err.message) return Promise.reject(err);
    return Promise.reject(Error('获取连接信息失败：网络异常，请检查网络后重试'));
  }
};

/**
 * 获取初次连接信息
 * @param roomId
 * @param uniqueId
 * @returns
 */
export const getImInfo = async function (roomId: string, uniqueId: string): Promise<DyImInfo> {
  try {
    const buffer = await fetchImInfo(roomId, uniqueId);
    const bytes = new Uint8Array(buffer);
    // 校验响应确实为 protobuf 二进制，而非风控/错误 JSON 体。
    // 若为 JSON 错误体，decodeResponse 会"静默解码出空 cursor"，让上层误以为连接成功实则一条弹幕都收不到。
    if (!bytes.length) {
      return Promise.reject(Error('获取连接信息失败：服务端未返回内容（可能被风控或代理异常），请检查网络后重试'));
    }
    const first = bytes[0];
    // protobuf 首字节是 field tag（field<<3|wire），field 1 的 wire 为 2 时 tag∈[0x0a,0x12]；JSON 首字节为 '{'(0x7b) 或 '['(0x5b)
    if (first === 0x7b || first === 0x5b) {
      return Promise.reject(Error('获取连接信息失败：风控返回 JSON，请稍后重试'));
    }
    // 请求出错返回的可能为json
    const res = decodeResponse(bytes);
    if (!res.cursor && !res.internalExt && !res.pushServer && !res.now) {
      return Promise.reject(Error('获取连接信息失败：返回内容无可用的连接参数'));
    }
    console.info('[Request] getImInfo decoded =>', {
      cursor: res.cursor,
      internalExt: res.internalExt,
      pushServer: res.pushServer,
      fetchType: res.fetchType
    });
    return {
      cursor: res.cursor,
      internalExt: res.internalExt,
      now: res.now,
      pushServer: res.pushServer,
      fetchInterval: res.fetchInterval,
      fetchType: res.fetchType,
      liveCursor: res.liveCursor
    };
  } catch (err) {
    console.error('[Request] getImInfo error =>', err);
    // 不再伪造 cursor：伪造会让上层误以为获取成功，出现"连接成功但一条弹幕都收不到"
    // 的静默失败（且 ACK 携带错误 cursor）。这里直接抛错，由上层按连接失败处理并提示重试。
    return Promise.reject(err instanceof Error ? err : new Error('获取连接信息失败'));
  }
};

/** 默认请求参数 */
const defaultMeFetchParam = {
  aid: '6383',
  app_name: 'douyin_web',
  browser_language: 'zh-CN',
  browser_name: 'Edge',
  browser_platform: 'Win32',
  browser_version: '146.0.0.0',
  cookie_enabled: 'true',
  device_platform: 'web',
  enter_from: 'web_live',
  language: 'zh-CN',
  live_id: '1',
  os_name: 'Windows',
  os_version: '10',
  room_id: '0',
  screen_height: '1080',
  screen_width: '1920'
};

/**
 * 获取当前登录用户信息
 * @returns
 */
export const fetchMeInfo = async function () {
  const params = Object.assign({}, defaultMeFetchParam);
  const paramStr = makeUrlParams(params);
  const msToken = getMsToken(184);
  const abogus = getAbogus(paramStr, USER_AGENT);
  Object.assign(params, {
    msToken,
    a_bogus: abogus
  });
  const url = await withProxyOrigin(`/dylive/webcast/user/me/?${makeUrlParams(params)}`);

  // 一次请求容易受风控/网络波动影响；网络或 HTTP 非 2xx 时重试 1 次，再失败才抛错。
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        lastErr = Error(`获取登录用户信息失败：HTTP ${res.status}`);
        console.warn(`[Request] fetchMeInfo HTTP ${res.status}（第 ${attempt + 1} 次）`);
        continue;
      }
      const data = await res.json();
      if (!data) {
        return Promise.reject(`获取登录用户信息失败`);
      }
      if (data['status_code'] !== 0) {
        const msg = data?.data?.message || data?.data?.prompts || '';
        const code = data['status_code'];
        // 细分：1=未登录/需登录；其它如风控/参数错误
        const hint = code === 1 ? '（未登录）' : '';
        return Promise.reject(`获取登录用户信息失败：状态码 ${code}${hint}，${msg}`);
      }
      return data;
    } catch (err) {
      lastErr = err;
      console.warn(`[Request] fetchMeInfo 请求失败（第 ${attempt + 1} 次）`, err);
    }
  }
  return Promise.reject(lastErr instanceof Error ? lastErr : Error('获取登录用户信息失败'));
};

interface DyResult<T> {
  /** 状态码 */
  code: number;
  /** 状态描述 */
  msg: string;
  /** 数据 */
  data: T;
}

interface DyMeInfo {
  /** sec_uid */
  uid: string;
  /** display_id : 抖音号 */
  did: string;
  /** 昵称 */
  nickname: string;
  /** 头像 */
  avatar: string;
  /** follower_count : 粉丝数 */
  follower: number;
  /** following_count : 关注数 */
  following: number;
  /** signature : 个性签名 */
  sign?: string;
}

/**
 * 获取当前登录用户信息
 */
export const getMeInfo = async function (): Promise<DyResult<DyMeInfo | null>> {
  try {
    const res = await fetchMeInfo();
    let code = 0;
    let msg = '';
    let info: DyMeInfo | null = null;
    if (res['status_code'] !== 0) {
      // 获取失败
      const data = res?.data || {};
      code = res['status_code'];
      msg = data?.prompts || data?.message || '获取用户信息失败';
    } else {
      // 获取成功
      const data = res.data || {};
      info = {
        uid: data.sec_uid || '',
        did: data.display_id || '',
        sign: data.signature || '',
        nickname: data.nickname || '',
        avatar: data.avatar_medium?.url_list?.[0] || '',
        follower: data.follow_info?.follower_count || 0,
        following: data.follow_info?.following_count || 0
      };
    }
    return {
      code,
      msg,
      data: info
    };
  } catch (err) {
    return Promise.reject(err);
  }
};
