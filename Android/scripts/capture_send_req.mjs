// 抓取发送 WebView 里 /webcast/room/chat/ 请求的完整 headers（Network domain）
// 用法：node capture_send_req.mjs <wsUrl> <输出文件> [监听秒数]
import { writeFileSync } from 'node:fs';

const wsUrl = process.argv[2];
const outFile = process.argv[3] || 'send_req_capture.json';
const maxSec = Number(process.argv[4] || 90);

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error('ws error'));
  });
}

const ws = await connect(wsUrl);
let id = 0;
const pending = new Map();
const captured = [];

function send(method, params = {}) {
  return new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

ws.onmessage = (event) => {
  const m = JSON.parse(event.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
    return;
  }
  if (m.method === 'Network.requestWillBeSent') {
    const r = m.params.request;
    if (/webcast\/room\/chat|webcast.*chat/.test(r.url)) {
      captured.push({
        ts: new Date().toISOString(),
        url: r.url,
        method: r.method,
        headers: r.headers,
        postData: r.postData ?? null,
      });
      console.log(`[captured] ${r.method} ${r.url.slice(0, 160)}`);
      writeFileSync(outFile, JSON.stringify(captured, null, 2));
    }
  }
};

await send('Network.enable', { maxTotalBufferSize: 10_000_000, maxResourceBufferSize: 5_000_000 });
console.log(`[listening ${maxSec}s] waiting for /webcast/room/chat/ requests...`);

const started = Date.now();
while ((Date.now() - started) / 1000 < maxSec) {
  await new Promise((r) => setTimeout(r, 1000));
}
writeFileSync(outFile, JSON.stringify(captured, null, 2));
console.log(`[done] captured ${captured.length} request(s) -> ${outFile}`);
ws.close();
process.exit(0);
