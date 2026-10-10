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

  // Round 2 Test 1: Login WebView desktop UI without notification dialog
  console.log('\n[ROUND 2 - TEST 1] Login WebView desktop UI');
  await send(ws, 'Page.navigate', { url: 'http://tauri.localhost/#/login-webview' });
  await wait(3000);
  screenshot(path.join(outDir, 'r2-01-login-webview.png'));
  await wait(6000);
  screenshot(path.join(outDir, 'r2-02-login-webview-loaded.png'));

  const viewportLogs = adb('logcat -d | findstr "desktop viewport"');
  const clickLogs = adb('logcat -d | findstr "clicked login"');
  console.log('Viewport logs:', viewportLogs ? 'FOUND' : 'NOT FOUND');
  console.log('Auto-click logs:', clickLogs ? 'FOUND' : 'NOT FOUND');
  if (viewportLogs) console.log(viewportLogs.split('\n').slice(-3).join('\n'));
  if (clickLogs) console.log(clickLogs.split('\n').slice(-3).join('\n'));

  // Round 2 Test 2: Landscape / portrait rotation stability
  console.log('\n[ROUND 2 - TEST 2] Landscape/Portrait rotation');
  await send(ws, 'Page.navigate', { url: 'http://tauri.localhost/#/live/chat' });
  await wait(2000);
  adb('shell content insert --uri content://settings/system --bind name:s:accelerometer_rotation --bind value:i:0');
  adb('shell content insert --uri content://settings/system --bind name:s:user_rotation --bind value:i:1');
  await wait(1500);
  screenshot(path.join(outDir, 'r2-03-landscape.png'));

  adb('shell content insert --uri content://settings/system --bind name:s:user_rotation --bind value:i:0');
  await wait(1500);
  screenshot(path.join(outDir, 'r2-04-portrait.png'));

  // Round 2 Test 3: Login success jump (auto-detect sessionid)
  console.log('\n[ROUND 2 - TEST 3] Login success auto-jump');
  await send(ws, 'Page.navigate', { url: 'http://tauri.localhost/#/login-webview' });
  await wait(5000);
  const urlAfterLogin = (await getPage()).url;
  console.log('URL after login webview:', urlAfterLogin);
  if (urlAfterLogin.includes('/live')) {
    console.log('PASS: Auto-jumped to /live after sessionid detected');
  } else {
    console.log('INFO: No sessionid detected yet, staying on login page');
  }
  screenshot(path.join(outDir, 'r2-05-after-login.png'));

  ws.close();
  console.log('\nRound 2 verification completed.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
