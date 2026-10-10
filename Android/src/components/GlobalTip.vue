<template>
  <div v-if="tipState.visible" class="global-tip" :class="{ 'is-error': tipState.isError }">
    {{ tipState.text }}
  </div>
</template>

<script setup lang="ts">
import { tipState } from '@/utils/globalTip';
</script>

<style scoped lang="scss">
/* 全局轻提示：fixed 悬浮，不跟随任何弹窗层级，z-index 高于弹窗遮罩 */
.global-tip {
  position: fixed;
  left: 50%;
  bottom: 15%;
  transform: translateX(-50%);
  max-width: 80%;
  padding: 9px 16px;
  border-radius: 18px;
  background: rgba(0, 0, 0, 0.82);
  color: #fff;
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
  z-index: 500;
  word-break: break-all;
  pointer-events: none;
}
.global-tip.is-error {
  background: rgba(200, 60, 40, 0.92);
}
</style>
