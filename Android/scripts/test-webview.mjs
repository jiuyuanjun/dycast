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

async function evaluate(ws, expression, awaitPromise = true) {
  return send(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true
  });
}

async function navigate(ws, url) {
  await send(ws, 'Page.navigate', { url });
  await wait(2500);
}

async function main() {
  const page = await getPage();
  const ws = await connectCDP(page.webSocketDebuggerUrl);
  await send(ws, 'Page.enable');
  await send(ws, 'Runtime.enable');

  // Directly open login webview page
  await navigate(ws, 'http://tauri.localhost/#/login-webview');

  const urlResult = await evaluate(ws, `location.href`);
  console.log('URL:', urlResult.result?.value);

  const slotResult = await evaluate(ws, `
    (function() {
      const slot = document.getElementById('webview-slot');
      const rect = slot ? slot.getBoundingClientRect() : null;
      const dpr = window.devicePixelRatio || 1;
      return {
        hasSlot: !!slot,
        logical: rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null,
        physical: rect ? { x: Math.round(rect.x*dpr), y: Math.round(rect.y*dpr), w: Math.round(rect.width*dpr), h: Math.round(rect.height*dpr) } : null,
        dpr
      };
    })()
  `);
  console.log('WebView slot:', JSON.stringify(slotResult.result?.value, null, 2));

  await wait(3000);
  ws.close();
}

main().catch(err => {
  console.error('WebView test failed:', err);
  process.exit(1);
});
