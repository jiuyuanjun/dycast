<template>
  <div class="landscape-page">
    <button class="landscape-exit" title="退出横屏" @click="exitLandscape">
      <i class="ice-close ice"></i>
    </button>
    <div class="win-layout">
      <div class="win-left">
        <div class="win-panel" style="flex:0 0 auto;">
          <div class="win-panel-header">
            <span class="win-panel-dots"><span></span><span></span><span></span></span>
            <span class="win-panel-title">直播信息</span>
          </div>
          <div class="win-panel-body">
            <div class="cover-box" style="aspect-ratio:16/9;border-radius:4px;margin-bottom:3px;">
              <img v-if="cover" :src="cover" alt="封面" />
              <span v-else>暂无封面</span>
            </div>
            <div class="cover-title" style="font-size:9px;margin-bottom:4px;">{{ title || '***' }}</div>
            <div class="small-info"><span class="k">主播</span><span class="v">{{ nickname }}</span></div>
            <div class="small-info"><span class="k">主播粉丝数</span><span class="v">{{ fmt(followCount) }}</span></div>
            <div class="small-info"><span class="k">在线观众数</span><span class="v">{{ fmt(audienceCount) }}</span></div>
            <div class="small-info"><span class="k">累计观看人数</span><span class="v">{{ fmt(totalUserCount) }}</span></div>
            <div class="small-info"><span class="k">本场点赞数</span><span class="v">{{ fmt(likeCount) }}</span></div>
            <div class="small-info"><span class="k">本场关注数</span><span class="v">{{ store.state.sessionFollowCount }}</span></div>
            <div class="small-info"><span class="k">最高在线人数</span><span class="v">{{ fmt(store.state.maxAudienceCount ?? audienceCount) }}</span></div>
          </div>
        </div>
        <div class="win-user-card">
          <div class="win-user-avatar">
            <img v-if="store.state.user?.avatar" :src="store.state.user.avatar" alt="头像" />
            <i v-else class="ice-keya ice"></i>
          </div>
          <div class="win-user-info">
            <div class="win-user-name">{{ store.state.user?.nickname || '未登录' }}</div>
            <div class="win-user-fs">关注 {{ store.state.user?.following || 0 }} | 粉丝 {{ store.state.user?.follower || 0 }}</div>
          </div>
          <div class="win-user-action" :title="store.isLoggedIn.value ? '退出登录' : '登录/更换'" @click="userAction">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M10.09 15.59L11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5c-1.11 0-2 .9-2 2v4h2V5h14v14H5v-4H3v4c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/></svg>
          </div>
        </div>
        <div class="win-icon-tools">
          <div class="win-icon-btn ice-stat ice" title="控制台" @click="router.push('/console')"></div>
          <div class="win-icon-btn ice-setting ice" title="设置" @click="router.push('/more')"></div>
        </div>
        <div class="win-timer">{{ store.durationText.value }}</div>
        <div class="win-status">
          <div class="win-status-dot" :class="statusClass"></div>
          <span>{{ store.state.statusText }}</span>
        </div>
      </div>
      <div class="win-center">
        <div class="win-panel" style="flex:1;">
          <div class="win-panel-header">
            <span class="win-panel-dots"><span></span><span></span><span></span></span>
            <span class="win-panel-title">弹幕信息</span>
          </div>
          <div class="win-panel-body cast-list" style="border:none;background:transparent;flex:1;min-height:0;">
            <CastListMobile :messages="store.state.chatMessages" empty-text="暂无消息" :on-mention="handleMention" />
          </div>
          <!-- 弹幕发送框：点击弹幕自动 @ 用户 -->
          <ChatInputBar
            ref="chatInputRef"
            :room-id="store.state.liveInfo?.roomId"
            :logged-in="store.isLoggedIn.value"
            placeholder="发个弹幕互动一下…（点击弹幕可 @ 用户）"
            @tip="showTip"
            @sent="onSent" />
        </div>
        <div class="win-panel" style="flex:1;">
          <div class="win-panel-header">
            <span class="win-panel-dots"><span></span><span></span><span></span></span>
            <span class="win-panel-title">礼物信息</span>
          </div>
          <div class="win-panel-body cast-list" style="border:none;background:transparent;">
            <template v-if="store.isLoggedIn.value">
              <CastListMobile :messages="store.state.giftMessages" empty-text="暂无消息" />
            </template>
            <div v-else class="panel-login-tip">
              <div class="key-icon"><i class="ice-keya ice"></i></div>
              <p class="tip-text">登录抖音账号后才可显示礼物信息</p>
              <button class="btn" @click="router.push('/login-webview')">抖音扫码 / 网页登录</button>
            </div>
          </div>
        </div>
      </div>
      <div class="win-right">
        <div class="win-panel">
          <div class="win-panel-header">
            <span class="win-panel-dots"><span></span><span></span><span></span></span>
            <span class="win-panel-title">房间号 & 直播链接</span>
          </div>
          <div class="win-panel-body">
            <div class="win-input-row">
              <input v-model="roomInput" class="input room-link-input" placeholder="房间号 / 直播链接" style="flex:1;" />
              <button class="btn" @click="toggleConnect">{{ store.isConnected.value ? '断开' : '连接' }}</button>
            </div>
          </div>
        </div>
        <div class="win-panel" style="flex:1;">
          <div class="win-panel-header">
            <span class="win-panel-dots"><span></span><span></span><span></span></span>
            <span class="win-panel-title">进入 & 关注 & 粉丝团</span>
          </div>
          <div class="win-panel-body social-panel-body">
            <div class="filter-bar">
              <button
                v-for="opt in socialFilterOptions"
                :key="opt.key"
                class="filter-btn"
                :class="{ active: socialFilter === opt.key }"
                @click="socialFilter = opt.key">{{ opt.label }}</button>
            </div>
            <div class="ls-social-list">
              <CastListMobile :messages="filteredSocialMessages" empty-text="暂无" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import CastListMobile from '@/components/CastListMobile.vue';
