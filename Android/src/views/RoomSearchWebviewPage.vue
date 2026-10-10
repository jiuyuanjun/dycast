<template>
  <div class="page">
    <AppHeader title="抖音直播搜索" @back="closeAndBack" />
    <div class="page-body">
      <div id="webview-slot" class="webview-box">
        <div v-if="!webViewReady" class="hint">
          <i class="ice-douyin icon"></i>
          <p>{{ statusText }}</p>
        </div>
      </div>
      <div class="webview-toolbar">
        <button class="btn secondary small" style="flex:1;" :disabled="loading" @click="closeAndBack">关闭</button>
        <button class="btn small" style="flex:1;" :disabled="loading" @click="selectRoom">选择这个直播间</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppHeader from '@/components/AppHeader.vue';
import { closeDouyinRoomSearchWindow, extractDouyinRoomUrl, openDouyinRoomSearchAt } from '@/utils/tauriBridge';
import { verifyRoomInput } from '@/utils/verifyUtil';

const router = useRouter();
const route = useRoute();
const loading = ref(false);
const statusText = ref('正在打开抖音直播搜索...');
const webViewReady = ref(false);
const lastWindowWidth = ref(window.innerWidth);
const keyword = computed(() => String(route.query.keyword || ''));
const url = computed(() => String(route.query.url || ''));

async function placeWebView() {
  const slot = document.getElementById('webview-slot');
  if (!slot) return;
  const rect = slot.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const bounds = {
    x: Math.round(rect.left * dpr),
    y: Math.round(rect.top * dpr),
    width: Math.round(rect.width * dpr),
    height: Math.round(rect.height * dpr),
  };
  const targetUrl = url.value
    ? url.value
    : keyword.value
      ? `https://www.douyin.com/search/${encodeURIComponent(keyword.value)}`
      : 'https://live.douyin.com';
  const searchUrl = /^https?:\/\//i.test(targetUrl) ? targetUrl : 'https://' + targetUrl;
  try {
    await openDouyinRoomSearchAt(bounds, searchUrl);
    webViewReady.value = true;
    statusText.value = '请在上方搜索或进入直播间，然后点击“选择这个直播间”';
  } catch (err) {
    console.error('[RoomSearchWebviewPage] open search webview failed:', err);
    statusText.value = '搜索窗口打开失败，请返回重试';
  }
}

function extractRoomNum(url: string | null): string | null {
  if (!url) return null;
  // 只认可靠模式：live.douyin.com/{房间号} 与 www.douyin.com/root/live/{房间号}。
  // 不能把任意路径末段数字当房间号——reflow 路径里是 19 位 room_id 而非 webRid，
  // 误提取会导致假阳性进确认页（见 agent.md 16.3 Bug A）。
  const liveMatch = url.match(/live\.douyin\.com\/(\d{5,20})(?:[/?&]|$)/);
  if (liveMatch) return liveMatch[1];
  const rootLiveMatch = url.match(/www\.douyin\.com\/root\/live\/(\d{5,20})(?:[/?&]|$)/);
  if (rootLiveMatch) return rootLiveMatch[1];
  return null;
}

async function selectRoom() {
  if (loading.value) return;
  loading.value = true;
  statusText.value = '正在获取直播间地址...';
  const url = await extractDouyinRoomUrl();
  const roomNum = extractRoomNum(url);
  if (roomNum && verifyRoomInput(roomNum).flag) {
    await closeDouyinRoomSearchWindow();
    router.replace({ path: '/', query: { room: roomNum } });
  } else {
    statusText.value = '未识别到直播间号，请进入直播间页面后重试';
    loading.value = false;
  }
}

async function closeAndBack() {
  loading.value = false;
  await closeDouyinRoomSearchWindow();
  router.back();
}

function onResize() {
  // Ignore resizes caused by the soft keyboard (height changes, width stays the same).
  const width = window.innerWidth;
  if (Math.abs(width - lastWindowWidth.value) < 10) return;
  lastWindowWidth.value = width;
  if (webViewReady.value) {
    placeWebView();
  }
}

onMounted(() => {
  placeWebView();
  window.addEventListener('resize', onResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', onResize);
  closeDouyinRoomSearchWindow();
});
</script>

<style scoped lang="scss">
.page {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.page-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
}
.webview-box {
  flex: 1;
  background: var(--loading-bg);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--tip);
  font-size: 11px;
  margin-bottom: 8px;
  overflow: hidden;
  text-align: center;
  position: relative;
  .hint {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    .icon {
      font-size: 32px;
      color: var(--theme);
    }
    p {
      margin: 0;
      padding: 0 20px;
      line-height: 1.5;
    }
  }
}
.webview-toolbar {
  display: flex;
  gap: 6px;
}
.btn {
  width: 100%;
  padding: 8px;
  border: none;
  border-radius: 6px;
  background: var(--theme);
  color: var(--white);
  font-size: 12px;
  font-weight: bold;
  cursor: pointer;
}
.btn.secondary {
  background: var(--white);
  color: var(--text);
  border: 1px solid var(--bd);
}
.btn.small {
  padding: 5px 8px;
  font-size: 10px;
}
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
