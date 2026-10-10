<template>
  <div class="enum-picker">
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      class="enum-opt"
      :class="{ active: modelValue === opt.value }"
      @click="select(opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>

<script setup lang="ts" generic="T extends string">
defineProps<{
  options: { label: string; value: T }[];
  modelValue: T;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: T): void;
  (e: 'change'): void;
}>();

function select(v: T) {
  emit('update:modelValue', v);
  emit('change');
}
</script>

<style scoped lang="scss">
.enum-picker {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.enum-opt {
  padding: 3px 9px;
  font-size: 11px;
  line-height: 1.4;
  border: 1px solid var(--bd);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text2);
  cursor: pointer;
  &.active {
    background: var(--theme);
    color: var(--white);
    border-color: var(--theme);
  }
}
</style>