<template>
  <div v-if="visible" class="confirm-mask" @click.self="emit('cancel')">
    <div class="confirm-dialog">
      <h3 class="confirm-title">{{ title }}</h3>
      <p class="confirm-text">{{ message }}</p>
      <div class="confirm-actions">
        <button class="btn cancel" @click="emit('cancel')">{{ cancelText }}</button>
        <button class="btn ok" :class="{ danger }" @click="emit('confirm')">{{ confirmText }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  visible: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** true 时确认按钮显示为红色警示（不可逆操作） */
  danger?: boolean;
}
withDefaults(defineProps<Props>(), {
  confirmText: '确定',
  cancelText: '取消',
  danger: false
});
const emit = defineEmits<{ (e: 'confirm'): void; (e: 'cancel'): void }>();
</script>

<style scoped lang="scss">
.confirm-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 420;
  padding: 24px;
}
.confirm-dialog {
  width: 100%;
  max-width: 280px;
  background: var(--white);
  border-radius: 12px;
  padding: 16px 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.confirm-title {
  margin: 0;
  font-size: 14px;
  font-weight: bold;
  color: var(--title);
  text-align: center;
}
.confirm-text {
  margin: 0;
  font-size: 12px;
  color: var(--text);
  line-height: 1.6;
  word-break: break-all;
}
.confirm-actions {
  display: flex;
  gap: 8px;
}
.btn {
  flex: 1;
  padding: 8px;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: bold;
  cursor: pointer;
}
.btn.cancel {
  background: var(--bg);
  color: var(--text);
}
.btn.ok {
  background: var(--theme);
  color: var(--white);
}
.btn.ok.danger {
  background: var(--error, #e24b4a);
}
</style>
