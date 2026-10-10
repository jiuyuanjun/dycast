<template>
  <div v-if="visible" class="update-dialog-mask" @click.self="dismiss">
    <div class="update-dialog">
      <h3 class="update-dialog-title">发现新版本</h3>
      <div class="update-dialog-version">
        <span class="old">v{{ currentVersion }}</span>
        <span class="arrow">→</span>
        <span class="new">v{{ latestVersion }}</span>
      </div>
      <div v-if="notes" class="update-dialog-notes">{{ notes }}</div>
      <p v-if="downloading" class="update-dialog-tip">已开始下载，可在通知栏查看进度，完成后点击安装。</p>
      <div class="btn-row">
        <button class="btn secondary" @click="dismiss">暂不更新</button>
        <button class="btn" :disabled="downloading" @click="updateNow">立即更新</button>
      </div>
    </div>
  </div>
  <!-- App 内轻提示（替代原生 alert） -->
  <div v-if="tipVisible" class="app-tip" :class="{ 'is-error': tipIsError }">{{ tipText }}</div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { checkUpdate, downloadUpdate, markDismissed, isDismissed, getCurrentVersion, type UpdateInfo } from '@/utils/updater';

const visible = ref(false);
const downloading = ref(false);
const currentVersion = ref('');
const latestVersion = ref('');
const notes = ref('');
let info: UpdateInfo | null = null;

/** 轻提示：文本、是否可见、是否为错误样式 */
const tipText = ref('');
const tipVisible = ref(false);
const tipIsError = ref(false);
let tipTimer: number | undefined = undefined;

/** 显示 App 内轻提示（2.5 秒后自动消失） */
function showTip(text: string, isError = false) {
  tipText.value = text;
  tipIsError.value = isError;
  tipVisible.value = true;
  if (tipTimer) window.clearTimeout(tipTimer);
  tipTimer = window.setTimeout(() => {
    tipVisible.value = false;
  }, 2500);
}

/**
 * auto 模式（App.vue 全局挂载 <UpdateDialog auto />）：启动后静默检查，发现新版本自动弹窗。
 * 未传 auto（如设置页手动挂载）时只提供 check() 方法，不自动检查。
 */
const props = withDefaults(defineProps<{ auto?: boolean }>(), { auto: false });

/** 手动检查（设置页调用，force=true 忽略 24h 节流） */
async function check(force = true) {
  const result = await checkUpdate(force);
  info = result;
  currentVersion.value = result.currentVersion || (await getCurrentVersion());
  if (result.hasUpdate) {
    latestVersion.value = result.latestVersion || '';
    notes.value = result.notes || '';
    visible.value = true;
    return true;
  }
  // 无更新时区分：检查失败 / 无可用正式版 / 确实已是最新
  if (force) {
    if (result.error) showTip(result.error, true);
    else if (result.noRelease) showTip('暂无可用的正式版本', false);
    else showTip('当前已是最新版本');
  }
  return false;
}

function dismiss() {
  visible.value = false;
  if (info?.latestVersion) markDismissed(info.latestVersion);
}

async function updateNow() {
  if (!info) return;
  downloading.value = true;
  const ok = await downloadUpdate(info);
  downloading.value = false;
  if (ok) {
    visible.value = false;
    showTip('已开始下载，可在通知栏查看进度');
  } else {
    showTip('下载失败，请稍后重试', true);
  }
}

onMounted(() => {
  if (!props.auto) return;
  // 启动静默检查：发现新版本且用户未点过"暂不"则自动弹窗
  setTimeout(async () => {
    const result = await checkUpdate(false);
    if (result.hasUpdate && !isDismissed(result.latestVersion)) {
      info = result;
      currentVersion.value = result.currentVersion || '';
      latestVersion.value = result.latestVersion || '';
      notes.value = result.notes || '';
      visible.value = true;
    }
  }, 4000);
});

defineExpose({ check });
</script>

<style scoped lang="scss">
.update-dialog-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 300;
  padding: 24px;
}
.update-dialog {
  width: 100%;
  max-width: 300px;
  background: var(--white);
  border-radius: 10px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.update-dialog-title {
  margin: 0;
  font-size: 14px;
  font-weight: bold;
  color: var(--title);
  text-align: center;
}
.update-dialog-version {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 12px;
  .old { color: var(--tip); text-decoration: line-through; }
  .arrow { color: var(--tip); }
  .new { color: var(--theme); font-weight: bold; }
}
.update-dialog-notes {
  font-size: 11px;
  color: var(--text);
  line-height: 1.6;
  max-height: 120px;
  overflow-y: auto;
  white-space: pre-wrap;
  background: var(--bg);
  border-radius: 6px;
  padding: 8px;
}
.update-dialog-tip {
  margin: 0;
  font-size: 10px;
  color: var(--tip);
  text-align: center;
}
.btn-row {
  display: flex;
  gap: 8px;
}
.btn {
  flex: 1;
  padding: 8px;
  border: none;
  border-radius: 6px;
  background: var(--theme);
  color: var(--white);
  font-size: 12px;
  font-weight: bold;
  cursor: pointer;
}
.btn.secondary {
  background: var(--white);
  color: var(--text);
  border: 1px solid var(--bd);
}
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
/* App 内轻提示（fixed，不跟随弹窗层级） */
.app-tip {
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
}
.app-tip.is-error { background: rgba(200, 60, 40, 0.92); }
</style>
