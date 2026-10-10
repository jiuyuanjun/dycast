// 轮询 DyCast 登录态：sessionid 出现即退出 0；超时退出 1
// 用法：node wait_login.mjs <maxSeconds>
import { execSync } from 'node:child_process';

const maxSec = Number(process.argv[2] || 600);
const start = Date.now();

function dyCastWs() {
  try {
    const out = execSync('curl -s http://127.0.0.1:9222/json', { encoding: 'utf8' });
    const pages = JSON.parse(out);
    const p = pages.find(p => (p.url || '').startsWith('http://tauri.localhost'));
    return p?.webSocketDebuggerUrl || null;
  } catch { return null; }
}

function invoke(expr, awaitPromise = true) {
  return new Promise(resolve => {
    const url = dyCastWs();
    if (!url) return resolve(null);
    const ws = new WebSocket(url);
    const timer = setTimeout(() => { try { ws.close(); } catch {} resolve(null); }, 8000);
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise, returnByValue: true } }));
    };
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id === 1) {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        resolve(m.result?.result?.value ?? null);
      }
    };
    ws.onerror = () => { clearTimeout(timer); resolve(null); };
  });
}

while ((Date.now() - start) / 1000 < maxSec) {
  const sid = await invoke("window.__TAURI_INTERNALS__.invoke('extract_douyin_sessionid')");
  if (sid && String(sid).length > 10) {
    console.log(`LOGIN_OK sid=${String(sid).slice(0, 8)}... at ${new Date().toLocaleTimeString()}`);
    process.exit(0);
  }
  await new Promise(r => setTimeout(r, 8000));
}
console.log('LOGIN_TIMEOUT');
process.exit(1);