import ChatInputBar from '@/components/ChatInputBar.vue';
import { useStore } from '@/store';
import { useLandscape } from '@/composables/useOrientation';
import { verifyRoomInput } from '@/utils/verifyUtil';
import { CLog } from '@/utils/logUtil';
import { CastMethod, type DyMessage } from '@/core/dycast';

const router = useRouter();
const store = useStore();
const roomInput = ref(store.state.roomNum || store.state.roomInput || '');
const chatInputRef = ref<InstanceType<typeof ChatInputBar> | null>(null);

/** 点击弹幕 → 自动填入 @昵称 */
function handleMention(nickname: string) {
  chatInputRef.value?.mention(nickname);
}

/** 发送反馈轻提示 */
function showTip(type: 'success' | 'error', msg: string) {
  if (type === 'success') CLog.info('弹幕发送 => ' + msg);
  else CLog.warn('弹幕发送失败 => ' + msg);
}

function onSent() {
  CLog.info('弹幕已发送');
}

// 旋转回竖屏时自动退出三栏，回到原页面
const isLandscape = useLandscape();
watch(isLandscape, landscape => {
  if (!landscape) {
    router.back();
  }
});

function exitLandscape() {
  router.back();
}

const info = computed(() => store.state.liveInfo);
const cover = computed(() => info.value?.cover || '');
const title = computed(() => info.value?.title || '');
const nickname = computed(() => info.value?.nickname || '***');
const audienceCount = computed(() => info.value?.audienceCount);
const totalUserCount = computed(() => info.value?.totalUserCount);
const likeCount = computed(() => info.value?.likeCount);
const followCount = computed(() => info.value?.followCount);

const fmt = (v?: string | number) => (v === undefined || v === null || v === '' ? '-' : String(v));

const statusClass = computed(() => {
  if (store.state.status === 1) return '';
  if (store.state.status === 2) return 'fail';
  return 'offline';
});

// 进入 / 关注 / 粉丝团：顶部筛选按钮切换显示（全部 = 按时间顺序混排）
type SocialFilter = 'all' | CastMethod;
const socialFilterOptions: { key: SocialFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: CastMethod.MEMBER, label: '进入' },
  { key: CastMethod.SOCIAL, label: '关注' },
  { key: CastMethod.FANSCLUB, label: '粉丝团' }
];
const socialFilter = ref<SocialFilter>('all');
const filteredSocialMessages = computed(() => {
  if (socialFilter.value === 'all') return store.state.socialMessages;
  return store.state.socialMessages.filter((m: DyMessage) => m.method === socialFilter.value);
});

function toggleConnect() {
  if (store.isConnected.value) {
    store.disconnectLive();
    return;
  }
  const { flag, roomNum } = verifyRoomInput(roomInput.value);
  if (!flag || !roomNum) {
    alert('请输入正确的房间号或抖音直播链接');
    return;
  }
  store.setRoomInput(roomInput.value);
  store.connectLive(roomNum);
}

function userAction() {
  if (store.isLoggedIn.value) {
    store.logout();
  } else {
    router.push('/login-webview');
  }
}

onMounted(() => {
  const room = store.state.roomNum || store.state.roomInput;
  if (room && !store.isConnected.value) {
    store.connectLive(room);
  }
});
</script>

