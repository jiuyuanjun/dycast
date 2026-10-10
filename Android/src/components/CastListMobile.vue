<template>
  <div ref="listRef" class="cast-list" @scroll="handleScroll">
    <CastItemMobile
      v-for="(item, index) in messages"
      :key="`${item.method}-${item.id}-${index}`"
      :method="item.method"
      :user="item.user"
      :gift="item.gift"
      :content="item.content" />
    <div v-if="!messages.length" class="cast-empty">{{ emptyText }}</div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { DyMessage } from '@/core/dycast';
import CastItemMobile from './CastItemMobile.vue';
interface Props {
  messages: DyMessage[];
  emptyText?: string;
}
const props = withDefaults(defineProps<Props>(), { emptyText: '暂无消息' });
const listRef = ref<HTMLElement | null>(null);
let isAtBottom = true;
const SCROLL_BTH = 50;
const handleScroll = () => {
  const el = listRef.value;
  if (!el) return;
  isAtBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_BTH;
};
const scrollToBottom = () => {
  const el = listRef.value;
  if (el) el.scrollTop = el.scrollHeight;
};
watch(
  () => props.messages.length,
  () => {
    nextTick(() => {
      if (isAtBottom) scrollToBottom();
    });
  }
);
</script>

<style scoped lang="scss">
.cast-list {
  flex: 1;
  background: var(--panel-bg);
  border: 1px solid var(--bd);
  border-radius: 6px;
  padding: 6px;
  overflow-y: auto;
}
.cast-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--tip);
  font-size: 10px;
}
</style>
