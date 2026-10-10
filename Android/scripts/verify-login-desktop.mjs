import WebSocket from 'ws';
import http from 'http';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const CDP_URL = 'http://127.0.0.1:9222/json/list';
const ADB = process.env.LOCALAPPDATA + '\\Android\\Sdk\\platform-tools\\adb.exe';
const DEVICE = 'emulator-5554';

function adb(args) {
  const cmd = `"${ADB}" -s ${DEVICE} ${args}`;
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 30000 });
  } catch (e) {
    console.error('adb error:', e.stderr || e.message);
    return '';
  }
}

function screenshot(filename) {
  const remote = '/data/local/tmp/screen.png';
  adb(`shell screencap -p ${remote}`);
  adb(`pull ${remote} "${filename}"`);
  console.log('Screenshot:', filename);
}

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

async function main() {
  const outDir = path.join(process.cwd(), 'verify-screenshots');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

  const page = await getPage();
  if (!page) throw new Error('No Tauri page found');
  console.log('Page URL:', page.url);

  const ws = await connectCDP(page.webSocketDebuggerUrl);
  await send(ws, 'Page.enable');
  await send(ws, 'Runtime.enable');

  // Navigate to login webview with fresh cookies
  console.log('Navigating to /login-webview (cookies cleared)...');
  await send(ws, 'Page.navigate', { url: 'http://tauri.localhost/#/login-webview' });
  await wait(2000);
  screenshot(path.join(outDir, '05-login-webview-fresh.png'));

  // Wait for Douyin page to load and viewport JS to run
  await wait(6000);
  screenshot(path.join(outDir, '06-login-webview-loaded.png'));

  // Check logcat for desktop viewport scale log
  console.log('Checking logcat...');
  const logs = adb('logcat -d | findstr "desktop viewport"');
  console.log(logs || 'No desktop viewport log found');

  // Check if login button auto-click happened
  const clickLogs = adb('logcat -d | findstr "clicked login button"');
  console.log(clickLogs || 'No auto-click log found');

  ws.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
