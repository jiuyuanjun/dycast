<template>
  <!-- 控制台 -->
  <div class="console-panel">
    <div class="console-panel-header">
      <div class="mac-prefix">
        <div class="cir red"></div>
        <div class="cir yellow"></div>
        <div class="cir green"></div>
      </div>
      <div class="title">
        <label>控制台</label>
      </div>
    </div>
    <div class="console-panel-main" ref="mainRef">
      <div v-for="(item, index) in logs" :key="index" :class="['log-item', `level-${item.level}`]">
        <span class="log-time">{{ item.time }}</span>
        <span class="log-tag">[{{ item.tag }}]</span>
        <span class="log-content">{{ item.content }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, useTemplateRef, watch } from 'vue';

export interface ConsoleLog {
  level: 'info' | 'success' | 'warning' | 'error';
  tag: string;
  content: string;
  time: string;
}

const logs = ref<ConsoleLog[]>([]);
const mainRef = useTemplateRef('mainRef');

const pad = (n: number) => `${n}`.padStart(2, '0');
const now = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const append = (log: Omit<ConsoleLog, 'time'>) => {
  logs.value.push({ ...log, time: now() });
  if (logs.value.length > 200) {
    logs.value = logs.value.slice(-200);
  }
  nextTick(() => {
    const el = mainRef.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
};

const clear = () => {
  logs.value = [];
};

watch(
  logs,
  () => {
    nextTick(() => {
      const el = mainRef.value;
      if (el) el.scrollTop = el.scrollHeight;
    });
  },
  { deep: true }
);

defineExpose({ append, clear });
</script>

<style lang="scss" scoped>
$redCirBg: #ff6157;
$redCirBd: #e24640;
$yellowCirBg: #ffc12f;
$yellowCirBd: #dfa023;
$greenCirBg: #2acb42;
$greenCirBd: #1bac2c;

$darkBg: #262626;
$darkBarBg: #363636;
$darkText: #a5a5a5;
$darkBd: rgba(0, 0, 0, 0.6);

.console-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border-radius: 0.5rem;
  background-color: $darkBg;
  border: 0.5px solid rgba(255, 255, 255, 0.2);
  overflow: hidden;
  box-shadow:
    0px 5px 10px 0px rgba(0, 0, 0, 0.3),
    0px 3px 6px 0px rgba(0, 0, 0, 0.15),
    0 0 1px 0 rgba(0, 0, 0, 0.6);
}

.console-panel-header {
  position: relative;
  width: 100%;
  height: 2rem;
  flex-shrink: 0;
  background-color: $darkBarBg;
  box-sizing: border-box;
  padding: 3px 8px;
  display: flex;
  align-items: center;
  box-shadow:
    0px 1px 0px 0px rgba(0, 0, 0, 0.3),
    0px 0.5px 0px 0px #000;
  .mac-prefix {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    .cir {
      width: 0.8rem;
      height: 0.8rem;
      box-sizing: border-box;
      border-radius: 50%;
      &.red {
        background-color: $redCirBg;
        border: 0.5px solid $redCirBd;
      }
      &.yellow {
        background-color: $yellowCirBg;
        border: 0.5px solid $yellowCirBd;
      }
      &.green {
        background-color: $greenCirBg;
        border: 0.5px solid $greenCirBd;
      }
    }
  }
  .title {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    font-size: 1rem;
    font-weight: bold;
    color: $darkText;
    box-sizing: border-box;
    label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
}

.console-panel-main {
  position: relative;
  width: 100%;
  flex-grow: 1;
  box-sizing: border-box;
  overflow-y: auto;
  padding: 8px;
  font-size: 13px;
  line-height: 1.6;
  color: $darkText;
}

.log-item {
  word-break: break-all;
  margin-bottom: 4px;
  .log-time {
    color: #7a7a7a;
    margin-right: 6px;
  }
  .log-tag {
    color: #4ec9b0;
    margin-right: 6px;
  }
  .log-content {
    color: #d4d4d4;
  }
  &.level-success .log-content {
    color: #6cc36c;
  }
  &.level-warning .log-content {
    color: #dcdc78;
  }
  &.level-error .log-content {
    color: #f48771;
  }
}
</style>
