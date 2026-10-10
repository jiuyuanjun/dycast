async function test() {
  const room = process.argv[2] || '994154756317';
  const url = `https://live.douyin.com/${room}`;
  console.log('Fetching', url);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0',
      'Referer': 'https://live.douyin.com/',
      'Origin': 'https://live.douyin.com'
    }
  });
  const html = await res.text();
  console.log('Status:', res.status, 'Length:', html.length);

  const matchRes = html.match(
    /<script\snonce="\S+?"\s>self\.__pace_f\.push\(\[1,"[a-z]?:\[\\"\$\\",\\"\$L\d+\\",null,([\s\S]+?state[\s\S]+?)\]\\n"\]\)<\/script>/
  );
  if (!matchRes) {
    console.log('no match');
    return;
  }
  let json = matchRes[1].replace(/\\{1,7}"/g, '"');
  console.log('\n--- json start (first 1000 chars) ---');
  console.log(json.slice(0, 1000));

  // Find roomInfo block
  const idx = json.indexOf('"roomInfo"');
  console.log('roomInfo index:', idx);
  if (idx < 0) {
    console.log('no roomInfo');
    return;
  }
  // Extract roomInfo block by matching braces
  let depth = 0;
  let inString = false;
  let escape = false;
  let start = idx + '"roomInfo"'.length;
  // Skip colon
  while (start < json.length && json[start] !== '{') start++;
  let end = start;
  for (; end < json.length; end++) {
    const ch = json[end];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"' && !inString) {
      inString = true;
    } else if (ch === '"' && inString) {
      inString = false;
    } else if (!inString) {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          end++;
          break;
        }
      }
    }
  }
  const roomInfo = json.slice(start, end);
  console.log('\n--- roomInfo snippet (first 2000 chars) ---');
  console.log(roomInfo.slice(0, 2000));

  // Search for count-related fields
  const countMatches = roomInfo.match(/"\w*[Cc]ount\w*":"?[^",\}]+"?/g) || [];
  console.log('\n--- count fields ---');
  console.log([...new Set(countMatches)].slice(0, 100).join('\n'));

  const userMatches = roomInfo.match(/"\w*[Uu]ser\w*":"?[^",\}]+"?/g) || [];
  console.log('\n--- user fields ---');
  console.log([...new Set(userMatches)].slice(0, 100).join('\n'));

  const statMatches = roomInfo.match(/"stats":\{[\s\S]*?\}/g) || [];
  console.log('\n--- stats fields ---');
  console.log([...new Set(statMatches)].slice(0, 10).join('\n'));



test().catch(console.error);
