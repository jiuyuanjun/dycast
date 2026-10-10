// 抓 WebView 网络请求的 Cookie 头：确认 sessionid 是否随请求发送
const wsUrl = process.argv[2];
const ws = new WebSocket(wsUrl);
let id = 0;
const send = (method, params = {}) => {
  ws.send(JSON.stringify({ id: ++id, method, params }));
};
const cookies = [];
ws.onopen = () => {
  send('Network.enable');
  setTimeout(() => {
    // 触发一次 ranklist 请求
    send('Runtime.evaluate', {
      expression: `fetch('https://live.douyin.com/webcast/ranklist/audience/?aid=6383&app_name=douyin_web&device_platform=web&room_id=286637570123&rank_type=30&title_type=1',{credentials:'include'}).then(r=>r.status).catch(e=>'ERR')`,
      awaitPromise: true, returnByValue: true
    });
  }, 300);
  setTimeout(() => {
    console.log('CAPTURED:', JSON.stringify(cookies.slice(0, 3), null, 1).slice(0, 1200));
    process.exit(0);
  }, 6000);
};
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Network.requestWillBeSent') {
    const u = m.params.request.url;
    if (u.includes('ranklist')) {
      cookies.push({
        url: u.slice(0, 80),
        cookieHeader: (m.params.request.headers.Cookie || m.params.request.headers.cookie || '(无 Cookie 头)').slice(0, 300)
      });
    }
  }
};
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 15000);
