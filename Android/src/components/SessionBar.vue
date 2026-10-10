<template>
  <div class="session-bar">
    <div class="session-avatar">
      <img v-if="avatar" :src="avatar" alt="头像" />
      <i v-else class="ice-keya ice"></i>
    </div>
    <div class="session-info">
      <div class="session-title">{{ title }}</div>
      <div class="session-value">{{ subTitle }}</div>
    </div>
    <div class="session-action" @click="onAction">
      <i v-if="isLoggedIn" class="ice-logout ice"></i>
      <i v-else class="ice-keya ice"></i>
    </div>
    <!-- 已登录时右上角图标=退出登录：加二次确认，避免在礼物页误触导致登录状态丢失 -->
    <ConfirmDialog
      :visible="confirmVisible"
      title="退出登录"
      message="确定退出当前账号吗？退出后需要重新扫码登录才能发送弹幕，后台通知与保活服务也会一并停止。"
      confirm-text="退出登录"
      danger
      @confirm="confirmVisible = false; emits('action')"
      @cancel="confirmVisible = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import ConfirmDialog from './ConfirmDialog.vue';
interface Props {
  avatar?: string;
  title?: string;
  subTitle?: string;
  isLoggedIn?: boolean;
}
const props = withDefaults(defineProps<Props>(), {
  title: '未登录',
  subTitle: '关注 0 | 粉丝 0',
  isLoggedIn: false
});
const emits = defineEmits<{ (e: 'action'): void }>();
const confirmVisible = ref(false);
function onAction() {
  // 未登录时图标是"去登录"入口，直接透传；已登录时图标是退出登录，先确认
  if (props.isLoggedIn) {
    confirmVisible.value = true;
    return;
  }
  emits('action');
}
</script>

<style scoped lang="scss">
.session-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  margin-bottom: 6px;
  border-radius: 8px;
  background: var(--white);
  border: 1px solid var(--bd);
}
.session-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--loading-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: var(--theme);
  flex-shrink: 0;
  overflow: hidden;
}
.session-avatar img { width: 100%; height: 100%; object-fit: cover; }
.session-info { flex: 1; min-width: 0; }
.session-title {
  font-size: 11px;
  font-weight: bold;
  color: var(--title);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-value {
  font-size: 9px;
  color: var(--text);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-action {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  background: var(--bg);
  border: 1px solid var(--bd);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--tool);
  flex-shrink: 0;
  cursor: pointer;
}
</style>
