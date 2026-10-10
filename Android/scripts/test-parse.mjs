// Test parseLiveHtml against Douyin HTML
async function test() {
  const url = 'https://live.douyin.com/123456';
  console.log('Fetching', url);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0',
      'Referer': 'https://live.douyin.com/',
      'Origin': 'https://live.douyin.com'
    }
  });
  const html = await res.text();
  console.log('status', res.status, 'length', html.length);

  const matchRes = html.match(
    /<script\snonce="\S+?"\s>self\.__pace_f\.push\(\[1,"[a-z]?:\[\\"\$\\",\\"\$L\d+\\",null,([\s\S]+?state[\s\S]+?)\]\\n"\]\)<\/script>/
  );
  console.log('matchRes', !!matchRes);
  if (matchRes) {
    let json = matchRes[1];
    json = json.replace(/\\{1,7}"/g, '"');
    const roomIdMatch = /{"state":{[\s\S]*?"roomStore":{[\s\S]*?"roomInfo":{[\s\S]*?"roomId":"([0-9]+?)"/.exec(json);
    console.log('roomIdMatch', roomIdMatch?.[1]);
  }

  // Inline parseLiveHtml
  const REGMAP = {
    roomId: /{"state":{[\s\S]*?"roomStore":{[\s\S]*?"roomInfo":{[\s\S]*?"roomId":"([0-9]+?)"/,
    uniqueId: /{"state":{[\s\S]*?"userStore":{[\s\S]*?"odin":{[\s\S]*?"user_unique_id":"([0-9]+?)"/,
    avatar: /{"state":{[\s\S]*?"roomStore":{[\s\S]*?"roomInfo":{[\s\S]*?"anchor":{[\s\S]*?"avatar_thumb":{[\s\S]*?"url_list":\["([\S]+?)"/,
    cover: /{"state":{[\s\S]*?"roomStore":{[\s\S]*?"roomInfo":{[\s\S]*?"room":{[\s\S]*?"cover":{[\s\S]*?"url_list":\["([\S]+?)"/,
    nickname: /{"state":{[\s\S]*?"roomStore":{[\s\S]*?"roomInfo":{[\s\S]*?"anchor":{[\s\S]*?"nickname":"([\s\S]+?)"/,
    title: /{"state":{[\s\S]*?"roomStore":{[\s\S]*?"roomInfo":{[\s\S]*?"room":{[\s\S]*?"title":"([\s\S]+?)"/,
    status: /{"state":{[\s\S]*?"roomStore":{[\s\S]*?"roomInfo":{[\s\S]*?"room":{[\s\S]*?"status":([0-9]{1})/
  };
  function extractJsonField(name, json) {
    const reg = REGMAP[name];
    if (!reg) return '';
    const exec = reg.exec(json);
    return exec ? exec[1] : '';
  }
  function decodeUnicodeUrl(url) {
    return url ? url.replace(/\\u0026/g, '&') : url;
  }
  if (!matchRes) {
    console.log('no match');
    return;
  }
  let json = matchRes[1].replace(/\\{1,7}"/g, '"');
  const roomId = extractJsonField('roomId', json);
  const uniqueId = extractJsonField('uniqueId', json);
  const avatar = extractJsonField('avatar', json);
  const cover = extractJsonField('cover', json);
  const nickname = extractJsonField('nickname', json);
  const title = extractJsonField('title', json);
  const status = extractJsonField('status', json);
  console.log('parsed', JSON.stringify({ roomId, uniqueId, avatar: decodeUnicodeUrl(avatar), cover: decodeUnicodeUrl(cover), nickname, title, status: parseInt(status || '4') }, null, 2));
}

test().catch(console.error);
