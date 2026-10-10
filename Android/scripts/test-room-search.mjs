import WebSocket from 'ws';
import http from 'http';
import { execSync } from 'child_process';
import fs from 'fs';

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

async function evaluate(ws, expression, awaitPromise = true) {
  const res = await send(ws, 'Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (res && res.result && res.result.subtype === 'error') {
    throw new Error(`CDP evaluate error: ${res.result.description}`);
  }
  return res && res.result ? res.result.value : undefined;
}

async function navigate(ws, url) {
  await send(ws, 'Page.navigate', { url });
  await new Promise(r => setTimeout(r, 2500));
}

async function screenshot(ws, filename) {
  const result = await send(ws, 'Page.captureScreenshot', { format: 'png' });
  if (result && result.data) {
    fs.writeFileSync(filename, Buffer.from(result.data, 'base64'));
    console.log('Screenshot saved:', filename);
  }
}

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const page = await getPage();
  if (!page) throw new Error('No page found');
  console.log('Page URL:', page.url);
  const ws = await connectCDP(page.webSocketDebuggerUrl);
  await send(ws, 'Page.enable');
  await send(ws, 'Runtime.enable');

  // Go to home
  await navigate(ws, 'http://tauri.localhost/#/');
  await screenshot(ws, 'screen-home-search.png');

  // Click search button
  const btnRes = await evaluate(ws, `
    (function() {
      const btn = document.querySelector('.search-btn');
      if (btn) { btn.click(); return 'clicked'; }
      return 'not found';
    })()
  `);
  console.log('Search button:', btnRes);
  await wait(3000);
  await screenshot(ws, 'screen-room-search.png');

  // Wait for WebView to load, then click select room
  await wait(5000);
  const selectRes = await evaluate(ws, `
    (function() {
      const btn = document.querySelector('.webview-toolbar .btn:not(.secondary)');
      if (btn) { btn.click(); return 'clicked'; }
      return 'not found';
    })()
  `);
  console.log('Select room button:', selectRes);
  await wait(2000);

  // Check if back on home with input filled
  const inputRes = await evaluate(ws, `
    (function() {
      const input = document.querySelector('.room-form-input');
      return input ? input.value : 'no input';
    })()
  `);
  console.log('Room input value after select:', inputRes);
  await screenshot(ws, 'screen-home-after-select.png');

  ws.close();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
