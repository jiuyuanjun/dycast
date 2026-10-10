<template>
  <div class="page">
    <AppHeader title="抖音直播弹幕助手" :show-back="false" />
    <div class="page-body center" :class="{ 'is-landscape': isLandscape }">
      <div class="room-form">
        <img class="app-icon" src="../../app-icon.png" alt="应用图标" />
        <h2 class="room-form-title">连接直播间</h2>
        <p class="room-form-subtitle">输入房间号和直播链接开始使用</p>
        <input v-model="roomInput" class="room-form-input" placeholder="房间号 / 直播链接" />
        <!-- 实时输入识别：主动判断用户输入的是哪种情况 -->
        <div v-if="inputAnalysis" class="input-analysis">
          <span class="analysis-tag">{{ analysisTag }}</span>
          <span class="analysis-info">{{ analysisInfo }}</span>
        </div>
        <button class="btn" :disabled="!valid || loading" @click="next">{{ loading ? '解析中...' : '下一步' }}</button>
        <p v-if="analyzeResult" class="analyze-result" :class="analyzeResult.ok ? 'ok' : 'bad'">{{ analyzeResult.text }}</p>
      </div>
      <div v-if="store.state.recentRooms.length" class="recent-section recent-pills-wrap">
        <p class="recent-title">最近进入</p>
        <div class="recent-pills">
          <span
            v-for="room in store.state.recentRooms"
            :key="room.roomNum"
            class="recent-pill"
            @click="fillRoom(room.roomNum)">
            {{ room.nickname || room.roomNum }} <span class="rp-id">{{ room.roomNum }}</span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppHeader from '@/components/AppHeader.vue';
import { useStore } from '@/store';
import { resolveRoomInput, type ResolvedRoom } from '@/core/roomResolver';
import { analyzeInputType, extractAnchorIdFromUrl, resolveDouyinUrlAndExtractRoomNum, type InputAnalysis } from '@/utils/verifyUtil';
import { debounce } from '@/utils/loashUtil';
import { useLandscape } from '@/composables/useOrientation';

const router = useRouter();
const route = useRoute();
const store = useStore();
const isLandscape = useLandscape();
const roomInput = ref(store.state.roomInput || '');
const loading = ref(false);
const valid = computed(() => roomInput.value.trim().length > 0);
/** 实时输入类型分析（纯前端判定，无网络请求） */
const inputAnalysis = ref<InputAnalysis | null>(null);
/** 解析结果（展现给用户） */
const analyzeResult = ref<{ ok: boolean; text: string } | null>(null);

/** 输入类型徽标 */
const analysisTag = computed(() => {
  switch (inputAnalysis.value?.type) {
    case 'roomNum': return '房间号';
    case 'liveUrl': return '直播间链接';
    case 'shareText': return '分享文案';
    default: return '无法识别';
  }
});
/** 输入类型识别信息 */
const analysisInfo = computed(() => {
  const analysis = inputAnalysis.value;
  if (!analysis) return '';
  switch (analysis.type) {
    case 'roomNum': return `识别到房间号 ${analysis.roomNum}`;
    case 'liveUrl': return analysis.roomNum ? `识别到直链，房间号 ${analysis.roomNum}` : '识别到抖音链接，将尝试解析房间号';
    case 'shareText': return '检测到分享短链，将自动解析真实房间号';
    default: return '不支持该输入，请输入房间号或直播间链接';
  }
});

/** 短链解析结果缓存：同一短链不重复请求 */
const resolveCache = new Map<string, string>();
/** 进行中的短链解析（自动解析与下一步共用，避免并发重复请求） */
let resolvingUrl = '';
let resolvingPromise: Promise<string> | null = null;

/**
 * 解析短链真实房间号（带缓存与并发复用）
 */
function resolveShortLinkRoomNum(url: string): Promise<string> {
  if (resolveCache.has(url)) return Promise.resolve(resolveCache.get(url) as string);
  if (resolvingPromise && resolvingUrl === url) return resolvingPromise;
  resolvingUrl = url;
  resolvingPromise = (async () => {
    try {
      const roomNum = await resolveDouyinUrlAndExtractRoomNum(url);
      resolveCache.set(url, roomNum);
      return roomNum;
    } finally {
      resolvingPromise = null;
      resolvingUrl = '';
    }
  })();
  return resolvingPromise;
}

/** 展现短链解析结果（输入已变化时丢弃） */
function showResolveResult(url: string, roomNum: string) {
  if (inputAnalysis.value?.type !== 'shareText' || inputAnalysis.value.url !== url) return;
  if (roomNum) {
    analyzeResult.value = { ok: true, text: `解析成功，房间号 ${roomNum}，点击下一步进入直播间` };
  } else {
    analyzeResult.value = { ok: false, text: '自动解析失败，点击下一步将打开抖音页面手动选择直播间' };
  }
}

/** 粘贴分享文案后主动解析短链（防抖 600ms） */
const scheduleAutoResolve = debounce((analysis: InputAnalysis) => {
  if (analysis.type !== 'shareText' || !analysis.url) return;
  const url = analysis.url;
  if (resolveCache.has(url)) {
    showResolveResult(url, resolveCache.get(url) as string);
    return;
  }
  analyzeResult.value = { ok: true, text: `识别到分享短链 ${url}，正在解析真实房间号…` };
  resolveShortLinkRoomNum(url).then(roomNum => showResolveResult(url, roomNum));
}, 600);

watch(
  roomInput,
  val => {
    const trimmed = val.trim();
    inputAnalysis.value = trimmed ? analyzeInputType(trimmed) : null;
    // 输入变化后清掉上一轮解析结果，等新一轮分析/解析后再展现
    analyzeResult.value = null;
    if (!trimmed) {
      scheduleAutoResolve.cancel();
      return;
    }
    scheduleAutoResolve(inputAnalysis.value as InputAnalysis);
  },
  { immediate: true }
);

