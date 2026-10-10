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

function waitForEvent(ws, eventName, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${eventName}`)), timeout);
    const handler = (data) => {
      const msg = JSON.parse(data);
      if (msg.method === eventName) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg.params);
      }
    };
    ws.on('message', handler);
  });
}

async function main() {
  const page = await getPage();
  if (!page) throw new Error('No page found');
  const ws = await connectCDP(page.webSocketDebuggerUrl);
  await send(ws, 'Debugger.enable');

  const params = await waitForEvent(ws, 'Debugger.scriptParsed');
  console.log('script parsed:', params.url || params.scriptId);

  if (params.url && params.url.includes('index')) {
    const source = await send(ws, 'Debugger.getScriptSource', { scriptId: params.scriptId });
    const hasStatsBar = source.scriptSource.includes('stats-bar');
    console.log('has stats-bar in JS:', hasStatsBar);
  }

  ws.close();
}

main().catch(err => { console.error(err); process.exit(1); });
