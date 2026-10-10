// 用 CDP Input.dispatchKeyEvent 发送真实 Enter 键（isTrusted=true）
// 用法：node cdp_enter.mjs <wsUrl>
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

const ws = await connect(wsUrl);
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};

await send('Input.dispatchKeyEvent', {
  type: 'keyDown', key: 'Enter', code: 'Enter',
  windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r',
});
await send('Input.dispatchKeyEvent', {
  type: 'keyUp', key: 'Enter', code: 'Enter',
  windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
});
console.log('real Enter dispatched');
ws.close();
process.exit(0);
