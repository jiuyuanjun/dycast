// 用 requestWillBeSentExtraInformation 抓真实 Cookie 头（requestWillBeSent 不含敏感头）
const wsUrl = process.argv[2];
const ws = new WebSocket(wsUrl);
let id = 0;
const send = (method, params = {}) => { ws.send(JSON.stringify({ id: ++id, method, params })); };
const hits = [];
ws.onopen = () => {
  send('Network.enable');
  setTimeout(() => {
    send('Runtime.evaluate', {
      expression: `fetch('https://live.douyin.com/webcast/ranklist/audience/?aid=6383&app_name=douyin_web&device_platform=web&room_id=286637570123&rank_type=30&title_type=1',{credentials:'include'}).then(r=>r.status).catch(e=>'ERR')`,
      awaitPromise: true, returnByValue: true
    });
  }, 300);
  setTimeout(() => {
    for (const h of hits.slice(0, 2)) {
      const ck = h.cookie || '';
      console.log('URL:', h.url.slice(0, 70));
      console.log('COOKIE(len ' + ck.length + '):', ck.split(';').map(s => s.trim().split('=')[0]).slice(0, 20).join(', '));
      console.log('HAS_sessionid:', ck.includes('sessionid'));
      console.log('---');
    }
    if (!hits.length) console.log('NO_EXTRA_INFO_EVENTS');
    process.exit(0);
  }, 6000);
};
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Network.requestWillBeSentExtraInformation') {
    const u = m.params.request.url || '';
    if (u.includes('ranklist')) {
      hits.push({ url: u, cookie: m.params.headers.Cookie || m.params.headers.cookie || '' });
    }
  }
};
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 15000);
