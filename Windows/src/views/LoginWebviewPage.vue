<template>
  <div class="page">
    <AppHeader title="抖音网页登录" @back="closeAndBack" />
    <div class="page-body">
      <div id="webview-slot" class="webview-box">
        <div v-if="!webViewReady" class="hint">
          <i class="ice-keya icon"></i>
          <p>{{ statusText }}</p>
        </div>
      </div>
      <div class="webview-toolbar">
        <button class="btn secondary small" style="flex:1;" :disabled="loading" @click="closeAndBack">关闭</button>
        <button class="btn small" style="flex:1;" :disabled="loading" @click="done">已完成登录</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppHeader from '@/components/AppHeader.vue';
import { useStore } from '@/store';
import { closeDouyinLoginWindow, extractDouyinSessionid, openDouyinLoginWindowAt } from '@/utils/tauriBridge';

const router = useRouter();
const store = useStore();
const loading = ref(false);
const statusText = ref('正在打开抖音登录页面...');
const webViewReady = ref(false);
const pollTimer = ref<ReturnType<typeof setTimeout> | undefined>(undefined);
const lastWindowWidth = ref(window.innerWidth);

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
  try {
    await openDouyinLoginWindowAt(bounds);
    webViewReady.value = true;
    statusText.value = '请在上方完成登录，然后点击“已完成登录”';
    startSessionidPoll();
  } catch (err) {
    console.error('[LoginWebviewPage] open login webview failed:', err);
    statusText.value = '登录窗口打开失败，请返回重试';
  }
}

function startSessionidPoll() {
  clearTimeout(pollTimer.value);
  pollTimer.value = setTimeout(async () => {
    if (loading.value) return;
    const sid = await extractDouyinSessionid();
    if (sid) {
      await handleLoginSuccess(sid);
    } else {
      startSessionidPoll();
    }
  }, 2000);
}

async function handleLoginSuccess(sid: string) {
  clearTimeout(pollTimer.value);
  statusText.value = '登录成功，正在同步...';
  await store.setSessionid(sid);
  await closeDouyinLoginWindow();
  router.replace('/live');
}

async function done() {
  if (loading.value) return;
  loading.value = true;
  statusText.value = '正在检测登录状态...';
  webViewReady.value = false;
  const sid = await extractDouyinSessionid();
  if (sid) {
    await handleLoginSuccess(sid);
  } else {
    statusText.value = '未检测到登录状态，请完成登录后重试';
    loading.value = false;
    await placeWebView();
  }
}

async function closeAndBack() {
  loading.value = false;
  clearTimeout(pollTimer.value);
  await closeDouyinLoginWindow();
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
  clearTimeout(pollTimer.value);
  window.removeEventListener('resize', onResize);
  closeDouyinLoginWindow();
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
