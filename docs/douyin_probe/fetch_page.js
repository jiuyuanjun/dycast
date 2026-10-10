// 探测抖音直播间页面可获取的数据（模拟 Rust 代理的请求流程）
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0';

async function main() {
  // 第一次请求首页拿 cookie
  const r1 = await fetch('https://live.douyin.com/', {
    headers: {
      'User-Agent': UA,
      Referer: 'https://live.douyin.com/',
      Origin: 'https://live.douyin.com',
      Host: 'live.douyin.com',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
    }
  });
  const cookies = r1.headers.getSetCookie ? r1.headers.getSetCookie() : [];
  console.log('[pass1] status=', r1.status, 'size=', (await r1.text()).length);
  console.log('[pass1] set-cookie keys=', cookies.map(c => c.split('=')[0]).join(','));

  // 第二次请求直播间页面，带上 cookie
  const r2 = await fetch('https://live.douyin.com/7685693791857838888', {
    headers: {
      'User-Agent': UA,
      Referer: 'https://live.douyin.com/',
      Origin: 'https://live.douyin.com',
      Host: 'live.douyin.com',
      Cookie: cookies.map(c => c.split(';')[0]).join('; '),
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
    }
  });
  const html = await r2.text();
  console.log('[pass2] status=', r2.status, 'size=', html.length);
  const fs = require('fs');
  fs.writeFileSync('live_room_node.html', html);
  // 关键标记检查
  console.log('[pass2] has __pace_f =', html.includes('__pace_f'));
  console.log('[pass2] has RENDER_DATA =', html.includes('RENDER_DATA'));
  console.log('[pass2] has roomStore =', html.includes('roomStore'));
  console.log('[pass2] has __UNIVERSAL =', html.includes('__UNIVERSAL_DATA_FOR_REHYDRATION__'));
  console.log('[pass2] first 200 chars:', html.slice(0, 200).replace(/\n/g, ' '));
}

main().catch(e => {
  console.error('ERR', e);
  process.exit(1);
});
