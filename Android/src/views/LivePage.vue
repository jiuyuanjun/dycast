<template>
  <div class="page">
    <AppHeader :title="`直播间 ${store.state.roomNum || ''}`" :show-back="false" show-settings @settings="router.push('/more')" @extra="router.push('/auto-reply')">
      <template #extra>
        <span class="ice-cast ice header-extra-btn" title="自动回复"></span>
      </template>
    </AppHeader>
    <div class="page-body">
      <template v-if="tab === 'chat'">
        <div class="stats-bar">
          <span>在线观众 {{ fmt(audienceCount) }}</span>
          <span class="stats-divider">|</span>
          <span>粉丝 {{ fmt(followCount) }}</span>
        </div>
        <!-- 在线观众：实时在线互动榜优先，未就绪时退回已有榜单数据 -->
        <div class="rank-panel" :class="{ 'rank-scroll': rankDisplay.length > 5 }">
          <div class="rank-header">
            <span class="rank-title">在线观众<span v-if="audienceCount || rankDisplay.length" class="rank-count"> · {{ audienceCount || rankDisplay.length }} 人</span></span>
          </div>
          <div class="rank-list">
            <template v-if="rankDisplay.length">
              <div v-for="(item, i) in rankDisplay" :key="`${item.nickname}-${i}`" class="rank-item">
                <!-- 三列：名次（数字，数据为"-"时显示"-"）| 头像 | 名字 -->
                <span class="rank-no" :class="{ top3: i < 3 }">{{ item.rank === '-' ? '-' : i + 1 }}</span>
                <img v-if="item.avatar" class="rank-avatar" :src="item.avatar" alt="" />
                <span class="rank-avatar-placeholder" v-else></span>
                <span class="rank-name">{{ item.nickname || '未知用户' }}</span>
              </div>
            </template>
            <div v-else class="rank-empty">暂无榜单数据</div>
          </div>
        </div>
        <CastListMobile
          :messages="store.state.chatMessages"
          empty-text="暂无弹幕" />
        <!-- 弹幕发送框 -->
        <ChatInputBar
          :room-id="store.state.liveInfo?.roomId"
          :logged-in="store.isLoggedIn.value"
          placeholder="发个弹幕互动一下…"
          @tip="showTip"
          @sent="onSent" />
      </template>

      <template v-if="tab === 'gift'">
        <!-- 只要有历史登录记录就直接展示礼物列表，不再反复提示登录 -->
        <div v-if="!store.hasLoginRecord.value" class="cast-list" style="position:relative;">
          <div class="session-overlay">
            <div class="key-icon"><i class="ice-keya ice"></i></div>
            <p class="tip-text">登录抖音账号后才可显示礼物信息</p>
            <button class="btn" style="width:auto;min-width:160px;" @click="router.push('/login-webview')">抖音扫码 / 网页登录</button>
          </div>
        </div>
        <template v-else>
          <SessionBar
            :avatar="store.state.user?.avatar"
            :title="store.state.user?.nickname || '已登录'"
            :sub-title="`关注 ${store.state.user?.following || 0} | 粉丝 ${store.state.user?.follower || 0}`"
            :is-logged-in="true"
            @action="store.logout()" />
          <CastListMobile :messages="store.state.giftMessages" empty-text="暂无礼物" />
        </template>
      </template>

      <template v-if="tab === 'social'">
        <div class="filter-bar">
          <button
            v-for="item in socialFilterItems"
            :key="item.key"
            class="filter-btn"
            :class="{ active: store.state.socialFilter === item.key }"
            @click="store.setSocialFilter(item.key)">
            {{ item.label }}
          </button>
        </div>
        <CastListMobile :messages="filteredSocialMessages" empty-text="暂无进入/关注/粉丝团" />
      </template>

      <template v-if="tab === 'data'">
        <div class="data-cover">
          <img v-if="cover" :src="cover" alt="封面" />
          <span v-else>暂无封面</span>
        </div>
        <div class="info-row">
          <span class="k">主播</span>
          <span class="v" style="display:flex;align-items:center;gap:5px;">
            <img v-if="avatar" :src="avatar" alt="头像" style="width:16px;height:16px;border-radius:50%;object-fit:cover;" />
            {{ nickname }}
          </span>
        </div>
        <div class="info-row"><span class="k">在线观众数</span><span class="v">{{ fmt(audienceCount) }}</span></div>
        <div class="info-row"><span class="k">累计观看数</span><span class="v">{{ fmt(totalUserCount) }}</span></div>
        <div class="info-row"><span class="k">本场点赞数</span><span class="v">{{ fmt(likeCount) }}</span></div>
        <div class="info-row"><span class="k">粉丝数</span><span class="v">{{ fmt(followCount) }}</span></div>
        <div class="info-row"><span class="k">本场关注数</span><span class="v">{{ store.state.sessionFollowCount }}</span></div>
        <div class="info-row"><span class="k">最高在线人数</span><span class="v">{{ fmt(store.state.maxAudienceCount ?? audienceCount) }}</span></div>
        <div class="info-row"><span class="k">已播时长</span><span class="v">{{ store.durationText.value }}</span></div>
      </template>
    </div>
    <BottomNav :items="navItems" :active="tab" @change="switchTab" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppHeader from '@/components/AppHeader.vue';
