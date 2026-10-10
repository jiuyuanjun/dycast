// CDP 驱动 DyCast WebView 验证：1) 跳转直播间页 2) 触发发送链路（验证接管/兜底）
const wsUrl = process.argv[2];
const cmd = process.argv[3];

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = e => reject(new Error('ws error'));
  });
}

let id = 0;
function evaluate(ws, expr, awaitPromise = false) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    const onMsg = event => {
      const m = JSON.parse(event.data);
      if (m.id === mid) {
        ws.removeEventListener('message', onMsg);
        if (m.error) reject(new Error(JSON.stringify(m.error)));
        else resolve(m.result);
      }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({
      id: mid,
      method: 'Runtime.evaluate',
      params: { expression: expr, awaitPromise, returnByValue: true }
    }));
    setTimeout(() => { ws.removeEventListener('message', onMsg); reject(new Error('timeout')); }, 30000);
  });
}

const ws = await connect(wsUrl);
if (cmd === 'goto') {
  const r = await evaluate(ws, `location.hash = '#/live/chat'; location.hash`);
  console.log('goto result:', JSON.stringify(r.result?.result?.value));
} else if (cmd === 'hash') {
  const r = await evaluate(ws, `location.hash`);
  console.log('hash:', JSON.stringify(r.result?.result?.value));
} else if (cmd === 'send') {
  // 直接调用发送桥（绕过 UI 空房间校验），验证 Kotlin 接管链路
  const expr = `
    window.__TAURI_INTERNALS__.invoke('start_danmaku_send', {
      roomId: '1757082',
      requestUrl: 'https://live.douyin.com/webcast/room/chat/?aid=6383&room_id=1757082&content=dycast_test'
    })
  `;
  const r = await evaluate(ws, expr, true);
  console.log('start_danmaku_send =>', JSON.stringify(r.result?.result?.value ?? r));
  // 轮询结果（发送 helper 会等页面加载后 fetch）
  for (let i = 0; i < 12; i++) {
    await new Promise(s => setTimeout(s, 1000));
    const rr = await evaluate(ws, `window.__TAURI_INTERNALS__.invoke('extract_danmaku_result')`, true);
    const v = rr.result?.result?.value;
    if (v) { console.log('danmaku result =>', String(v).slice(0, 300)); break; }
    if (i === 11) console.log('danmaku result => (12s 内无结果)');
  }
} else if (cmd === 'eval') {
  const r = await evaluate(ws, process.argv[4], true);
  console.log(JSON.stringify(r.result?.result?.value ?? r));
}
ws.close();
process.exit(0);
