// 视口正常化实验：让发送 WebView 的聊天流渲染，建立可靠的"广播观察点"
// 用法：node viewport_experiment.mjs <wsUrl> <content>
const wsUrl = process.argv[2];
const content = process.argv[3] || 'obs111';

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

// 1) 模拟正常手机视口（只是布局层面，不碰 UA）
await send('Emulation.setDeviceMetricsOverride', {
  width: 1080, height: 1920, deviceScaleFactor: 1, mobile: true,
});
console.log('[1] viewport set 1080x1920');
await sleep(5000);

// 2) 观察聊天流是否渲染出别人的聊天弹幕
const obs0 = await evaluate(`(function(){
  const chat=document.querySelector('.webcast-chatroom');
  const t=chat?(chat.innerText||''):'';
  return JSON.stringify({len:t.length, sample:t.slice(-400)});
})()`);
console.log('[2] chat stream before =>', obs0?.result?.value);

// 3) 编辑器发探针
let filled = 'TIMEOUT';
for (let i = 0; i < 10; i++) {
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
console.log('[3] fill =>', JSON.stringify(filled));

if (String(filled).startsWith('filled')) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  console.log('[4] Enter dispatched');
  await sleep(12000);
  const obs1 = await evaluate(`(function(){
    const chat=document.querySelector('.webcast-chatroom');
    const t=chat?(chat.innerText||''):'';
    return JSON.stringify({hasMsg:t.indexOf(${JSON.stringify(content)})>-1, len:t.length, recent:t.slice(-500)});
  })()`);
  console.log('[5] onscreen =>', obs1?.result?.value);
}
ws.close();
process.exit(0);
