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
    <div class="session-action" @click="emits('action')">
      <i v-if="isLoggedIn" class="ice-logout ice"></i>
      <i v-else class="ice-keya ice"></i>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  avatar?: string;
  title?: string;
  subTitle?: string;
  isLoggedIn?: boolean;
}
withDefaults(defineProps<Props>(), {
  title: '未登录',
  subTitle: '关注 0 | 粉丝 0',
  isLoggedIn: false
});
const emits = defineEmits<{ (e: 'action'): void }>();
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
