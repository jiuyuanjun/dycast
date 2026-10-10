<template>
  <div class="ka-page">
    <AppHeader title="后台保活" @back="router.back()" />
    <div class="ka-body">
      <div class="ka-group">
        <div class="notify-row">
          <span class="notify-icon ice-stat ice"></span>
          <span>开启前台服务保活</span>
          <Switch v-model="settings.keepAlive" @change="onKeepAliveChange" />
        </div>
        <div class="notify-hint">开启后 App 退到后台也能持续接收弹幕、礼物通知</div>
        <div class="notify-row">
          <span class="notify-icon ice-stat ice"></span>
          <span>前台服务状态</span>
          <span class="status-badge" :class="serviceRunning ? 'ok' : 'off'">
            {{ serviceRunning ? '运行中' : '未运行' }}
          </span>
        </div>
      </div>

      <div class="ka-group">
        <div class="notify-group-title">系统授权（后台不被杀的关键）</div>
        <div class="notify-row" @click="openBatteryWhitelist">
          <span class="notify-icon ice-setting ice"></span>
          <span>电池优化白名单</span>
          <span class="status-badge" :class="batteryOk ? 'ok' : 'off'">
            {{ batteryOk ? '已加白' : '未加白' }}
          </span>
        </div>
        <div class="notify-row" @click="openAutostart">
          <span class="notify-icon ice-config ice"></span>
          <span>自启动 / 后台运行设置</span>
          <span class="arrow"></span>
        </div>
        <div class="notify-row" @click="showGuide">
          <span class="notify-icon ice-stat ice"></span>
          <span>保活引导</span>
          <span class="arrow"></span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppHeader from '@/components/AppHeader.vue';
import Switch from '@/components/Switch.vue';
import { notificationManager } from '@/utils/notificationManager';

const router = useRouter();
const settings = reactive(notificationManager.getSettings());
const serviceRunning = ref(false);
const batteryOk = ref(false);

async function refreshStatus() {
  const { isForegroundServiceRunning, isIgnoringBatteryOptimizations } = await import('@/utils/notification');
  serviceRunning.value = await isForegroundServiceRunning();
  batteryOk.value = await isIgnoringBatteryOptimizations();
}

function onKeepAliveChange() {
  notificationManager.updateSettings({ ...settings });
  setTimeout(refreshStatus, 1200);
}

function openBatteryWhitelist() {
  notificationManager.openBatteryWhitelist();
  setTimeout(refreshStatus, 1500);
}

function openAutostart() {
  notificationManager.openAutostartSettings();
}

function showGuide() {
  notificationManager.updateSettings({ batteryOptimizationAsked: false });
  notificationManager.maybePromptBatteryOptimization();
}

onMounted(() => {
  refreshStatus();
  notificationManager.onStatusChange = refreshStatus;
  document.addEventListener('visibilitychange', refreshStatus);
});

onUnmounted(() => {
  notificationManager.onStatusChange = null;
  document.removeEventListener('visibilitychange', refreshStatus);
});
</script>

<style scoped lang="scss">
.ka-page {
  position: absolute;
  inset: 0;
  background: var(--bg);
  z-index: 40;
  display: flex;
  flex-direction: column;
}
.ka-body {
  flex: 1;
  overflow-y: auto;
  padding: 9px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ka-group {
  background: var(--white);
  border: 1px solid var(--bd);
  border-radius: 6px;
  padding: 0 9px;
}
.notify-group-title {
  font-size: 12px;
  color: var(--text3);
  padding: 9px 0 3px;
  border-bottom: 1px solid var(--bd);
}
.notify-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 40px;
  padding: 9px 0;
  font-size: 14px;
  color: var(--text1);
  border-bottom: 1px solid var(--bd-line, var(--bd));
  &:last-child {
    border-bottom: none;
  }
}
.notify-icon {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  background: var(--bg);
  border: 1px solid var(--bd);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--theme);
  font-family: "castfont";
  font-style: normal;
  margin-right: 8px;
  flex-shrink: 0;
}
.notify-row span:nth-child(2) {
  flex: 1;
}
.notify-hint {
  font-size: 11px;
  color: var(--text3);
  padding: 0 0 9px;
  border-bottom: 1px solid var(--bd-line, var(--bd));
}
.arrow {
  width: 8px;
  height: 8px;
  border-top: 2px solid var(--text3);
  border-right: 2px solid var(--text3);
  transform: rotate(45deg);
  flex-shrink: 0;
}
.status-badge {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: bold;
}
.status-badge.ok {
  color: var(--theme);
  background: var(--nav-active-bg, rgba(104, 190, 141, 0.15));
}
.status-badge.off {
  color: var(--text3);
  background: var(--loading-bg, rgba(128, 128, 128, 0.12));
}
</style>