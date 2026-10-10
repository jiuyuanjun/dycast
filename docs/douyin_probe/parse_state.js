// 解析直播间 HTML，盘点页面内嵌的所有数据字段
const fs = require('fs');
const html = fs.readFileSync('live_room_node.html', 'utf-8');

function walk(obj, path, out, depth = 0) {
  if (!obj || typeof obj !== 'object') return;
  if (depth > 4) return;
  if (Array.isArray(obj)) {
    if (obj.length) walk(obj[0], path + '[0]', out, depth + 1);
    return;
  }
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === 'object') {
      walk(v, path + '.' + k, out, depth + 1);
    } else {
      out[path + '.' + k] = typeof v === 'string' ? v.slice(0, 80) : v;
    }
  }
}

// ---- 1. __pace_f 里的 state JSON ----
const paceMatch = html.match(
  /<script\snonce="\S+?"\s>self\.__pace_f\.push\(\[1,"[a-z]?:\[\\"\$\\",\\"\$L\d+\\",null,([\s\S]+?)\]\\n"\]\)<\/script>/
);
console.log('=== __pace_f script found:', !!paceMatch);
if (paceMatch) {
  let json = paceMatch[1].replace(/\\{1,7}"/g, '"');
  fs.writeFileSync('state_raw.txt', json.slice(0, 300000));
  try {
    const data = JSON.parse(json);
    console.log('state top keys:', Object.keys(data).join(', '));
    // roomStore 全量盘点
    const roomStore = data.state?.roomStore || {};
    const ri = roomStore.roomInfo || {};
    console.log('\n--- roomStore.roomInfo keys ---');
    console.log(Object.keys(ri).join(', '));
    if (ri.room) {
      console.log('\n--- roomInfo.room fields ---');
      for (const k of Object.keys(ri.room)) {
        const v = ri.room[k];
        const t = typeof v;
        const s = t === 'object' ? JSON.stringify(v).slice(0, 120) : String(v).slice(0, 120);
        console.log(`  ${k}: [${t}] ${s}`);
      }
    }
    if (ri.anchor) {
      console.log('\n--- roomInfo.anchor fields ---');
      for (const k of Object.keys(ri.anchor)) {
        const v = ri.anchor[k];
        const t = typeof v;
        const s = t === 'object' ? JSON.stringify(v).slice(0, 120) : String(v).slice(0, 120);
        console.log(`  ${k}: [${t}] ${s}`);
      }
    }
    if (ri.stats) {
      console.log('\n--- roomInfo.stats fields ---');
      for (const k of Object.keys(ri.stats)) {
        const v = ri.stats[k];
        const t = typeof v;
        const s = t === 'object' ? JSON.stringify(v).slice(0, 120) : String(v).slice(0, 120);
        console.log(`  ${k}: [${t}] ${s}`);
      }
    }
    // roomStore 其他 key
    console.log('\n--- roomStore other keys ---');
    for (const k of Object.keys(roomStore)) {
      if (k === 'roomInfo') continue;
      const v = roomStore[k];
      const s = v && typeof v === 'object' ? JSON.stringify(v).slice(0, 100) : String(v).slice(0, 100);
      console.log(`  ${k}: ${s}`);
    }
    // userStore
    const us = data.state?.userStore || {};
    console.log('\n--- userStore keys ---');
    for (const k of Object.keys(us)) {
      const v = us[k];
      const s = v && typeof v === 'object' ? JSON.stringify(v).slice(0, 100) : String(v).slice(0, 100);
      console.log(`  ${k}: ${s}`);
    }
    // 其他 state key
    console.log('\n--- state other keys ---');
    const st = data.state || {};
    for (const k of Object.keys(st)) {
      if (k === 'roomStore' || k === 'userStore') continue;
      const v = st[k];
      const s = v && typeof v === 'object' ? JSON.stringify(v).slice(0, 100) : String(v).slice(0, 100);
      console.log(`  ${k}: ${s}`);
    }
  } catch (e) {
    console.log('pace_f JSON.parse failed:', e.message);
  }
}

// ---- 2. RENDER_DATA ----
const rdMatch = html.match(/<script id="RENDER_DATA" type="application\/json">([\s\S]+?)<\/script>/);
console.log('\n=== RENDER_DATA script found:', !!rdMatch);
if (rdMatch) {
  try {
    const decoded = decodeURIComponent(rdMatch[1]);
    const rd = JSON.parse(decoded);
    fs.writeFileSync('render_data.json', JSON.stringify(rd, null, 1));
    console.log('RENDER_DATA top keys:', Object.keys(rd).join(', '));
    for (const k of Object.keys(rd)) {
      const v = rd[k];
      if (v && typeof v === 'object') {
        console.log(`  ${k}: {${Object.keys(v).join(', ')}}`);
      } else {
        console.log(`  ${k}: ${typeof v}`);
      }
    }
  } catch (e) {
    console.log('RENDER_DATA parse failed:', e.message);
  }
}

// ---- 3. data-* 属性 ----
const attrs = ['anchor-info', 'player-params', 'room-info', 'live-info'];
for (const a of attrs) {
  const m = html.match(new RegExp(`data-${a}="([\\s\\S]+?)"`));
  if (m) {
    console.log(`\ndata-${a}:`, m[1].slice(0, 200));
  } else {
    console.log(`\ndata-${a}: (not found)`);
  }
}

// ---- 4. og: meta 标签 ----
const metas = html.match(/<meta[^>]+(?:og:|name="description")[^>]*>/g) || [];
console.log('\n=== meta tags ===');
for (const m of metas.slice(0, 20)) {
  const clean = m.replace(/\s+/g, ' ').slice(0, 250);
  console.log(' ', clean);
}
