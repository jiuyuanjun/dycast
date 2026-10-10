/**
 * CDP 导航小工具：node scripts/cdp-nav.mjs "#/"
 */
import WebSocket from 'ws';
import http from 'http';

const hash = process.argv[2] || '#/';
const pages = await new Promise((res, rej) =>
  http.get('http://127.0.0.1:9222/json/list', r => {
    let d = '';
    r.on('data', c => d += c);
    r.on('end', () => res(JSON.parse(d)));
  }).on('error', rej)
);
const page = pages.find(p => p.type === 'page' && p.url.includes('tauri.localhost'));
if (!page) throw new Error('No tauri page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.on('open', r));
const send = (method, params = {}) => new Promise(res => {
  const id = Math.floor(Math.random() * 1e6);
  const h = d => { const m = JSON.parse(d); if (m.id === id) { ws.off('message', h); res(m.result); } };
  ws.on('message', h);
  ws.send(JSON.stringify({ id, method, params }));
});
await send('Runtime.evaluate', { expression: `location.hash = '${hash}'; 'ok'` });
console.log('navigated to', hash);
ws.close();
process.exit(0);
