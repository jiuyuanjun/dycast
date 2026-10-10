import WebSocket from 'ws';
import http from 'http';

const CDP_URL = 'http://127.0.0.1:9222/json/list';

function getPage() {
  return new Promise((resolve, reject) => {
    http.get(CDP_URL, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const pages = JSON.parse(data);
          resolve(pages.find(p => p.type === 'page' && p.url && p.url.includes('tauri.localhost')));
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

async function main() {
  const page = await getPage();
  if (!page) throw new Error('No page found');
  const ws = await connectCDP(page.webSocketDebuggerUrl);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.method === 'Runtime.consoleAPICalled') {
        console.log('CONSOLE:', JSON.stringify(msg.params));
      }
    } catch (e) {}
  });

  await send(ws, 'Runtime.enable');
  await send(ws, 'Runtime.evaluate', { expression: 'console.log("[TEST] hello from webview")', returnByValue: true });
  await new Promise(r => setTimeout(r, 1000));
  ws.close();
}

main().catch(err => { console.error(err); process.exit(1); });
