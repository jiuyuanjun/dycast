/**
 * 保活三态回归：
 * 1. 跳转 /notification-settings，读取状态徽标
 * 2. 打开"开启前台服务保活"开关 → 验证服务启动
 * 3. 关闭开关 → 验证服务停止
 * 用法：node scripts/regression-keepalive.mjs
 */
import WebSocket from 'ws';
import http from 'http';
import { execSync } from 'child_process';

const ADB = String.raw`C:\Users\jiuyuanjun\AppData\Local\Android\Sdk\platform-tools\adb.exe`;
const CDP_URL = 'http://127.0.0.1:9222/json/list';

function getPage() {
  return new Promise((resolve, reject) => {
    http.get(CDP_URL, res => {
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
    const handler = data => {
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

async function evalJs(ws, expr) {
  const r = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r?.result?.value;
}

function serviceRunning() {
  try {
    const out = execSync(`"${ADB}" shell dumpsys activity services com.dycast.app`, { encoding: 'utf8' });
    return out.includes('DyCastForegroundService');
  } catch {
    return false;
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const page = await getPage();
  if (!page) throw new Error('No page found');
  const ws = await connectCDP(page.webSocketDebuggerUrl);

  // 1. 跳转通知设置页
  await evalJs(ws, `location.hash = '#/notification-settings'; 'ok'`);
  await sleep(1500);

  const before = {
    badges: await evalJs(ws, `Array.from(document.querySelectorAll('.status-badge')).map(b => b.textContent.trim())`),
    service: serviceRunning()
  };
  console.log('[before] badges =', JSON.stringify(before.badges), '| 系统服务在跑 =', before.service);

  // 2. 点开关第一下（当前默认 true → 关闭）
  await evalJs(ws, `document.querySelector('.notify-group:last-of-type .switch')?.click(); 'ok'`);
  await sleep(3500);
  const afterOff = {
    badges: await evalJs(ws, `Array.from(document.querySelectorAll('.status-badge')).map(b => b.textContent.trim())`),
    service: serviceRunning()
  };
  console.log('[toggle1] badges =', JSON.stringify(afterOff.badges), '| 系统服务在跑 =', afterOff.service);

  // 3. 再点一下（重新开启）
  await evalJs(ws, `document.querySelector('.notify-group:last-of-type .switch')?.click(); 'ok'`);
  await sleep(3500);
  const afterOn = {
    badges: await evalJs(ws, `Array.from(document.querySelectorAll('.status-badge')).map(b => b.textContent.trim())`),
    service: serviceRunning()
  };
  console.log('[toggle2] badges =', JSON.stringify(afterOn.badges), '| 系统服务在跑 =', afterOn.service);

  ws.close();
  console.log('\n结论：');
  console.log('  开关关 → 服务停 :', afterOff.service === false ? 'PASS' : 'FAIL');
  console.log('  开关开 → 服务起 :', afterOn.service === true ? 'PASS' : 'FAIL');
  console.log('  徽标实时同步    :', JSON.stringify(afterOn.badges));
}

main().catch(e => { console.error(e); process.exit(1); });