async function next() {
  const input = roomInput.value.trim();
  if (!input) return;
  loading.value = true;
  analyzeResult.value = null;
  try {
    store.setRoomInput(input);
    const analysis = analyzeInputType(input);
    // 统一输入归一化入口：房间号 / 直链 / 短链都走 resolveRoomInput 解析（含网络短链）
    const resolved: ResolvedRoom | null = await resolveRoomInput(input);
    // 类型一：纯数字房间号
    if (analysis.type === 'roomNum' || (resolved && resolved.webRid && resolved.type === 'roomNum')) {
      store.setAnchorId('');
      analyzeResult.value = { ok: true, text: `识别到房间号 ${analysis.roomNum}，正在获取直播信息` };
      router.push(`/confirm?room=${analysis.roomNum}`);
      return;
    }
    // 类型二：直播间直链（房间号可直接提取 / 已解析出房间号）
    if (analysis.type === 'liveUrl' || resolved?.type === 'liveUrl') {
      store.setAnchorId(resolved?.anchorId || extractAnchorIdFromUrl(analysis.url || input));
      if (resolved?.webRid || analysis.roomNum) {
        const webRid = resolved?.webRid || analysis.roomNum as string;
        analyzeResult.value = { ok: true, text: `识别到直播链接，房间号 ${webRid}` };
        router.push(`/confirm?room=${webRid}`);
        return;
      }
      // 链接里提取不到房间号：交给 WebView（真浏览器 JS 会自动跳转到直播间页面）
      analyzeResult.value = { ok: false, text: '未能从链接中识别房间号，已打开抖音页面：请进入直播间后点击「选择这个直播间」' };
      router.push({ path: '/room-search', query: { url: analysis.url || input } });
      return;
    }
    // 类型三：分享文案夹短链（统一入口 resolveRoomInput 已解析）
    if (analysis.type === 'shareText' && analysis.url) {
      if (resolved?.webRid) {
        // 短链解析结果只是房间号，不含 anchor_id；显式重置，避免残留上一房间的 anchorId
        store.setAnchorId('');
        analyzeResult.value = { ok: true, text: `解析成功，房间号 ${resolved.webRid}` };
        router.push(`/confirm?room=${resolved.webRid}`);
        return;
      }
      // 解析失败：把提取出的干净短链交给 WebView
      analyzeResult.value = { ok: false, text: '自动解析失败，已打开抖音页面：请进入直播间后点击「选择这个直播间」' };
      router.push({ path: '/room-search', query: { url: analysis.url } });
      return;
    }
    // 类型四：无法识别的输入（主播名称搜索已移除）——直接提示
    analyzeResult.value = { ok: false, text: '无法识别输入内容，请输入直播间房间号或直播间链接' };
  } finally {
    loading.value = false;
  }
}

function applyRoomFromUrl() {
  const roomFromUrl = route.query.room as string;
  if (roomFromUrl) {
    roomInput.value = roomFromUrl;
  }
}

function fillRoom(roomNum: string) {
  roomInput.value = roomNum;
  store.setRoomInput(roomNum);
}

onMounted(applyRoomFromUrl);
watch(() => route.query.room, applyRoomFromUrl);
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
.page-body.center {
  justify-content: flex-start;
  align-items: center;
  position: relative;
}
/* 横屏：表单始终居中，最近进入药丸固定底部 */
.page-body.center.is-landscape {
  flex-direction: column;
  justify-content: center;
  padding: 10px 32px;
  overflow: hidden;
}
.page-body.center.is-landscape .room-form {
  padding-top: 0;
  width: 280px;
}
.page-body.center.is-landscape .recent-pills-wrap {
  position: absolute;
  bottom: 12px;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 20px 6px;
  margin-top: 0;
}
.room-form {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding-top: 33.33%;
}
.app-icon {
  width: 46px;
  height: 46px;
  border-radius: 8px;
}
.room-form-title {
  font-size: 17px;
  font-weight: bold;
  margin: 0;
  color: var(--title);
}
.room-form-subtitle {
  font-size: 10px;
  color: var(--text);
  margin: 0;
  text-align: center;
  line-height: 1.6;
}
.room-form-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--bd);
  border-radius: 6px;
  background: var(--white);
  font-size: 11px;
  outline: none;
  color: var(--title);
}
.room-form-input::placeholder { color: var(--tip); }
/* 实时输入识别 */
.input-analysis {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 14px;
  font-size: 10px;
  color: var(--tip);
}
.analysis-tag {
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: 8px;
  background: var(--theme);
  color: var(--white);
  font-size: 9px;
}
.analysis-info {
  word-break: break-all;
  line-height: 1.4;
}
.analyze-result {
  width: 100%;
  font-size: 10px;
  line-height: 1.5;
  margin: 0;
  text-align: center;
  word-break: break-all;
}
.analyze-result.ok { color: var(--theme); }
.analyze-result.bad { color: var(--error); }
.room-form-example {
  width: 100%;
  font-size: 9px;
  color: var(--tip);
  line-height: 1.5;
  margin: 0;
  padding: 0 2px;
}
.room-form-example span { text-decoration: underline; }
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
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
.recent-section {
  width: 100%;
  margin-top: 33.33%;
  padding-top: 14px;
}
.recent-title {
  font-size: 10px;
  color: var(--tip);
  margin: 0 0 6px;
  text-align: center;
}
.recent-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}
.recent-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border: 1px solid var(--bd);
  border-radius: 18px;
  background: var(--white);
  color: var(--title);
  font-size: 11px;
  cursor: pointer;
}
.recent-pill .rp-id {
  color: var(--tip);
  font-size: 9px;
}
</style>
