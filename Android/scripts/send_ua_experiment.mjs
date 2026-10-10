// 验证 UA/ClientHints 一致性是否是弹幕不广播的根因
// 用法：node send_ua_experiment.mjs <wsUrl> <content>
// 流程：设置完全一致的桌面 Edge136 UA+ClientHints → reload → 编辑器输入 → 真实Enter → 等待 → 读弹幕列表
const wsUrl = process.argv[2];
const content = process.argv[3] || 'desk999';

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error('ws error'));
  });
}

let id = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
function evaluate(expr, awaitPromise = false) {
  return send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ws = await connect(wsUrl);
let loaded = false;
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === 'Page.loadEventFired') loaded = true;
};

// 1) UA 与 Client Hints 完全一致的桌面 Edge 136 / Win10
await send('Network.setUserAgentOverride', {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0',
  userAgentMetadata: {
    brands: [
      { brand: 'Not(A:Brand', version: '99' },
      { brand: 'Microsoft Edge', version: '136' },
      { brand: 'Chromium', version: '136' },
    ],
    fullVersionList: [
      { brand: 'Not(A:Brand', version: '99.0.0.0' },
      { brand: 'Microsoft Edge', version: '136.0.0.0' },
      { brand: 'Chromium', version: '136.0.0.0' },
    ],
    fullVersion: '136.0.0.0',
    platform: 'Windows',
    platformVersion: '10.0.0',
    architecture: 'x86',
    model: '',
    mobile: false,
    bitness: '64',
    wow64: false,
  },
});
console.log('[1] UA override set (consistent desktop Edge136)');

// 2) 刷新页面，让 secsdk/bd-ticket-guard 按新环境重新初始化
await send('Page.enable');
await send('Page.reload', { ignoreCache: true });
const t0 = Date.now();
while (!loaded && Date.now() - t0 < 20000) await sleep(500);
console.log('[2] reloaded, loadEventFired=' + loaded);
await sleep(4000);

// 3) 编辑器输入 + 真实 Enter
const fill = await evaluate(`(function(){
  const ed=document.querySelector('[contenteditable=true].zone-container');
  if(!ed) return 'NO_EDITOR';
  ed.focus();
  document.execCommand('selectAll',false,null);
  document.execCommand('delete',false,null);
  document.execCommand('insertText',false,${JSON.stringify(content)});
  return 'filled:'+(ed.innerText||'').slice(0,20);
})()`);
console.log('[3] fill =>', JSON.stringify(fill?.result?.value));

await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
console.log('[4] Enter dispatched');

// 5) 等待广播回显
await sleep(10000);
const check = await evaluate(`(function(){
  const chat=document.querySelector('.webcast-chatroom');
  const t=chat?(chat.innerText||''):'';
  return JSON.stringify({len:t.length, hasMsg:t.indexOf(${JSON.stringify(content)})>-1, recent:t.slice(-260)});
})()`);
console.log('[5] check =>', check?.result?.value);
ws.close();
process.exit(0);
