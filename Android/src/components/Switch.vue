<template>
  <div class="switch" :class="{ on: modelValue, disabled }" @click="toggle">
    <div class="switch-thumb"></div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ modelValue: boolean; disabled?: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'change'): void }>();

function toggle() {
  if (props.disabled) return;
  emit('update:modelValue', !props.modelValue);
  emit('change');
}
</script>

<style scoped lang="scss">
.switch {
  width: 44px;
  height: 24px;
  border-radius: 12px;
  background: var(--text3, #999);
  position: relative;
  transition: background 0.2s ease;
  &.on {
    background: var(--success, #28c445);
  }
  &.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}
.switch-thumb {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  position: absolute;
  top: 2px;
  left: 2px;
  transition: transform 0.2s ease;
}
.switch.on .switch-thumb {
  transform: translateX(20px);
}
</style>
