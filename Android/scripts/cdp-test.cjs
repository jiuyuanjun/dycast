const WebSocket = require('ws');

const PAGE_ID = process.argv[2];
if (!PAGE_ID) {
  console.error('Usage: node cdp-test.cjs <page-id>');
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

async function getUrl() {
  const r = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
  return r.result.value;
}

async function getHeader() {
  const r = await send('Runtime.evaluate', {
    expression: `document.querySelector('.app-header-title')?.textContent || ''`,
    returnByValue: true
  });
  return r.result.value;
}

async function evalExpr(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r.result.value;
}

ws.on('open', async () => {
  try {
    await send('Runtime.enable');
    await send('DOM.enable');
    await send('Page.enable');

    console.log('Step 1: fill room input and click next');
    await send('Runtime.evaluate', {
      expression: `
        const input = document.querySelector('.room-form-input');
        input.value = '994154756317';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      `,
      returnByValue: true
    });
    await sleep(500);
    await send('Runtime.evaluate', {
      expression: `document.querySelector('.room-form .btn')?.click();`,
      returnByValue: true
    });

    await sleep(3000);
    console.log('URL:', await getUrl());
    console.log('Header:', await getHeader());

    if ((await getHeader()) !== '确认主播') {
      console.error('ERROR: did not reach confirm page');
      ws.close();
      process.exit(1);
    }

    console.log('Step 2: wait for confirm page data');
    await sleep(3000);
    const liveStatus = await evalExpr(`document.querySelector('.info-row:nth-child(3) .v')?.textContent?.trim() || ''`);
    console.log('Live status:', liveStatus);
    const confirmBtn = await evalExpr(`!!document.querySelector('.confirm-actions .btn:not(.secondary)')`);
    console.log('Confirm button visible:', confirmBtn);

    if (confirmBtn) {
      console.log('Step 3: click confirm button');
      await send('Runtime.evaluate', {
        expression: `document.querySelector('.confirm-actions .btn:not(.secondary)')?.click();`,
        returnByValue: true
      });
      await sleep(2000);
      console.log('URL after confirm:', await getUrl());
      console.log('Header after confirm:', await getHeader());

      if ((await getHeader()) === '登录抖音账号') {
        console.log('SUCCESS: reached login page (page 3)');
      } else {
        console.error('ERROR: did not reach login page, current header:', await getHeader());
      }
    } else {
      console.log('Confirm button not visible (room may not be live). Cannot test 2->3->4 flow.');
    }

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
