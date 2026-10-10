// 提取 LIVE_SSR_DATA_ID 与其余所有内联 script JSON
const fs = require('fs');
const html = fs.readFileSync('live_room_node.html', 'utf-8');

// 1. LIVE_SSR_DATA_ID
const ssrMatch = html.match(/<script id="LIVE_SSR_DATA_ID"[^>]*>([\s\S]+?)<\/script>/);
console.log('=== LIVE_SSR_DATA_ID found:', !!ssrMatch);
if (ssrMatch) {
  const raw = ssrMatch[1];
  fs.writeFileSync('live_ssr_raw.txt', raw.slice(0, 2000000));
  try {
    const data = JSON.parse(raw);
    fs.writeFileSync('live_ssr_data.json', JSON.stringify(data, null, 1));
    console.log('top keys:', Object.keys(data).join(', '));
    // 递归打印结构（值截断）
    function dump(obj, path, depth) {
      if (depth > 3 || !obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        console.log(path + '[] len=' + obj.length);
        if (obj.length) dump(obj[0], path + '[0]', depth + 1);
        return;
      }
      const keys = Object.keys(obj);
      console.log(path + ': {' + keys.join(', ') + '}');
      for (const k of keys) {
        const v = obj[k];
        if (v && typeof v === 'object') dump(v, path + '.' + k, depth + 1);
        else {
          const s = String(v).slice(0, 60);
          console.log(path + '.' + k + ' = [' + typeof v + '] ' + s);
        }
      }
    }
    dump(data, 'root', 0);
  } catch (e) {
    console.log('LIVE_SSR parse failed:', e.message);
    console.log('raw head:', raw.slice(0, 500));
  }
}

// 2. 所有 inline <script>（非 src）的头部识别
const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || [];
console.log('\n=== total inline scripts:', scripts.length);
scripts.forEach((s, i) => {
  const head = s.replace(/<script[^>]*>/, '').slice(0, 120).replace(/\s+/g, ' ');
  const idM = s.match(/<script[^>]*id="([^"]+)"/);
  const label = idM ? `[id=${idM[1]}]` : `[#${i}]`;
  console.log(label, head.slice(0, 110));
});
