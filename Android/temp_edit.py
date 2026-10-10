import re

# 1. verifyUtil.ts
path = r'c:\Users\jiuyuanjun\Desktop\project\dycast\Android\src\utils\verifyUtil.ts'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

new_func = '''/**
 * 判断输入是否为链接或短链接（含显式协议、www 前缀或带路径的域名）。
 * @param value
 */
export function isLinkOrShortUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  // 显式协议
  if (/^https?:\\/\\//i.test(trimmed)) return true;
  // www 前缀
  if (/^www\\./i.test(trimmed)) return true;
  // 带路径/参数的域名形式，如 v.douyin.com/xxxxx、live.douyin.com/123
  if (/^[a-z0-9]+([-.][a-z0-9]+)*\\.[a-z]{2,}([/?#].*|$)/i.test(trimmed)) return true;
  return false;
}

'''

content = content.replace('/**\n * 验证房间号或直播链接\n', new_func + '/**\n * 验证房间号或直播链接\n')
with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

# 2. HomePage.vue
path = r'c:\Users\jiuyuanjun\Desktop\project\dycast\Android\src\views\HomePage.vue'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    "import { resolveDouyinUrlAndExtractRoomNum } from '@/utils/verifyUtil';",
    "import { isLinkOrShortUrl, resolveDouyinUrlAndExtractRoomNum } from '@/utils/verifyUtil';"
)

old_block = '''  try {
    store.setRoomInput(input);
    const roomNum = await resolveDouyinUrlAndExtractRoomNum(input);
    if (roomNum) {
      router.push(`/confirm?room=${roomNum}`);
    } else {
      // 无法识别为房间号/链接时，按主播名称进入抖音搜索页
      router.push({ path: '/room-search', query: { keyword: input } });
    }
  } finally {'''

new_block = '''  try {
    store.setRoomInput(input);
    if (isLinkOrShortUrl(input)) {
      // 链接/短链接优先尝试提取房间号，无法提取则直接访问
      const roomNum = await resolveDouyinUrlAndExtractRoomNum(input);
      if (roomNum) {
        router.push(`/confirm?room=${roomNum}`);
        return;
      }
      router.push({ path: '/room-search', query: { url: input } });
      return;
    }
    const roomNum = await resolveDouyinUrlAndExtractRoomNum(input);
    if (roomNum) {
      router.push(`/confirm?room=${roomNum}`);
    } else {
      // 无法识别为房间号/链接时，按主播名称进入抖音搜索页
      router.push({ path: '/room-search', query: { keyword: input } });
    }
  } finally {'''

content = content.replace(old_block, new_block)
with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

# 3. RoomSearchWebviewPage.vue
path = r'c:\Users\jiuyuanjun\Desktop\project\dycast\Android\src\views\RoomSearchWebviewPage.vue'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    "const keyword = computed(() => String(route.query.keyword || ''));",
    "const keyword = computed(() => String(route.query.keyword || ''));\nconst url = computed(() => String(route.query.url || ''));"
)

old_search = '''  const searchUrl = keyword.value
    ? `https://www.douyin.com/search/${encodeURIComponent(keyword.value)}`
    : 'https://live.douyin.com';'''

new_search = '''  const targetUrl = url.value
    ? url.value
    : keyword.value
      ? `https://www.douyin.com/search/${encodeURIComponent(keyword.value)}`
      : 'https://live.douyin.com';
  const searchUrl = /^https?:\\/\\//i.test(targetUrl) ? targetUrl : 'https://' + targetUrl;'''

content = content.replace(old_search, new_search)
with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