import BottomNav, { type NavItem } from '@/components/BottomNav.vue';
import CastListMobile from '@/components/CastListMobile.vue';
import ChatInputBar from '@/components/ChatInputBar.vue';
import SessionBar from '@/components/SessionBar.vue';
import { landscapeAutoPush, useLandscape } from '@/composables/useOrientation';
import { mergeRankLists, useStore } from '@/store';
import type { SocialFilter } from '@/store';
import { CastMethod, type DyMessage } from '@/core/dycast';
import { CLog } from '@/utils/logUtil';
import { showGlobalTip } from '@/utils/globalTip';

const router = useRouter();
const route = useRoute();
const store = useStore();

/** 发送反馈轻提示（复用 App 级 tip 协议，弹出可见提示） */
function showTip(type: 'success' | 'error', msg: string) {
  if (type === 'success') {
    CLog.info('弹幕发送 => ' + msg);
    showGlobalTip(msg, false);
  } else {
    CLog.warn('弹幕发送失败 => ' + msg);
    showGlobalTip(msg, true);
  }
}

function onSent() {
  CLog.info('弹幕已发送');
}

// 旋转到横屏时自动切三栏（含进入页面时已是横屏的场景）
const isLandscape = useLandscape();
watch(isLandscape, landscape => {
  if (landscape && route.path !== '/landscape' && landscapeAutoPush.value) {
    router.push('/landscape');
  }
}, { immediate: true });

onMounted(() => {
  console.info('[RankFix] live page build marker v20260927b');
  const room = store.state.roomNum || store.state.roomInput;
  if (room && !store.isConnected.value) {
    store.connectLive(room);
  }
});

const navItems: NavItem[] = [
  { key: 'chat', label: '弹幕', icon: 'ice-cast' },
  { key: 'gift', label: '礼物', icon: 'ice-gift' },
  { key: 'social', label: '进入&关注', icon: 'ice-member' },
  { key: 'data', label: '主播数据', icon: 'ice-data' }
];

const socialFilterItems: { key: SocialFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'enter', label: '进入' },
  { key: 'follow', label: '关注' },
  { key: 'fansclub', label: '粉丝团' }
];

const filteredSocialMessages = computed(() => {
  const filter = store.state.socialFilter;
  if (filter === 'all') return store.state.socialMessages;
  const map: Record<Exclude<SocialFilter, 'all'>, CastMethod> = {
    enter: CastMethod.MEMBER,
    follow: CastMethod.SOCIAL,
    fansclub: CastMethod.FANSCLUB
  };
  return store.state.socialMessages.filter((m: DyMessage) => m.method === map[filter]);
});

const tab = computed(() => {
  const t = route.params.tab as string;
  return navItems.some(i => i.key === t) ? t : 'chat';
});

function switchTab(key: string) {
  router.replace(`/live/${key}`);
}

const info = computed(() => store.state.liveInfo);
/** 贡献榜数据源：在线互动榜与观众贡献榜取并集（互动榜只推有互动的观众，
     人数波动大；并集后更满更稳），在线榜条目排前、按昵称去重 */
const rankDisplay = computed(() => {
  const merged = mergeRankLists(
    store.state.rankOnlineList,
    store.state.rankFullList.length ? store.state.rankFullList : store.state.rankGiftList
  );
  return merged.length ? merged : store.state.rankGiftList;
});
const cover = computed(() => info.value?.cover || '');
const avatar = computed(() => info.value?.avatar || '');
const nickname = computed(() => info.value?.nickname || '-');
const audienceCount = computed(() => info.value?.audienceCount);
const totalUserCount = computed(() => info.value?.totalUserCount);
const likeCount = computed(() => info.value?.likeCount);
const followCount = computed(() => info.value?.followCount);

const fmt = (v?: string | number) => (v === undefined || v === null || v === '' ? '-' : String(v));
</script>

