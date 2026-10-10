import WebSocket from 'ws';
import http from 'http';
import fs from 'fs';

const CDP_URL = 'http://127.0.0.1:9222/json/list';

function getPage() {
  return new Promise((resolve, reject) => {
    http.get(CDP_URL, (res) => {
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
    const handler = (data) => {
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

async function evaluate(ws, expression, awaitPromise = true) {
  const res = await send(ws, 'Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (res && res.result && res.result.subtype === 'error') {
    throw new Error(`CDP evaluate error: ${res.result.description}`);
  }
  return res && res.result ? res.result.value : undefined;
}

async function navigate(ws, url) {
  await send(ws, 'Page.navigate', { url });
  await new Promise(r => setTimeout(r, 2500));
}

async function screenshot(ws, filename) {
  const result = await send(ws, 'Page.captureScreenshot', { format: 'png' });
  if (result && result.data) {
    fs.writeFileSync(filename, Buffer.from(result.data, 'base64'));
    console.log('Screenshot saved:', filename);
  }
}

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getHref(ws) {
  return evaluate(ws, `(function(){ return location.href; })()`);
}

async function main() {
  const page = await getPage();
  if (!page) throw new Error('No page found');
  console.log('Page URL:', page.url);
  const ws = await connectCDP(page.webSocketDebuggerUrl);
  await send(ws, 'Page.enable');
  await send(ws, 'Runtime.enable');

  // 1. Go to home
  await navigate(ws, 'http://tauri.localhost/#/');
  await screenshot(ws, 'screen-home-search-v2.png');
  console.log('Home URL:', await getHref(ws));

  // 2. Click search button and verify navigation to /room-search
  const btnRes = await evaluate(ws, `
    (function() {
      const btn = document.querySelector('.search-btn');
      if (btn) { btn.click(); return 'clicked'; }
      return 'not found';
    })()
  `);
  console.log('Search button:', btnRes);
  await wait(3000);
  await screenshot(ws, 'screen-room-search-v2.png');
  const roomSearchUrl = await getHref(ws);
  console.log('Room search URL:', roomSearchUrl);
  if (!roomSearchUrl.includes('/room-search')) {
    throw new Error(`Expected /room-search but got ${roomSearchUrl}`);
  }

  // 3. Verify the room search page has the webview placeholder and select button
  const pageCheck = await evaluate(ws, `
    (function() {
      const slot = document.getElementById('webview-slot');
      const selectBtn = document.querySelector('.webview-toolbar .btn:not(.secondary)');
      const closeBtn = document.querySelector('.webview-toolbar .btn.secondary');
      return {
        hasSlot: !!slot,
        hasSelectBtn: !!selectBtn,
        selectBtnText: selectBtn ? selectBtn.textContent : null,
        hasCloseBtn: !!closeBtn,
        closeBtnText: closeBtn ? closeBtn.textContent : null
      };
    })()
  `);
  console.log('Room search page check:', JSON.stringify(pageCheck));

  // 4. Click close button and verify back to home
  const closeRes = await evaluate(ws, `
    (function() {
      const btn = document.querySelector('.webview-toolbar .btn.secondary');
      if (btn) { btn.click(); return 'clicked'; }
      return 'not found';
    })()
  `);
  console.log('Close button:', closeRes);
  await wait(2000);
  await screenshot(ws, 'screen-home-after-close-v2.png');
  const homeUrlAfterClose = await getHref(ws);
  console.log('Home URL after close:', homeUrlAfterClose);
  if (!homeUrlAfterClose.endsWith('#/')) {
    throw new Error(`Expected home but got ${homeUrlAfterClose}`);
  }

  // 5. Simulate room selection by navigating to /?room=<test-room>
  //    and verify the input is filled.
  const testRoom = '85227334761';
  await navigate(ws, `http://tauri.localhost/#/?room=${testRoom}`);
  await wait(2500);
  await screenshot(ws, 'screen-home-with-room-v2.png');
  const inputValue = await evaluate(ws, `
    (function() {
      const input = document.querySelector('.room-form-input');
      return input ? input.value : 'no input';
    })()
  `);
  console.log('Room input value:', inputValue);
  if (inputValue !== testRoom) {
    throw new Error(`Expected input ${testRoom} but got ${inputValue}`);
  }

  ws.close();
  console.log('All checks passed.');
}

main().catch(err => { console.error(err); process.exit(1); });
