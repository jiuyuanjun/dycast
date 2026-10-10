// 在登录 WebView 页面上下文：提取在播直播间房间号 + 点击"登录"按钮
const wsUrl = process.argv[2];

const ws = new WebSocket(wsUrl);
ws.onopen = () => {
  const expr = `(function(){
    var found = [];
    document.querySelectorAll('a').forEach(function(a){
      var h = a.href || '';
      var m = h.match(/live\\.douyin\\.com\\/([0-9]{6,})/);
      if (m && found.indexOf(m[1]) < 0) found.push(m[1]);
    });
    var lc = false;
    document.querySelectorAll('button, a, div, span').forEach(function(el){
      if (lc) return;
      var t = (el.textContent || '').trim();
      if (t === '登录' && el.offsetParent !== null) { el.click(); lc = true; }
    });
    return JSON.stringify({ rooms: found.slice(0, 12), loginClicked: lc });
  })()`;
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
};
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id === 1) {
    console.log('RESULT:', JSON.stringify(m.result?.result?.value ?? m.result));
    process.exit(0);
  }
};
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 10000);
