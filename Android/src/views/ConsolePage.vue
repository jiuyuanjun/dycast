<template>
  <div class="more-page">
    <AppHeader title="控制台" @back="router.back()" />
    <div class="more-page-body console-body" ref="bodyRef">
      <div v-if="!store.state.consoleLogs.length" class="console-empty">暂无日志</div>
      <div
        v-for="(item, index) in store.state.consoleLogs"
        :key="index"
        :class="['console-log', `level-${item.level}`]">
        <span class="time">{{ item.time }}</span>
        <span class="tag">[{{ item.tag }}]</span>
        <span class="content">{{ item.content }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import AppHeader from '@/components/AppHeader.vue';
import { useStore } from '@/store';

const router = useRouter();
const store = useStore();
const bodyRef = ref<HTMLElement | null>(null);

watch(
  () => store.state.consoleLogs.length,
  () => {
    nextTick(() => {
      const el = bodyRef.value;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
);
</script>

<style scoped lang="scss">
.more-page {
  position: absolute;
  inset: 0;
  background: var(--bg);
  z-index: 35;
  display: flex;
  flex-direction: column;
}
.more-page-body {
  flex: 1;
  overflow-y: auto;
  padding: 9px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--bg);
  font-family: 'Menlo', 'Consolas', monospace;
}
.console-log {
  margin-bottom: 5px;
  padding: 3px 5px;
  border-radius: 3px;
  background: var(--bg);
  color: var(--text);
  font-size: 9px;
  line-height: 1.4;
  border-left: 3px solid var(--theme);
}
.console-empty {
  color: var(--tip);
  font-size: 11px;
  text-align: center;
  margin-top: 40px;
}
.console-log.level-success { color: var(--theme); }
.console-log.level-error { border-left-color: var(--error); color: var(--error); }
.console-log .time { color: var(--tip); margin-right: 3px; }
.console-log .tag { font-weight: bold; margin-right: 3px; }
</style>
