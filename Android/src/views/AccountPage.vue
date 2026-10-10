<template>
  <div class="account-page">
    <AppHeader title="账号管理" @back="router.back()" />
    <div class="account-body">
      <!-- 当前账号信息 -->
      <div class="account-group">
        <div class="account-profile">
          <div class="profile-avatar">
            <img v-if="store.state.user?.avatar" :src="store.state.user.avatar" alt="头像" />
            <i v-else class="ice-keya ice"></i>
          </div>
          <div class="profile-info">
            <div class="profile-name">{{ store.state.user?.nickname || '未登录' }}</div>
            <div class="profile-sub">
              <template v-if="store.isLoggedIn.value">
                抖音号 {{ store.state.user?.did || '-' }} · 关注 {{ store.state.user?.following || 0 }} | 粉丝 {{ store.state.user?.follower || 0 }}
              </template>
              <template v-else>登录后才能发送弹幕与使用自动回复</template>
            </div>
          </div>
          <span class="login-badge" :class="{ on: store.isLoggedIn.value }">
            {{ store.isLoggedIn.value ? '已登录' : '未登录' }}
          </span>
        </div>
        <div class="account-hint">账号操作已收进本页二级菜单，避免在设置页误触导致登录状态丢失。</div>
      </div>

      <!-- 账号操作 -->
      <div class="account-group">
        <div class="account-row" @click="onLoginEntry">
          <span class="row-icon ice-keya ice"></span>
          <span>登录 / 更换账号</span>
          <span class="arrow"></span>
        </div>
        <div class="account-row" @click="changeRoom">
          <span class="row-icon ice-cast ice"></span>
          <span>更换房间</span>
          <span class="arrow"></span>
        </div>
        <div class="account-row" @click="exitRoom">
          <span class="row-icon ice-close ice"></span>
          <span>退出房间</span>
          <span class="arrow"></span>
        </div>
        <div v-if="store.isLoggedIn.value" class="account-row" @click="askLogout">
          <span class="row-icon ice-logout ice"></span>
          <span class="danger-text">退出登录</span>
          <span class="arrow"></span>
        </div>
      </div>
    </div>

    <ConfirmDialog
      :visible="!!confirmState"
      :title="confirmState?.title || ''"
      :message="confirmState?.message || ''"
      :confirm-text="confirmState?.confirmText || '确定'"
      :danger="confirmState?.danger || false"
      @confirm="confirmState?.onConfirm(); confirmState = null"
      @cancel="confirmState = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import AppHeader from '@/components/AppHeader.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import { useStore } from '@/store';
import { showGlobalTip } from '@/utils/globalTip';

const router = useRouter();
const store = useStore();

/** 统一确认弹窗状态：null 隐藏；onConfirm 由触发点注入 */
const confirmState = ref<{
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => void;
} | null>(null);

/** 登录/更换账号：已登录时二次确认，防止误触覆盖当前登录状态 */
function onLoginEntry() {
  if (!store.isLoggedIn.value) {
    router.push('/login-webview');
    return;
  }
  confirmState.value = {
    title: '更换账号',
    message: '即将打开抖音登录页。继续登录会覆盖当前账号的登录状态，确定要继续吗？',
    confirmText: '继续登录',
    onConfirm: () => router.push('/login-webview')
  };
}

/** 退出登录：二次确认（不可逆，会停止通知与保活服务） */
function askLogout() {
  confirmState.value = {
    title: '退出登录',
    message: '确定退出当前账号吗？退出后需要重新扫码登录才能发送弹幕，后台通知与保活服务也会一并停止。',
    confirmText: '退出登录',
    danger: true,
    onConfirm: () => {
      store.logout();
      showGlobalTip('已退出登录');
    }
  };
}

/** 更换房间：断开当前连接并回首页，保留房间号输入与登录态 */
function changeRoom() {
  const keep = store.state.roomInput;
  store.exitRoom();
  store.setRoomInput(keep);
  router.replace('/');
}

/** 退出房间：断开连接 + 清空房间数据 + 回首页 */
function exitRoom() {
  store.exitRoom();
  router.replace('/');
}
</script>

<style scoped lang="scss">
.account-page {
  position: absolute;
  inset: 0;
  background: var(--bg);
  z-index: 40;
  display: flex;
  flex-direction: column;
}
.account-body {
  flex: 1;
  overflow-y: auto;
  padding: 9px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.account-group {
  background: var(--white);
  border: 1px solid var(--bd);
  border-radius: 6px;
  padding: 0 9px 9px;
}
.account-profile {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 0 4px;
}
.profile-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--loading-bg);
  border: 1px solid var(--bd);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: var(--theme);
  flex-shrink: 0;
}
.profile-avatar img { width: 100%; height: 100%; object-fit: cover; }
.profile-info { flex: 1; min-width: 0; }
.profile-name {
  font-size: 13px;
  font-weight: bold;
  color: var(--title);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.profile-sub {
  font-size: 10px;
  color: var(--text3);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.login-badge {
  flex-shrink: 0;
  font-size: 10px;
  padding: 3px 8px;
  border-radius: 10px;
  background: var(--bg);
  color: var(--text3);
  border: 1px solid var(--bd);
}
.login-badge.on {
  color: var(--theme);
  border-color: var(--theme);
  background: rgba(104, 190, 141, 0.12);
}
.account-hint {
  font-size: 10px;
  color: var(--text3);
  padding: 2px 0 2px;
}
.account-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 8px 0;
  font-size: 13px;
  color: var(--text1);
  border-top: 1px solid var(--bd-line, var(--bd));
  cursor: pointer;
  &:first-of-type {
    border-top: none;
  }
}
.row-icon {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  background: var(--bg);
  border: 1px solid var(--bd);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--theme);
  font-family: "castfont";
  font-style: normal;
  flex-shrink: 0;
}
.danger-text {
  color: var(--error, #e24b4a);
}
.account-row .arrow {
  margin-left: auto;
  color: var(--text3);
  font-family: "castfont";
  font-style: normal;
  &::before { content: "\e77e"; }
}
</style>
