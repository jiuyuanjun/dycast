import WebSocket from 'ws';
import http from 'http';
import { execSync } from 'child_process';

const CDP_URL = 'http://127.0.0.1:9222/json/list';
const ADB = `${process.env.ANDROID_HOME || 'C:\\Users\\jiuyuanjun\\AppData\\Local\\Android\\Sdk'}\\platform-tools\\adb.exe`;
const ROOM_ID = '85227334761';

function adb(args) {
  const cmd = `"${ADB}" -s emulator-5554 ${args}`;
  return execSync(cmd, { encoding: 'utf8', shell: true });
}

function logcatClear() { adb('logcat -c'); }
function logcatDump(sinceTag) {
  try {
    const tag = sinceTag ? `echo '--- ${sinceTag} ---' && ` : '';
    return adb(`shell "${tag}logcat -d | grep -E \'DyCast|dycast|WebSocket|websocket|proxy|sessionid|a_bogus|mssdk|room|connect|主播未开播|已结束|房间连接|连接\'"`);
  } catch (e) {
    return '(no matching logs)';
  }
}

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
  return send(ws, 'Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
}

async function navigate(ws, url) {
  await send(ws, 'Page.navigate', { url });
  await new Promise(r => setTimeout(r, 2500));
  await send(ws, 'Runtime.enable');
}

function formatConsole(msg) {
  if (!msg.params || !msg.params.args) return JSON.stringify(msg);
  return `[${msg.params.type}] ${msg.params.args.map(a => a.value !== undefined ? a.value : (a.description || JSON.stringify(a))).join(' ')}`;
}

async function main() {
  console.log('Connecting CDP...');
  const page = await getPage();
  if (!page) throw new Error('No page found');
  const ws = await connectCDP(page.webSocketDebuggerUrl);

  const consoleLogs = [];
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.method === 'Runtime.consoleAPICalled') {
        consoleLogs.push(formatConsole(msg));
      }
    } catch (e) {}
  });

  await send(ws, 'Page.enable');
  await send(ws, 'Runtime.enable');

  logcatClear();

  // Home -> input room -> next
  await navigate(ws, 'http://tauri.localhost/#/');
  await evaluate(ws, `
    const input = document.querySelector('.room-form-input');
    if (input) { input.value = '${ROOM_ID}'; input.dispatchEvent(new Event('input', { bubbles: true })); }
  `);
  await new Promise(r => setTimeout(r, 500));
  await evaluate(ws, `const btn = document.querySelector('.room-form .btn'); if (btn) btn.click();`);
  await new Promise(r => setTimeout(r, 3000));

  // Confirm
  await evaluate(ws, `const btn = document.querySelector('.confirm-actions .btn'); if (btn) btn.click();`);
  await new Promise(r => setTimeout(r, 3000));

  // Go to live chat tab
  await navigate(ws, 'http://tauri.localhost/#/live/chat');
  await new Promise(r => setTimeout(r, 8000));

  console.log('--- Console logs after entering live (total=' + consoleLogs.length + ') ---');
  const relevant = consoleLogs.filter(l => /DyCast|room|live|connect|ws|socket|error|fail|close|reconnect|主播|结束|status|open|message|frame/i.test(l));
  console.log(relevant.length ? relevant.join('\n') : '(no relevant console logs)');
  console.log('--- Logcat after entering live ---');
  console.log(logcatDump('enter live'));

  // Background then foreground
  console.log('Sending HOME...');
  adb('shell input keyevent KEYCODE_HOME');
  await new Promise(r => setTimeout(r, 5000));
  console.log('Bringing app back...');
  adb('shell am start -n com.dycast.app/.MainActivity');
  await new Promise(r => setTimeout(r, 8000));

  console.log('--- Console logs after background/foreground (total=' + consoleLogs.length + ') ---');
  const relevant2 = consoleLogs.filter(l => /DyCast|room|live|connect|ws|socket|error|fail|close|reconnect|主播|结束|status|open|message|frame/i.test(l));
  const afterHome = relevant2.slice(relevant.length);
  console.log(afterHome.length ? afterHome.join('\n') : '(no new relevant console logs)');
  console.log('--- Logcat after background/foreground ---');
  console.log(logcatDump('after background'));

  ws.close();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
