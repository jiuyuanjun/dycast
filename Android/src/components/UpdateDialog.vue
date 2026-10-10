<template>
  <div v-if="visible" class="update-dialog-mask" @click.self="later">
    <div class="update-dialog">
      <h3 class="update-dialog-title">{{ readyToInstall ? '更新包已下载' : '发现新版本' }}</h3>
      <div class="update-dialog-version">
        <span class="old">v{{ currentVersion }}</span>
        <span class="arrow">→</span>
        <span class="new">v{{ latestVersion }}</span>
      </div>
      <div v-if="notes && !downloading" class="update-dialog-notes">{{ notes }}</div>

      <!-- 下载中：进度条 -->
      <div v-if="downloading" class="progress-wrap">
        <div class="progress-bar">
          <span class="progress-fill" :style="{ width: `${percent}%` }"></span>
        </div>
        <div class="progress-text">
          <span v-if="total > 0">{{ percent }}%</span>
          <span v-else>已下载 {{ fmtSize(downloaded) }}</span>
          <span class="progress-size">
            {{ fmtSize(downloaded) }}<template v-if="total > 0"> / {{ fmtSize(total) }}</template>
          </span>
        </div>
      </div>
      <!-- 已下载：询问是否安装（不重新下载） -->
      <p v-else-if="readyToInstall" class="update-dialog-tip">
        安装包已下载完成{{ sizeText }}，是否立即安装？
      </p>
      <p v-else-if="phase === 'error'" class="update-dialog-tip is-error">{{ errorText }}</p>

      <div class="btn-row">
        <button class="btn secondary" @click="later">
          {{ readyToInstall ? '稍后安装' : '暂不更新' }}
        </button>
        <button v-if="readyToInstall" class="btn" @click="installNow">立即安装</button>
        <button v-else class="btn" :disabled="downloading" @click="startDownload">
          {{ downloading ? '下载中…' : phase === 'error' ? '重试下载' : '立即更新' }}
        </button>
      </div>
      <!-- 应用内下载失败时的兜底：改用系统下载（通知栏进度） -->
      <button v-if="phase === 'error'" class="link-btn" @click="systemDownload">
        改用系统下载（通知栏查看进度）
      </button>
    </div>
  </div>
  <!-- App 内轻提示（替代原生 alert） -->
  <div v-if="tipVisible" class="app-tip" :class="{ 'is-error': tipIsError }">{{ tipText }}</div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  checkUpdate,
  clearDownloadedRecord,
  downloadUpdate,
  downloadUpdateWithProgress,
  getCurrentVersion,
  getDownloadedApk,
  getDownloadedRecord,
  installDownloadedApk,
  isDismissed,
  markDismissed,
  type DownloadedApk,
  type UpdateInfo
} from '@/utils/updater';

type Phase = 'idle' | 'downloading' | 'ready' | 'error';

const visible = ref(false);
const phase = ref<Phase>('idle');
const currentVersion = ref('');
const latestVersion = ref('');
const notes = ref('');
const errorText = ref('');
/** 下载进度（字节） */
const downloaded = ref(0);
const total = ref(0);
/** 已下载待安装的更新包 */
const downloadedApk = ref<DownloadedApk | null>(null);
let info: UpdateInfo | null = null;

const downloading = computed(() => phase.value === 'downloading');
const readyToInstall = computed(() => phase.value === 'ready' && !!downloadedApk.value);
const percent = computed(() => {
  if (total.value <= 0) return 0;
  return Math.min(100, Math.round((downloaded.value / total.value) * 100));
});
const sizeText = computed(() => {
  const s = downloadedApk.value?.size;
  return s ? `（${fmtSize(s)}）` : '';
});

/** 字节数格式化：B / KB / MB */
function fmtSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

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

/** 应用信息到弹窗状态 */
async function fill(result: UpdateInfo) {
  info = result;
  currentVersion.value = result.currentVersion || (await getCurrentVersion());
  latestVersion.value = result.latestVersion || '';
  notes.value = result.notes || '';
  // 已有该版本安装包 → 直接进入"是否安装"，不重复下载
  const rec = await getDownloadedApk(result.latestVersion);
  // 清理非同版本的残留记录（例如已安装成功后的旧包记录）
  const stored = getDownloadedRecord();
  if (!rec && stored && stored.version !== result.latestVersion) clearDownloadedRecord();
  downloadedApk.value = rec;
  phase.value = rec ? 'ready' : 'idle';
  downloaded.value = rec?.size || 0;
  total.value = rec?.size || 0;
  errorText.value = '';
  visible.value = true;
}

/** 手动检查（设置页调用，force=true 忽略 24h 节流） */
async function check(force = true) {
  const result = await checkUpdate(force);
  if (result.hasUpdate) {
    await fill(result);
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

/** 应用内下载（带进度条） */
async function startDownload() {
  if (!info) return;
  phase.value = 'downloading';
  downloaded.value = 0;
  total.value = 0;
  const rec = await downloadUpdateWithProgress(info, p => {
    downloaded.value = p.downloaded;
    total.value = p.total;
  });
  if (rec) {
    downloadedApk.value = rec;
    phase.value = 'ready';
  } else {
    phase.value = 'error';
    errorText.value = '下载失败，请检查网络后重试';
  }
}

/** 兜底：改用系统 DownloadManager（通知栏进度，完成后自动拉起安装器） */
async function systemDownload() {
  if (!info) return;
  const ok = await downloadUpdate(info);
  if (ok) {
    visible.value = false;
    showTip('已改用系统下载，可在通知栏查看进度');
  } else {
    showTip('下载失败，请稍后重试', true);
  }
}

/** 立即安装已下载的安装包（不重新下载） */
async function installNow() {
  const rec = downloadedApk.value;
  if (!rec) return;
  const ok = await installDownloadedApk(rec);
  if (ok) {
    visible.value = false;
    showTip('已调起安装程序，请在系统弹窗中确认安装');
  } else {
    downloadedApk.value = null;
    phase.value = 'error';
    errorText.value = '安装包已失效（缓存可能被清理），请重新下载';
    clearDownloadedRecord();
  }
}

/**
 * 用户选择"暂不/稍后"。
 * 仅记录本次运行内的忽略：下次打开 App 仍会提示；届时若安装包已下载好，
 * 弹窗会直接进入"是否安装"，不会重复下载。
 */
function later() {
  visible.value = false;
  if (info?.latestVersion) markDismissed(info.latestVersion);
}

onMounted(() => {
  if (!props.auto) return;
  // 启动静默检查：发现新版本且本次运行内未点过"稍后"则自动弹窗
  setTimeout(async () => {
    const result = await checkUpdate(false);
    if (result.hasUpdate && !isDismissed(result.latestVersion)) {
      await fill(result);
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
.update-dialog-tip.is-error { color: var(--error, #e24b4a); }
/* 下载进度条 */
.progress-wrap {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.progress-bar {
  height: 8px;
  border-radius: 4px;
  background: var(--bg);
  border: 1px solid var(--bd);
  overflow: hidden;
}
.progress-fill {
  display: block;
  height: 100%;
  width: 0;
  background: var(--theme);
  transition: width 0.2s linear;
}
.progress-text {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--tip);
}
.progress-size { color: var(--tip); }
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
.link-btn {
  border: none;
  background: transparent;
  color: var(--tip);
  font-size: 10px;
  text-decoration: underline;
  cursor: pointer;
  padding: 0;
}
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
