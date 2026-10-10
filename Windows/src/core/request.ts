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
 * 获取直播间信息
 * @param id 房间号
 * @returns
 */
export const getLiveInfo = async function (id: string) {
  try {
    const html = await fetchLiveInfo(id);
    const first = parseLiveHtml(html);
    if (first) return first;
    else {
      // 如第一次请求无 cookie => __ac_nonce，无法获得目标信息
      // 但第一次请求会返回 cookie => __ac_nonce
      // 请求第二次
      const realHtml = await fetchLiveInfo(id);
      const second = parseLiveHtml(realHtml);
      if (second) return second;
      else throw new Error('获取直播间信息失败');
    }
  } catch (err) {
    return Promise.reject(err);
  }
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
  } catch (err) {
    console.error('[Request] fetchUser error =>', err);
    return Promise.reject(Error('获取用户信息失败'));
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
    const params = Object.assign({}, defaultIMFetchParams, {
      msToken,
      room_id: roomId,
      user_unique_id: uniqueId
    });
    const paramStr = makeUrlParams(
      Object.assign({}, defaultIMFetchParams, {
        room_id: roomId,
        user_unique_id: uniqueId,
        live_pc: roomId
      })
    );
    // 一个加密参数，须通过上侧 params 参数计算，感兴趣自己去逆向，这里不解析，不一定验证
    // const aBogus = '00000000';
    const aBogus = getAbogus(paramStr, USER_AGENT);
    Object.assign(params, {
      live_pc: roomId,
      a_bogus: aBogus
    });
    const url = await withProxyOrigin(`/dylive/webcast/im/fetch/?${makeUrlParams(params)}`);
    console.info('[Request] fetchImInfo =>', url);
    // 不清楚接口是否有 referer 验证，需要的话，得在服务器跨域配置处设置，这里配置无效
    // const headers = {
    //   Referer: `https://live.douyin.com/${roomNum}`
    // };
    const res = await fetch(url);
    console.info('[Request] fetchImInfo status =>', res.status);
    if (!res.ok) {
      return Promise.reject(Error(`获取连接信息失败：HTTP ${res.status}`));
    }
    const buffer = await res.arrayBuffer();
    return buffer;
  } catch (err) {
    return Promise.reject(Error('获取连接信息失败'));
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
    // 请求出错返回的可能为json
    const res = decodeResponse(new Uint8Array(buffer));
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
  const res = await fetch(url).then(res => res.json());
  if (!res) {
    return Promise.reject(`获取登录用户信息失败`);
  }
  if (res['status_code'] !== 0) {
    const msg = res?.data?.message;
    return Promise.reject(`获取登录用户信息失败：状态码 ${res['status_code']}，${msg}`);
  }
  return res;
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
