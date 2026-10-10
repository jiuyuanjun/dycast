const WebSocket = require('ws');

const PAGE_ID = process.argv[2];
if (!PAGE_ID) {
  console.error('Usage: node cdp-login.cjs <page-id>');
  process.exit(1);
}

const WS_URL = `ws://localhost:9222/devtools/page/${PAGE_ID}`;
const ws = new WebSocket(WS_URL);

let msgId = 0;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

ws.on('open', async () => {
  try {
    await send('Runtime.enable');

    console.log('Clicking login button...');
    await send('Runtime.evaluate', {
      expression: `document.querySelector('.page-body .btn')?.click();`,
      returnByValue: true
    });

    await sleep(5000);

    const urlRes = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
    console.log('URL:', urlRes.result.value);

    const bodyRes = await send('Runtime.evaluate', {
      expression: `document.body.innerText.slice(0, 300)`,
      returnByValue: true
    });
    console.log('Body:', bodyRes.result.value);

    ws.close();
  } catch (err) {
    console.error('CDP error:', err);
    ws.close();
    process.exit(1);
  }
});

ws.on('message', data => {
  const msg = JSON.parse(data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  }
});

ws.on('error', err => {
  console.error('WebSocket error:', err.message);
  process.exit(1);
});
