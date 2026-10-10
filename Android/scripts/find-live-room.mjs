import WebSocket from 'ws';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(__dirname, '..', 'logs', 'network-responses.txt');
const CDP_URL = 'http://127.0.0.1:9222/json/list';
const PC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

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
  console.log('Page URL:', page.url);
  const ws = await connectCDP(page.webSocketDebuggerUrl);
  await send(ws, 'Network.enable');
  await send(ws, 'Network.setUserAgentOverride', { userAgent: PC_UA });

  const candidates = [];
  ws.on('message', async (buf) => {
    const msg = JSON.parse(buf);
    if (msg.method === 'Network.responseReceived') {
      const url = msg.params.response.url;
      if (url.includes('/webcast/') || url.includes('/aweme/v1/') || url.includes('live.douyin.com')) {
        try {
          const body = await send(ws, 'Network.getResponseBody', { requestId: msg.params.requestId });
          const text = body.base64Encoded ? Buffer.from(body.body, 'base64').toString() : body.body;
          if (text && text.length < 5 * 1024 * 1024) {
            fs.appendFileSync(LOG_FILE, `\n--- URL: ${url}\n${text.slice(0, 2000)}\n`);
            // Look for room numbers in JSON/text
            const matches = text.match(/(?:live\.douyin\.com\/|room_id[\"']?\s*[:=]\s*[\"']?)(\d{5,})/g);
            if (matches) candidates.push(...matches);
          }
        } catch (e) {}
      }
    }
  });

  console.log('Navigating to Douyin live homepage...');
  await send(ws, 'Page.navigate', { url: 'https://live.douyin.com/' });
  await new Promise(r => setTimeout(r, 8000));

  console.log('Candidates:', [...new Set(candidates)].slice(0, 20));
  ws.close();
}

main().catch(err => { console.error(err); process.exit(1); });