<style scoped lang="scss">
.landscape-page {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
  position: relative;
}
.landscape-exit {
  position: absolute;
  top: max(6px, env(safe-area-inset-top, 0px));
  right: 6px;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--panel-bg);
  border: 1px solid var(--bd);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--title);
  font-size: 12px;
  z-index: 100;
  cursor: pointer;
}
.win-layout {
  flex: 1;
  display: flex;
  overflow: hidden;
  gap: 4px;
  padding: 3px;
}
.win-left {
  width: 170px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  gap: 3px;
}
.win-center {
  flex: 1.4;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.win-right {
  width: 195px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  overflow-y: auto;
}
.win-panel {
  background: var(--panel-bg);
  border: 1px solid var(--bd);
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-size: 8px;
}
.win-panel-header {
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid var(--bd);
  background: var(--panel-bg);
  position: relative;
  flex-shrink: 0;
}
.win-panel-dots {
  position: absolute;
  left: 5px;
  display: flex;
  gap: 3px;
}
.win-panel-dots span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
}
.win-panel-dots span:nth-child(1) { background: #ff5f57; }
.win-panel-dots span:nth-child(2) { background: #febc2e; }
.win-panel-dots span:nth-child(3) { background: #28c840; }
.win-panel-title {
  font-size: 9px;
  font-weight: bold;
  color: var(--title);
}
.win-panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 3px;
  min-height: 0;
}
.cover-box {
  width: 100%;
  background: var(--loading-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--tip);
  overflow: hidden;
}
.cover-box img { width: 100%; height: 100%; object-fit: cover; }
.cover-title {
  text-align: center;
  font-weight: bold;
  color: var(--title);
}
.small-info {
  font-size: 8px;
  padding: 2px 0;
  display: flex;
  justify-content: space-between;
}
.small-info .k { color: var(--title); }
.small-info .v { color: var(--text); }
.win-input-row {
  display: flex;
  gap: 3px;
  align-items: center;
  margin-bottom: 3px;
}
.win-input-row .input {
  flex: 1;
  margin-bottom: 0;
  padding: 3px 5px;
  font-size: 8px;
  border: 1px solid var(--bd);
  border-radius: 6px;
  background: var(--panel-bg);
  outline: none;
  color: var(--title);
}
.win-input-row .btn {
  width: auto;
  padding: 3px 7px;
  font-size: 8px;
  margin-bottom: 0;
  white-space: nowrap;
  border: none;
  border-radius: 6px;
  background: var(--theme);
  color: #ffffff;
  cursor: pointer;
}
.win-timer {
  text-align: center;
  font-family: 'Courier New', monospace;
  font-size: 14px;
  font-weight: bold;
  color: #9079ad;
  padding: 2px 0;
}
.win-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  font-size: 9px;
  color: var(--text);
  padding: 2px 0;
}
.win-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--theme);
  border: 1px solid #455765;
}
.win-status-dot.offline { background: #f08300; }
.win-status-dot.fail { background: #e60033; }
.win-user-card {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  background: var(--panel-bg);
  border: 1px solid var(--bd);
  border-radius: 6px;
  margin-top: auto;
}
.win-user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--loading-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  overflow: hidden;
  flex-shrink: 0;
}
.win-user-avatar img { width: 100%; height: 100%; object-fit: cover; }
.win-user-info { flex: 1; min-width: 0; }
.win-user-name {
  font-size: 9px;
  font-weight: bold;
  color: var(--title);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.win-user-fs {
  font-size: 8px;
  color: var(--text);
  margin-top: 1px;
}
.win-user-action {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  background: var(--bg);
  border: 1px solid var(--bd);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--tool);
  flex-shrink: 0;
  cursor: pointer;
}
.win-user-action svg {
  width: 14px;
  height: 14px;
  fill: currentColor;
}
.win-icon-tools {
  display: flex;
  justify-content: flex-end;
  gap: 5px;
  padding: 2px 0;
}
.win-icon-btn {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  background: var(--panel-bg);
  border: 1px solid var(--bd);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--tool);
  font-size: 12px;
  font-family: "castfont";
  font-style: normal;
  cursor: pointer;
}
.cast-list {
  flex: 1;
  overflow-y: auto;
}
.filter-bar {
  flex-shrink: 0;
  display: flex;
  gap: 3px;
  margin-bottom: 3px;
}
.filter-btn {
  flex: 1;
  padding: 3px 0;
  font-size: 8px;
  border: 1px solid var(--bd);
  border-radius: 4px;
  background: var(--panel-bg);
  color: var(--text);
  cursor: pointer;
}
.filter-btn.active {
  background: var(--theme);
  border-color: var(--theme);
  color: #ffffff;
  font-weight: bold;
}
/* 社交面板：顶部筛选（全部/进入/关注/粉丝团）+ 单列表 */
.social-panel-body {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ls-social-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  font-size: 8px;
  :deep(.cast-list) {
    border: none;
    border-radius: 0;
    background: transparent;
    padding: 1px 4px;
  }
  /* 单行显示，过长省略号，避免逐字换行 */
  :deep(.cast-item) {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    word-break: normal;
  }
}
.room-link-input { text-align: center; }
.panel-login-tip {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--tip);
  font-size: 9px;
  text-align: center;
  padding: 8px;
}
.panel-login-tip .key-icon {
  width: 28px;
  height: 28px;
  margin: 0;
  background: var(--panel-bg);
  border: 2px solid var(--theme);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--theme);
}
.panel-login-tip .tip-text { margin: 0; }
.panel-login-tip .btn {
  width: auto;
  min-width: 100px;
  padding: 5px 10px;
  font-size: 9px;
  border: none;
  border-radius: 6px;
  background: var(--theme);
  color: #ffffff;
  cursor: pointer;
}
</style>
