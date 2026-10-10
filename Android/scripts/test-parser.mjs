import { parseLiveHtml } from './src/core/util.ts';

const room = process.argv[2] || '123456';
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
const info = parseLiveHtml(html);
console.log('Parsed:', JSON.stringify(info, null, 2));
