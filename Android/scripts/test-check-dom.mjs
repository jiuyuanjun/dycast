import WebSocket from 'ws';
import http from 'http';

const CDP_URL = 'http://127.0.0.1:9222/json/list';

function getPage() {
  return new Promise((resolve, reject) => {
    http.get(CDP_URL, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const pages = JSON.parse(data);
          const page = pages.find(p => p.type === 'page' && p.url && p.url.includes('tauri.localhost'));
          resolve(page);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function connectCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function send(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1000000);
  return new Promise((resolve, reject) => {
    const handler = (data) => {
      const msg = JSON.parse(data);
      if (msg.id === id) {
        ws.off('message', handler);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function evaluate(ws, expression) {
  return send(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
}

async function main() {
  const page = await getPage();
  if (!page) throw new Error('No page found');
  const ws = await connectCDP(page.webSocketDebuggerUrl);
  await send(ws, 'Runtime.enable');
  await send(ws, 'Page.enable');

  await send(ws, 'Page.navigate', { url: 'http://tauri.localhost/#/live/chat' });
  await wait(3000);

  const statsBar = await evaluate(ws, `
    const bar = document.querySelector('.stats-bar');
    return bar ? { exists: true, html: bar.outerHTML, text: bar.textContent, rect: bar.getBoundingClientRect() } : { exists: false };
  `);
  console.log('stats-bar:', JSON.stringify(statsBar.result.value, null, 2));

  const filterBar = await evaluate(ws, `
    const bar = document.querySelector('.filter-bar');
    return bar ? { exists: true, html: bar.outerHTML, text: bar.textContent } : { exists: false };
  `);
  console.log('filter-bar:', JSON.stringify(filterBar.result.value, null, 2));

  ws.close();
}

main().catch(err => { console.error(err); process.exit(1); });
