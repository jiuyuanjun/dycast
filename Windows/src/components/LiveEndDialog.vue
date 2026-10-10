<template>
  <div v-if="store.liveEndTipVisible.value" class="live-end-mask" @click.self="close">
    <div class="live-end-dialog">
      <div class="live-end-icon" :class="{ 'is-warn': isWarn }">
        <i class="ice-close ice"></i>
      </div>
      <h3 class="live-end-title">{{ store.liveEndTipTitle.value || '直播已关闭' }}</h3>
      <p class="live-end-text">{{ store.liveEndTipText.value || '主播已下播，计时已暂停' }}</p>
      <button class="btn" @click="close">{{ isSoft ? '知道了' : '返回首页' }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useStore } from '@/store';

const store = useStore();
const router = useRouter();
/** 断线/连接失败提醒用橙色警示图标，下播用红色 */
const isSoft = computed(
  () => store.liveEndTipTitle.value === '连接已断开' || store.liveEndTipTitle.value === '连接失败'
);
/** 兼容旧字段名：橙色警示 */
const isWarn = computed(() => isSoft.value);

async function close() {
  if (isSoft.value) {
    // 断线 / 连接失败提醒：仅关闭弹窗，用户可自行重连或离开
    store.closeLiveEndTip();
    return;
  }
  // 直播已关闭：完整收尾——回首页 + 断开连接 + 停止后台保活进程
  await store.handleLiveEndExit();
  router.push('/');
}
</script>

<style scoped lang="scss">
.live-end-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 400;
  padding: 24px;
}
.live-end-dialog {
  width: 100%;
  max-width: 280px;
  background: var(--white);
  border-radius: 12px;
  padding: 18px 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}
.live-end-icon {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--error, #e24b4a);
  display: flex;
  align-items: center;
  justify-content: center;
}
.live-end-icon.is-warn {
  background: #d98026;
}
.live-end-icon .ice {
  font-size: 22px;
  color: var(--white);
}
.live-end-title {
  margin: 0;
  font-size: 15px;
  font-weight: bold;
  color: var(--title);
}
.live-end-text {
  margin: 0;
  font-size: 12px;
  color: var(--text);
  line-height: 1.6;
  word-break: break-all;
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
</style>