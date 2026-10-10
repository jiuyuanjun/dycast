// UA一致化实验 v2：reload 后轮询等编辑器就绪再发送
// 用法：node send_ua_experiment2.mjs <wsUrl> <content> [skipOverride]
const wsUrl = process.argv[2];
const content = process.argv[3] || 'desk999';
const skipOverride = process.argv[4] === 'skip';

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

if (!skipOverride) {
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
  console.log('[1] override + reload');
  await sleep(6000);
} else {
  console.log('[1] skip override');
}

// 轮询等编辑器就绪（最多 30 秒）
let filled = 'TIMEOUT';
for (let i = 0; i < 15; i++) {
  const r = await evaluate(`(function(){
    const ed=document.querySelector('[contenteditable=true].zone-container');
    if(!ed) return 'WAIT';
    ed.focus();
    document.execCommand('selectAll',false,null);
    document.execCommand('delete',false,null);
    document.execCommand('insertText',false,${JSON.stringify(content)});
    return 'filled:'+(ed.innerText||'').slice(0,20);
  })()`);
  const v = r?.result?.value || '';
  if (v !== 'WAIT') { filled = v; break; }
  await sleep(2000);
}
console.log('[2] fill =>', JSON.stringify(filled));

if (String(filled).startsWith('filled')) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  console.log('[3] Enter dispatched');
  await sleep(10000);
  const check = await evaluate(`(function(){
    const chat=document.querySelector('.webcast-chatroom');
    const t=chat?(chat.innerText||''):'';
    return JSON.stringify({len:t.length, hasMsg:t.indexOf(${JSON.stringify(content)})>-1, recent:t.slice(-260)});
  })()`);
  console.log('[4] check =>', check?.result?.value);
} else {
  console.log('[3] editor never ready, abort');
}
ws.close();
process.exit(0);
