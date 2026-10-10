import WebSocket from 'ws';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CDP_URL = 'http://127.0.0.1:9222/json/list';

export function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export async function getPage() {
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

export async function connectCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

export function send(ws, method, params = {}) {
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

export async function evaluate(ws, expression, awaitPromise = true) {
  return send(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true
  });
}

export async function waitForSelector(ws, selector, timeout = 5000, interval = 100) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await evaluate(ws, `!!document.querySelector(${JSON.stringify(selector)})`);
    if (result?.result?.value) return true;
    await wait(interval);
  }
  throw new Error(`Timeout waiting for selector: ${selector}`);
}

export async function waitForFunction(ws, fnExpression, timeout = 5000, interval = 100) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await evaluate(ws, `(${fnExpression})()`);
    if (result?.result?.value) return true;
    await wait(interval);
  }
  throw new Error(`Timeout waiting for condition`);
}

export async function navigateAndWait(ws, url, selector, timeout = 5000) {
  const loadPromise = new Promise((resolve) => {
    const handler = (data) => {
      const msg = JSON.parse(data);
      if (msg.method === 'Page.loadEventFired') {
        ws.off('message', handler);
        resolve();
      }
    };
    ws.on('message', handler);
  });
  await send(ws, 'Page.navigate', { url });
  await loadPromise;
  if (selector) {
    await waitForSelector(ws, selector, timeout);
  }
}

export async function setInputValue(ws, selector, value) {
  return evaluate(ws, `
    (function() {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) {
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    })()
  `);
}

export async function clickSelector(ws, selector) {
  return evaluate(ws, `
    (function() {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) { el.click(); return true; }
      return false;
    })()
  `);
}

export async function screenshot(ws, filename) {
  const result = await send(ws, 'Page.captureScreenshot', { format: 'png' });
  if (result?.data) {
    const dir = path.join(__dirname, '..', 'screenshots');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, Buffer.from(result.data, 'base64'));
    console.log('Screenshot saved:', filepath);
  }
}
