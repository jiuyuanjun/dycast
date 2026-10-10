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
    return '';
  }
}

function screenshot(filename) {
  adb('shell screencap -p /data/local/tmp/screen.png');
  adb(`pull /data/local/tmp/screen.png "${filename}"`);
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

  // Navigate to live page
  console.log('Navigating to /live/chat...');
  await send(ws, 'Page.navigate', { url: 'http://tauri.localhost/#/live/chat' });
  await wait(2500);

  // Landscape
  console.log('Rotating to landscape...');
  adb('shell content insert --uri content://settings/system --bind name:s:accelerometer_rotation --bind value:i:0');
  adb('shell content insert --uri content://settings/system --bind name:s:user_rotation --bind value:i:1');
  await wait(2000);
  screenshot(path.join(outDir, 'r2b-landscape.png'));

  // Portrait
  console.log('Rotating to portrait...');
  adb('shell content insert --uri content://settings/system --bind name:s:user_rotation --bind value:i:0');
  await wait(2000);
  screenshot(path.join(outDir, 'r2b-portrait.png'));

  ws.close();
  console.log('Round 2b done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
