// 用项目签名逻辑在 Node 中调用 webcast room detail 接口
// 复刻 getMsToken（纯随机字符串）+ 复用 abogus.js 的 getAbogus
import { getAbogus } from "./abogus.mjs";
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0';

// getMsToken 复刻
function getMsToken(length = 182) {
  let chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// makeUrlParams 复刻
function makeUrlParams(params) {
  return Object.keys(params)
    .reduce((t, n) => {
      let r;
      return `${t}${t ? '&' : ''}${n}=${null != (r = params[n]) ? r : ''}`;
    }, '');
}

const ROOM_ID = '7685693791857838888';

async function callDetail() {
  const msToken = getMsToken(184);
  const baseParams = {
    aid: '6383',
    app_name: 'douyin_web',
    version_code: '180800',
    webcast_sdk_version: '1.0.15',
    update_version_code: '1.0.15',
    did_rule: '3',
    endpoint: 'live_pc',
    u_code: '0',
    device_platform: 'web',
    device_id: '',
    room_id: ROOM_ID,
    msToken
  };
  const paramStr = makeUrlParams(baseParams);
  const aBogus = getAbogus(paramStr, UA);
  const url = `https://live.douyin.com/webcast/room/detail/?${paramStr}&a_bogus=${aBogus}`;
  console.log('[detail] url len =', url.length);

  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Referer: 'https://live.douyin.com/',
      Origin: 'https://live.douyin.com',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    }
  });
  const text = await res.text();
  console.log('[detail] status =', res.status, 'size =', text.length);
  require('fs').writeFileSync('room_detail_resp.json', text);
  try {
    const j = JSON.parse(text);
    console.log('[detail] top keys =', Object.keys(j).join(', '));
    console.log('[detail] status_code =', j.status_code, 'msg =', j.message);
    if (j.data) {
      console.log('[detail] data keys =', Object.keys(j.data).join(', '));
      require('fs').writeFileSync('room_detail_data.json', JSON.stringify(j.data, null, 1));
      // 盘点房间字段
      const room = j.data.room || {};
      console.log('\n--- room fields ---');
      for (const k of Object.keys(room)) {
        const v = room[k];
        const t = typeof v;
        const s = t === 'object' ? JSON.stringify(v).slice(0, 90) : String(v).slice(0, 90);
        console.log(`  ${k}: [${t}] ${s}`);
      }
      const anchor = j.data.anchor || {};
      console.log('\n--- anchor fields ---');
      for (const k of Object.keys(anchor)) {
        const v = anchor[k];
        const t = typeof v;
        const s = t === 'object' ? JSON.stringify(v).slice(0, 90) : String(v).slice(0, 90);
        console.log(`  ${k}: [${t}] ${s}`);
      }
      const stats = j.data.stats || {};
      console.log('\n--- stats fields ---');
      for (const k of Object.keys(stats)) {
        const v = stats[k];
        const s = typeof v === 'object' ? JSON.stringify(v).slice(0, 90) : String(v).slice(0, 90);
        console.log(`  ${k}: ${s}`);
      }
    }
  } catch (e) {
    console.log('[detail] not json:', text.slice(0, 300));
  }
}

callDetail().catch(e => console.error('ERR', e));
