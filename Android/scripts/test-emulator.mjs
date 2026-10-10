import {
  getPage,
  connectCDP,
  send,
  navigateAndWait,
  setInputValue,
  clickSelector,
  waitForSelector,
  screenshot,
  wait
} from './test-utils.mjs';

async function main() {
  console.log('Connecting to WebView CDP...');
  const page = await getPage();
  if (!page) throw new Error('No page found');
  console.log('Page URL:', page.url);

  const ws = await connectCDP(page.webSocketDebuggerUrl);
  await send(ws, 'Page.enable');
  await send(ws, 'Runtime.enable');
  await send(ws, 'DOM.enable');

  // Home page
  await navigateAndWait(ws, 'http://tauri.localhost/#/', '.room-form-input');
  await screenshot(ws, 'screen-home.png');

  // Fill room and click next
  await setInputValue(ws, '.room-form-input', '123456');
  await clickSelector(ws, '.room-form .btn');
  await waitForSelector(ws, '.confirm-actions', 3000);
  await screenshot(ws, 'screen-confirm.png');

  // Click confirm
  await clickSelector(ws, '.confirm-actions .btn');
  await waitForSelector(ws, '.session-bar, .bottom-nav', 3000);
  await screenshot(ws, 'screen-login.png');

  // Live page
  console.log('Navigating to live page (page 4)...');
  await navigateAndWait(ws, 'http://tauri.localhost/#/live/chat', '.cast-list, .bottom-nav', 5000);
  await screenshot(ws, 'screen-live.png');

  // Switch to data tab
  await clickSelector(ws, '.bottom-nav-item:nth-child(4)');
  await wait(500);
  await screenshot(ws, 'screen-live-data.png');

  // Switch to gift tab
  await clickSelector(ws, '.bottom-nav-item:nth-child(2)');
  await wait(500);
  await screenshot(ws, 'screen-live-gift.png');

  // Try opening login webview
  await clickSelector(ws, '.session-overlay .btn, .btn');
  await waitForSelector(ws, 'iframe, webview, #native-webview', 3000).catch(() => {});
  await screenshot(ws, 'screen-webview.png');

  console.log('Test completed without crash.');
  ws.close();
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
