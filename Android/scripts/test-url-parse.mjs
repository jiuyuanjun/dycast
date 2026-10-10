/**
 * verifyUtil 纯函数逻辑测试（Node 直接加载 TS）。
 * 覆盖：房间号校验、从链接/文本提取房间号、anchor_id 提取、输入类型分析、短链识别。
 * 运行：cd Android && node scripts/test-url-parse.mjs
 * 退出码：0 全通过，1 有失败。
 */
import {
  verifyRoomNum,
  extractRoomNum,
  extractRoomNumFromUrl,
  extractAnchorIdFromUrl,
  extractDouyinUrlFromText,
  analyzeInputType,
  isLinkOrShortUrl,
  resolveDouyinUrlAndExtractRoomNum,
} from '../src/utils/verifyUtil.ts';

const cases = [
  // ---- 房间号校验 ----
  {
    name: 'verifyRoomNum: 合法纯数字',
    fn: () => verifyRoomNum('271664729162'),
    expect: true,
  },
  {
    name: 'verifyRoomNum: 过短（<3位）不合法',
    fn: () => verifyRoomNum('12'),
    expect: false,
  },
  {
    name: 'verifyRoomNum: 含非数字不合法',
    fn: () => verifyRoomNum('27a16647'),
    expect: false,
  },
  {
    name: 'verifyRoomNum: 空串不合法',
    fn: () => verifyRoomNum(''),
    expect: false,
  },

  // ---- 从链接提取房间号 ----
  {
    name: 'extractRoomNumFromUrl: 标准 live.douyin.com/{id}',
    fn: () => extractRoomNumFromUrl('https://live.douyin.com/271664729162?camera_id=0'),
    expect: '271664729162',
  },
  {
    name: 'extractRoomNumFromUrl: live_web_rid query 形式',
    fn: () => extractRoomNumFromUrl('https://live.douyin.com/?live_web_rid=12345678'),
    expect: '12345678',
  },
  {
    name: 'extractRoomNumFromUrl: www.douyin.com/root/live/{id}',
    fn: () => extractRoomNumFromUrl('https://www.douyin.com/root/live/271664729162?anchor_id=1634298947436922&api_path=%2Faweme%2Fv1%2Fweb%2Fmodule%2Ffeed%2F'),
    expect: '271664729162',
  },
  {
    name: 'extractRoomNumFromUrl: reflow 19位 id 不误当房间号',
    fn: () => extractRoomNumFromUrl('https://webcast.amemv.com/douyin/webcast/reflow/7682296963874623267'),
    expect: '',
  },
  {
    name: 'extractRoomNumFromUrl: 无抖音链接返回空',
    fn: () => extractRoomNumFromUrl('https://example.com/12345678'),
    expect: '',
  },

  // ---- anchor_id 提取 ----
  {
    name: 'extractAnchorIdFromUrl: 提取 anchor_id',
    fn: () => extractAnchorIdFromUrl('https://live.douyin.com/271664729162?anchor_id=1634298947436922&x=1'),
    expect: '1634298947436922',
  },
  {
    name: 'extractAnchorIdFromUrl: 无 anchor_id 返回空',
    fn: () => extractAnchorIdFromUrl('https://live.douyin.com/271664729162'),
    expect: '',
  },

  // ---- 从文本提取链接 ----
  {
    name: 'extractDouyinUrlFromText: 文案中提取 v.douyin.com 短链',
    fn: () => extractDouyinUrlFromText('3- #在抖音#【江南】正在直播 复制 https://v.douyin.com/uqt9KLW93ro/ 打开抖音'),
    expect: 'https://v.douyin.com/uqt9KLW93ro/',
  },
  {
    name: 'extractDouyinUrlFromText: 无协议短链自动补全 https://',
    fn: () => extractDouyinUrlFromText('v.douyin.com/uqt9KLW93ro/ 打开'),
    expect: 'https://v.douyin.com/uqt9KLW93ro/',
  },
  {
    name: 'extractDouyinUrlFromText: 纯链接原样返回',
    fn: () => extractDouyinUrlFromText('https://live.douyin.com/271664729162'),
    expect: 'https://live.douyin.com/271664729162',
  },
  {
    name: 'extractDouyinUrlFromText: 空串返回空',
    fn: () => extractDouyinUrlFromText('   '),
    expect: '',
  },

  // ---- 输入类型分析 ----
  {
    name: 'analyzeInputType: 纯数字 → roomNum',
    fn: () => analyzeInputType('271664729162').type,
    expect: 'roomNum',
  },
  {
    name: 'analyzeInputType: live.douyin.com 直链 → liveUrl',
    fn: () => analyzeInputType('https://live.douyin.com/271664729162').type,
    expect: 'liveUrl',
  },
  {
    name: 'analyzeInputType: 分享文案短链 → shareText',
    fn: () => analyzeInputType('3- 正在直播 https://v.douyin.com/uqt9KLW93ro/ 打开抖音').type,
    expect: 'shareText',
  },
  {
    name: 'analyzeInputType: 主播名称文字 → streamerName',
    fn: () => analyzeInputType('张三 开播了呀').type,
    expect: 'streamerName',
  },

  // ---- 链接识别 ----
  {
    name: 'isLinkOrShortUrl: 短链接判定为链接',
    fn: () => isLinkOrShortUrl('https://v.douyin.com/uqt9KLW93ro/'),
    expect: true,
  },
  {
    name: 'isLinkOrShortUrl: 纯文字非链接',
    fn: () => isLinkOrShortUrl('张三'),
    expect: false,
  },

  // ---- 综合提取（同步可达的用例） ----
  {
    name: 'extractRoomNum: 纯房间号',
    fn: () => extractRoomNum('271664729162'),
    expect: '271664729162',
  },
  {
    name: 'extractRoomNum: 从长链接提取房间号',
    fn: () => extractRoomNum('https://www.douyin.com/root/live/271664729162?anchor_id=1634298947436922'),
    expect: '271664729162',
  },
  {
    name: 'extractRoomNum: 非抖音文本返回空',
    fn: () => extractRoomNum('一条普通文字'),
    expect: '',
  },
];

let passed = 0;
let failed = 0;

for (const c of cases) {
  try {
    let actual;
    if (typeof c.fn === 'function') {
      actual = c.fn();
      // 支持 async 用例（resolveDouyinUrlAndExtractRoomNum 等）
      if (actual instanceof Promise) actual = await actual;
    }
    const pass = Object.is(actual, c.expect);
    console.log(`${pass ? '✅' : '❌'} ${c.name}`);
    if (!pass) {
      console.log(`   期望: ${JSON.stringify(c.expect)}`);
      console.log(`   实际: ${JSON.stringify(actual)}`);
      failed++;
    } else {
      passed++;
    }
  } catch (err) {
    console.error(`❌ ${c.name}: 异常 ${err.message}`);
    failed++;
  }
}

console.log(`\n总计: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