<style scoped lang="scss">
.page {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.header-extra-btn {
  font-size: 15px;
  font-family: "castfont";
  font-style: normal;
  color: var(--tool);
}
.page-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  padding-bottom: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}
.cast-list {
  flex: 1;
  background: var(--panel-bg);
  border: 1px solid var(--bd);
  border-radius: 6px;
  padding: 6px;
  overflow-y: auto;
}
.session-overlay {
  position: absolute;
  inset: 0;
  background: rgba(247, 246, 245, 0.92);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--tip);
  font-size: 10px;
  text-align: center;
  padding: 16px;
  gap: 6px;
  border-radius: 6px;
}
@media (prefers-color-scheme: dark) {
  .session-overlay { background: rgba(26, 29, 33, 0.92); color: var(--text); }
}
html[data-theme="dark"] .session-overlay { background: rgba(26, 29, 33, 0.92); color: var(--text); }
.session-overlay .key-icon {
  width: 46px;
  height: 46px;
  margin: 0 auto 4px;
  background: var(--white);
  border: 2px solid var(--theme);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  color: var(--theme);
}
.session-overlay .tip-text {
  font-size: 11px;
  margin: 0;
}
.session-overlay .btn {
  width: auto;
  min-width: 160px;
  padding: 8px;
  border: none;
  border-radius: 6px;
  background: var(--theme);
  color: var(--white);
  font-size: 12px;
  font-weight: bold;
  cursor: pointer;
}
.data-cover {
  width: 100%;
  aspect-ratio: 16 / 9;
  background: var(--loading-bg);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--tip);
  font-size: 11px;
  margin-bottom: 8px;
  overflow: hidden;
}
.data-cover img { width: 100%; height: 100%; object-fit: cover; }
.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 0;
  border-bottom: 1px solid rgba(178, 191, 195, 0.4);
  font-size: 11px;
}
.info-row .k { font-weight: bold; color: var(--title); }
.info-row .v { color: var(--text); }
.stats-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 6px;
  margin-bottom: 6px;
  background: var(--panel-bg);
  border: 1px solid var(--bd);
  border-radius: 6px;
  font-size: 10px;
  color: var(--text);
}
.stats-divider { color: var(--bd); }
/* 贡献榜：默认随内容自适应高度（抖音协议只推前三，数据少时不再留大空白）；
   仅当条数超过阈值（>6）时固定高度 205px + 框内上下滚动 */
.rank-panel {
  /* 数据少：不设固定高度，面板收缩到内容高度，无大段留白 */
  flex: 0 0 auto;
  margin-bottom: 6px;
  background: var(--panel-bg);
  border: 1px solid var(--bd);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
}
.rank-panel.rank-scroll {
  /* 数据多于 5 条：固定显示 5 行（约 160px）+ 框内滑动查看其余（滚动机制同 Bug 24 修复） */
  height: 160px;
  overflow: hidden;
}
.rank-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border-bottom: 1px solid var(--bd);
}
.rank-title {
  font-size: 10px;
  font-weight: bold;
  color: var(--title);
}
.rank-count {
  font-weight: normal;
  color: var(--text3);
}
.rank-list {
  /* 默认内容全展示（不滚动）；多数据时由 rank-scroll 改为 flex:1 滚动 */
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  touch-action: pan-y;
  scrollbar-width: thin;
}
.rank-panel.rank-scroll .rank-list {
  flex: 1;
  min-height: 0;
}
.rank-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  font-size: 10px;
  color: var(--text);
  border-bottom: 1px solid rgba(178, 191, 195, 0.2);
}
.rank-item:last-child { border-bottom: none; }
.rank-no {
  width: 18px;
  text-align: center;
  font-weight: bold;
  color: var(--text3);
  flex-shrink: 0;
}
.rank-no.top3 { color: var(--gold, #eba825); }
.rank-avatar {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--loading-bg);
  flex-shrink: 0;
}
.rank-avatar-placeholder {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--loading-bg);
  flex-shrink: 0;
}
.rank-name {
  flex: 1;
  min-width: 0;
  color: var(--title);
  /* 昵称最多两行：用户需要看清完整用户名，单行省略号会把长名字截断 */
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  word-break: break-all;
  line-height: 1.35;
}
.rank-empty {
  padding: 12px 8px;
  text-align: center;
  font-size: 10px;
  color: var(--tip);
}
.filter-bar {
  flex-shrink: 0;
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}
.filter-btn {
  flex: 1;
  padding: 5px 2px;
  border: 1px solid var(--bd);
  border-radius: 6px;
  background: var(--white);
  color: var(--text);
  font-size: 10px;
  cursor: pointer;
}
.filter-btn.active {
  background: var(--theme);
  color: var(--white);
  border-color: var(--theme);
}
</style>
