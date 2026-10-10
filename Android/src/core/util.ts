import type { DyLiveInfo } from './dycast';

/**
 * 解析直播间信息
 * @param html
 * @returns
 */
export const parseLiveHtml_old = function (html: string): DyLiveInfo | null {
  try {
    const matchRes = html.match(
      /<script\snonce="\S+?"\s>self\.__pace_f\.push\(\[1,"[a-z]?:\[\\"\$\\",\\"\$L\d+\\",null,([\s\S]+?state[\s\S]+?)\]\\n"\]\)<\/script>/
    );
    const REGLIST = [
      {
        reg: /\\{1,7}"/g,
        str: '"'
      },
      {
        reg: /"\{/g,
        str: '{'
      },
      {
        reg: /\}"/g,
        str: '}'
      },
      {
        reg: /"\[(.*)]\"/g,
        str: '[$1]'
      },
      {
        reg: /([^:,{\[])(")([^:,}\]])/g,
        str: '$1"$3'
      }
    ];
    if (!matchRes) return null;
    let json: string = matchRes[1];
    for (const REG of REGLIST) {
      json = json.replace(REG.reg, REG.str);
    }
    const data = JSON.parse(json);
    return {
      roomId: data['state']['roomStore']['roomInfo']['roomId'],
      uniqueId: data['state']['userStore']['odin']['user_unique_id'],
      avatar: data['state']['roomStore']['roomInfo']['anchor']?.['avatar_thumb']?.['url_list'][0],
      cover: data['state']['roomStore']['roomInfo']['room']?.['cover']?.['url_list'][0],
      nickname: data['state']['roomStore']['roomInfo']['anchor']['nickname'],
      title: data['state']['roomStore']['roomInfo']['room']['title'],
      status: data['state']['roomStore']['roomInfo']['room']['status']
    };
  } catch (err) {
    return null;
  }
};

/**
 * 解析 data-* 属性中 HTML 实体编码的 JSON
 */
function parseDataAttr<T>(html: string, attr: string): T | null {
  const reg = new RegExp(`data-${attr}="([\\s\\S]+?)"`);
  const match = html.match(reg);
  if (!match) return null;
  try {
    const decoded = match[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    return JSON.parse(decoded) as T;
  } catch {
    return null;
  }
}

/**
 * 解析直播间信息
 * @param html
 * @returns
 */
export const parseLiveHtml = function (html: string): DyLiveInfo | null {
  try {
    const matchRes = html.match(
      /<script\snonce="\S+?"\s>self\.__pace_f\.push\(\[1,"[a-z]?:\[\\"\$\\",\\"\$L\d+\\",null,([\s\S]+?state[\s\S]+?)\]\\n"\]\)<\/script>/
    );
    if (!matchRes) return null;
    let json: string = matchRes[1].replace(/\\{1,7}"/g, '"');

    // 优先从 inline player 的 data-anchor-info 读取主播信息，
    // 该属性结构稳定且不受 __pace_f 内部字段顺序影响。
    const anchorInfo = parseDataAttr<{ nickname?: string; avatar?: string; id_str?: string }>(
      html,
      'anchor-info'
    );

    // 抖音页面结构会不定期调整：部分字段以前位于 stats / anchor 下，
    // 现在则直接放在 roomStore.roomInfo.room 中，因此同时兼容新旧两种结构。
    const REGMAP: Record<string, RegExp[]> = {
      roomId: [
        /"roomStore":\{"roomInfo":\{"room":\{"id_str":"([0-9]+?)"/,
        /"roomStore":\{"roomInfo":\{"roomId":"([0-9]+?)"/
      ],
      uniqueId: [/"user_unique_id":"([0-9]+?)"/],
      cover: [
        /"roomStore":\{"roomInfo":\{"room":\{"[\s\S]*?"cover":\{"url_list":\["([\S]+?)"/
      ],
      title: [
        /"roomStore":\{"roomInfo":\{"room":\{"id_str":"[0-9]+?","status":[0-9]{1},"status_str":"[0-9]+?","title":"([\s\S]+?)"/,
        /"roomStore":\{"roomInfo":\{"room":\{"[\s\S]*?"title":"([\s\S]+?)"/
      ],
      status: [
        /"roomStore":\{"roomInfo":\{"room":\{"id_str":"[0-9]+?","status":([0-9]{1})/,
        /"roomStore":\{"roomInfo":\{"room":\{"[\s\S]*?"status":([0-9]{1})/
      ],
      audienceCount: [
        /"roomStore":\{"roomInfo":\{"room":\{"[\s\S]*?"user_count_str":"([\s\S]+?)"/,
        /"roomStore":\{"roomInfo":\{"stats":\{"[\s\S]*?"user_count_str":"([\s\S]+?)"/
      ],
      totalUserCount: [
        /"roomStore":\{"roomInfo":\{"stats":\{"[\s\S]*?"total_user_str":"([\s\S]+?)"/,
        /"roomStore":\{"roomInfo":\{"room":\{"[\s\S]*?"total_user_str":"([\s\S]+?)"/
      ],
      likeCount: [
        /"roomStore":\{"roomInfo":\{"room":\{"[\s\S]*?"like_count":([0-9]+?)(?:,|})/,
        /"roomStore":\{"roomInfo":\{"stats":\{"[\s\S]*?"like_count":([0-9]+?)(?:,|})/
      ],
      followCount: [
        /"roomStore":\{"roomInfo":\{"anchor":\{"[\s\S]*?"follower_count":([0-9]+?)(?:,|})/,
        /"roomStore":\{"roomInfo":\{"[\s\S]*?"follower_count":([0-9]+?)(?:,|})/
      ]
    };

    function extractField(name: string) {
      const regs = REGMAP[name];
      if (!regs) return '';
      for (const reg of regs) {
        const exec = reg.exec(json);
        if (exec) return exec[1];
      }
      return '';
    }

    function decodeUnicodeUrl(url: string) {
      if (url) return url.replace(/\\u0026/g, '&');
      return url;
    }

    const roomId = extractField('roomId');
    const uniqueId = extractField('uniqueId');
    const cover = extractField('cover');
    const nickname = anchorInfo?.nickname || '';
    const avatar = anchorInfo?.avatar || '';
    const title = extractField('title');
    const status = extractField('status');
    const audienceCount = extractField('audienceCount');
    const totalUserCount = extractField('totalUserCount');
    const followCount = extractField('followCount');

    // 抖音同一个 state 块中可能存在多个 like_count，其中 stats.like_count 恒为 0，
    // 因此取最大值以避免拿到假的 0。
    const likeCounts = Array.from(json.matchAll(/"like_count":(\d+)/g)).map(m => parseInt(m[1]));
    const likeCount = likeCounts.length ? String(Math.max(...likeCounts)) : extractField('likeCount');

    // 关键防误判：风控降级页（roomStore.roomInfo 只剩 web_rid / web_stream_url）里
    // roomId/status 均提取不到。此时必须视为"解析失败"返回 null，让上层重试，
    // 绝不能假装解析成功并返回默认 status=4（已结束），否则会把"直播中"的房间误报成"主播已下播"。
    if (!roomId || !status) return null;

    return {
      roomId,
      uniqueId,
      avatar: decodeUnicodeUrl(avatar),
      cover: decodeUnicodeUrl(cover),
      nickname,
      title,
      status: parseInt(status || '4'),
      audienceCount: audienceCount || undefined,
      totalUserCount: totalUserCount || undefined,
      likeCount: likeCount || undefined,
      followCount: followCount || undefined
    };
  } catch (err) {
    return null;
  }
};

/**
 * 将对象化成请求参数字符串
 *  - 如：item1=value1&item2=value2&...
 * @param params 请求参数对象
 * @returns
 */
export const makeUrlParams = function (params: any): string {
  return Object.keys(params).reduce((t, n) => {
    let r;
    return `${t}${t ? '&' : ''}${n}=${null != (r = params[n]) ? r : ''}`;
  }, '');
};
