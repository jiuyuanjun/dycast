// 独立重验 + 原生一致形态实验：
// 1) 视口正常化让聊天流渲染，搜历史探针（desk1000/obs111）是否在流里 → 验证它们广播过
// 2) UA override 成与 Client Hints 一致的 Android WebView 原生形态 → reload → 发 mobi333 → 看是否广播
// 用法：node verify_broadcast.mjs <wsUrl>
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

// 0) 拿浏览器内核原生 UA（还没被 override 的真实形态）
const ver = await send('Browser.getVersion');
const nativeUA = ver?.userAgent || '';
console.log('[0] native kernel UA =>', nativeUA.slice(0, 120));

// 1) 视口正常化（先不 reload，直接看当前流里有没有历史探针）
await send('Emulation.setDeviceMetricsOverride', { width: 1080, height: 1920, deviceScaleFactor: 1, mobile: true });
await sleep(4000);
const hist = await evaluate(`(function(){
  const chat=document.querySelector('.webcast-chatroom');
  const t=chat?(chat.innerText||''):'';
  return JSON.stringify({
    len:t.length,
    hasDesk1000:t.indexOf('desk1000')>-1,
    hasObs111:t.indexOf('obs111')>-1,
    hasDesk999:t.indexOf('desk999')>-1,
    hasEdit999:t.indexOf('edit999')>-1,
    hasClean:t.indexOf('clean123')>-1,
    recent:t.slice(-600)
  });
})()`);
console.log('[1] history probes in stream =>', hist?.result?.value);

// 2) UA override 成 Android WebView 原生一致形态 + reload
await send('Network.setUserAgentOverride', {
  userAgent: nativeUA,
  userAgentMetadata: {
    brands: [
      { brand: 'Not(A:Brand', version: '99' },
      { brand: 'Android WebView', version: '133' },
      { brand: 'Chromium', version: '133' },
    ],
    fullVersionList: [
      { brand: 'Not(A:Brand', version: '99.0.0.0' },
      { brand: 'Android WebView', version: '133.0.0.0' },
      { brand: 'Chromium', version: '133.0.0.0' },
    ],
    fullVersion: '133.0.0.0',
    platform: 'Android',
    platformVersion: '15',
    architecture: 'x86',
    model: 'sdk_gphone64_x86_64',
    mobile: true,
    bitness: '64',
    wow64: false,
  },
});
await send('Page.enable');
await send('Page.reload', { ignoreCache: true });
console.log('[2] UA=AndroidWebView-native override + reload');
await sleep(8000);

// 3) 等编辑器 + 聊天流渲染
let chatReady = false;
for (let i = 0; i < 12; i++) {
  const r = await evaluate(`(function(){
    const ed=document.querySelector('[contenteditable=true].zone-container');
    const chat=document.querySelector('.webcast-chatroom');
    return JSON.stringify({ed:!!ed, chatLen:chat?(chat.innerText||'').length:0});
  })()`);
  const v = JSON.parse(r?.result?.value || '{}');
  if (v.ed) { chatReady = true; console.log('[3] editor ready, chatLen=' + v.chatLen); break; }
  await sleep(2500);
}
if (!chatReady) { console.log('[3] editor never ready'); ws.close(); process.exit(0); }
await sleep(5000);

// 4) 发 mobi333
const fill = await evaluate(`(function(){
  const ed=document.querySelector('[contenteditable=true].zone-container');
  ed.focus();
  document.execCommand('selectAll',false,null);
  document.execCommand('delete',false,null);
  document.execCommand('insertText',false,'mobi333');
  return 'filled:'+(ed.innerText||'').slice(0,20);
})()`);
console.log('[4] fill =>', JSON.stringify(fill?.result?.value));
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
console.log('[5] Enter dispatched');
await sleep(12000);

// 5) 读流验证（moble333 是否广播 + 别人聊天是否可见）
const final = await evaluate(`(function(){
  const chat=document.querySelector('.webcast-chatroom');
  const t=chat?(chat.innerText||''):'';
  return JSON.stringify({
    hasMobi:t.indexOf('mobi333')>-1,
    len:t.length,
    recent:t.slice(-500)
  });
})()`);
console.log('[6] final =>', final?.result?.value);
ws.close();
process.exit(0);
