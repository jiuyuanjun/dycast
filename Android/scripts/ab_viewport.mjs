// 同会话 A/B：正常视口 vs 1x1 视口，谁广播
// 用法：node ab_viewport.mjs <wsUrl>
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

async function sendViaEditor(content) {
  const fill = await evaluate(`(function(){
    const ed=document.querySelector('[contenteditable=true].zone-container');
    if(!ed) return 'NO_EDITOR';
    ed.focus();
    document.execCommand('selectAll',false,null);
    document.execCommand('delete',false,null);
    document.execCommand('insertText',false,${JSON.stringify(content)});
    return 'filled';
  })()`);
  if (fill?.result?.value !== 'filled') return fill?.result?.value;
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  return 'sent';
}
async function readStream() {
  const r = await evaluate(`(function(){
    const chat=document.querySelector('.webcast-chatroom');
    return JSON.stringify({t:(chat?(chat.innerText||''):'')});
  })()`);
  return JSON.parse(r?.result?.value || '{"t":""}').t;
}

// 0) 先恢复桌面 Edge UA（与内核 ClientHints 一致化）+ reload，让网页版编辑器回来
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
await send('Page.enable');
await send('Page.reload', { ignoreCache: true });
console.log('[0] desktop UA override + reload');
await sleep(8000);
let editorReady = false;
for (let i = 0; i < 12; i++) {
  const r = await evaluate(`!!document.querySelector('[contenteditable=true].zone-container')`);
  if (r?.result?.value === true) { editorReady = true; break; }
  await sleep(2500);
}
console.log('[0] editor ready =>', editorReady);
if (!editorReady) { console.log('ABORT: no editor'); ws.close(); process.exit(0); }

// A: 正常视口
await send('Emulation.setDeviceMetricsOverride', { width: 1080, height: 1920, deviceScaleFactor: 1, mobile: false });
console.log('[A] viewport 1080x1920');
await sleep(3000);
console.log('[A] send =>', await sendViaEditor('ab_yes'));
await sleep(9000);
const tA = await readStream();
console.log('[A] ab_yes broadcast =>', tA.indexOf('ab_yes') > -1);

// B: 切回 1x1
await send('Emulation.setDeviceMetricsOverride', { width: 1, height: 1, deviceScaleFactor: 1, mobile: true });
console.log('[B] viewport 1x1');
await sleep(3000);
console.log('[B] send =>', await sendViaEditor('ab_no'));
await sleep(9000);
const tB = await readStream();
console.log('[B] ab_no broadcast =>', tB.indexOf('ab_no') > -1);

ws.close();
process.exit(0);
