<template>
  <div class="app-header">
    <span v-if="showBack" class="app-header-back ice-arrow-left-copy ice" @click="emits('back')"></span>
    <span class="app-header-title">{{ title }}</span>
    <span class="app-header-extra" @click="emits('extra')">
      <slot name="extra"></slot>
    </span>
    <span v-if="showSettings" class="app-header-settings ice-setting ice" @click="emits('settings')"></span>
  </div>
</template>

<script setup lang="ts">
interface Props {
  title?: string;
  showBack?: boolean;
  showSettings?: boolean;
}
withDefaults(defineProps<Props>(), {
  title: '',
  showBack: true,
  showSettings: false
});
const emits = defineEmits<{ (e: 'back'): void; (e: 'settings'): void; (e: 'extra'): void }>();
</script>

<style scoped lang="scss">
.app-header {
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--white);
  border-bottom: 1px solid var(--bd);
  font-weight: bold;
  font-size: 12px;
  color: var(--title);
  flex-shrink: 0;
  position: relative;
}
.app-header-back,
.app-header-settings,
.app-header-extra {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  color: var(--tool);
  font-size: 15px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
}
.app-header-back { left: 2px; }
.app-header-settings { right: 2px; }
.app-header-extra { right: 34px; }
.app-header-title {
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
