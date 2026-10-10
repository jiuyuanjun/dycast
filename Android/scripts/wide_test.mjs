// 验证：CSS 视口宽度（1080 桌面宽）是否是广播的决定因素
// 用法：node wide_test.mjs <wsUrl>
const wsUrl = process.argv[2];

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
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};

// 1) CDP 模拟桌面 CSS 视口 1080×1920
await send('Emulation.setDeviceMetricsOverride', { width: 1080, height: 1920, deviceScaleFactor: 1, mobile: false });
await sleep(2000);
const vp = await evaluate('JSON.stringify({iw:innerWidth,ih:innerHeight,sw:screen.width})');
console.log('[1] viewport =>', vp?.result?.value);

// 2) 编辑器发 wide999
let filled = 'TIMEOUT';
for (let i = 0; i < 8; i++) {
  const r = await evaluate(`(function(){
    const ed=document.querySelector('[contenteditable=true].zone-container');
    if(!ed) return 'WAIT';
    ed.focus();
    document.execCommand('selectAll',false,null);
    document.execCommand('delete',false,null);
    document.execCommand('insertText',false,'wide999');
    return 'filled';
  })()`);
  const v = r?.result?.value || '';
  if (v !== 'WAIT') { filled = v; break; }
  await sleep(2000);
}
console.log('[2] fill =>', filled);
if (filled !== 'filled') { ws.close(); process.exit(1); }

await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
console.log('[3] Enter dispatched');
await sleep(10000);

// 3) 读流验证
const check = await evaluate(`(function(){
  const chat=document.querySelector('.webcast-chatroom');
  const t=chat?(chat.innerText||''):'';
  return JSON.stringify({hasWide:t.indexOf('wide999')>-1, len:t.length, recent:t.slice(-200)});
})()`);
console.log('[4] broadcast =>', check?.result?.value);
ws.close();
process.exit(0);
