import {
  getPage, connectCDP, waitForSelector, setInputValue,
  clickSelector, screenshot, evaluate, wait
} from './test-utils.mjs';

const LONG_URL = 'https://www.douyin.com/root/live/271664729162?anchor_id=1634298947436922&api_path=%2Faweme%2Fv1%2Fweb%2Fmodule%2Ffeed%2F';

async function main() {
  const page = await getPage();
  if (!page) throw new Error('No Tauri page found');
  console.log('CDP page:', page.url);

  const ws = await connectCDP(page.webSocketDebuggerUrl);
  console.log('CDP connected');

  await waitForSelector(ws, '.room-form-input', 5000);
  console.log('Home input found');

  await setInputValue(ws, '.room-form-input', LONG_URL);
  console.log('Input set');
  await wait(500);

  await clickSelector(ws, '.btn');
  console.log('Next clicked');
  await wait(3000);

  await screenshot(ws, `realdevice_url_test_${new Date().toISOString().slice(0,19).replace(/:/g,'')}.png`);

  const currentPath = await evaluate(ws, `location.pathname`);
  console.log('Current path:', currentPath?.result?.value);

  ws.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
