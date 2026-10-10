<template>
  <div class="bottom-nav">
    <div
      v-for="item in items"
      :key="item.key"
      :class="['nav-item', { active: active === item.key }]"
      @click="emits('change', item.key)">
      <div :class="['nav-icon', item.icon]"></div>
      <span>{{ item.label }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
export interface NavItem {
  key: string;
  label: string;
  icon: string;
}
interface Props {
  items: NavItem[];
  active?: string;
}
withDefaults(defineProps<Props>(), { active: '' });
const emits = defineEmits<{ (e: 'change', key: string): void }>();
</script>

<style scoped lang="scss">
.bottom-nav {
  height: 46px;
  background: var(--white);
  border-top: 1px solid var(--bd);
  display: flex;
  flex-shrink: 0;
}
.nav-item {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  font-size: 8px;
  color: var(--tool);
  cursor: pointer;
  white-space: nowrap;
  padding: 0 1px;
}
.nav-item.active {
  color: var(--theme);
  background: var(--nav-active-bg);
}
.nav-icon {
  width: 17px;
  height: 17px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: var(--tool);
  opacity: 0.85;
  font-family: "castfont";
  font-style: normal;
  -webkit-font-smoothing: antialiased;
}
.nav-item.active .nav-icon { color: var(--theme); opacity: 1; }
</style>
