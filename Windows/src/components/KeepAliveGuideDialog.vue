<template>
  <!-- 保活引导/提醒弹窗：首次打开强制走一遍引导；之后每次启动检测未开启时提醒 -->
  <div v-if="visible" class="ka-mask" @click.self="onClose">
    <div class="ka-dialog">
      <div class="ka-icon" :class="{ warn: isRemind }">
        <i class="ice-stat ice"></i>
      </div>
      <h3 class="ka-title">{{ isRemind ? '后台保活未开启' : '开启后台保活' }}</h3>
      <div class="ka-body">
        <template v-if="isRemind">
          <p class="ka-text">检测到「后台保活」当前未开启。关闭屏幕或切到后台时，弹幕可能 5 分钟左右断开。</p>
          <p class="ka-text ka-detail">建议按以下三步开启，即可在后台持续接收弹幕 / 礼物通知。</p>
        </template>
        <template v-else>
          <p class="ka-text">开启后台保活，App 退到后台也能持续接收弹幕、礼物通知（需要 3 项系统授权）：</p>
        </template>
        <ol class="ka-steps">
          <li>
            <span>开启前台服务保活</span>
            <Switch :model-value="settings.keepAlive" @update:model-value="onKeepAliveToggle" />
          </li>
          <li>
            <span>电池优化白名单</span>
            <span class="ka-status" :class="batteryOk ? 'ok' : 'off'">
              {{ batteryOk ? '已加白' : '未加白' }}
            </span>
          </li>
          <li>
            <span>自启动 / 后台运行</span>
            <span class="ka-link" @click="openAutostart">去设置</span>
          </li>
        </ol>
      </div>
      <div class="btn-row">
        <template v-if="isRemind">
          <button class="btn secondary" @click="close">暂不开启</button>
          <button class="btn" @click="close">知道了</button>
        </template>
        <template v-else>
          <button class="btn secondary" @click="goBattery">打开电池白名单设置</button>
          <button class="btn" @click="close">完成，开始使用</button>
        </template>
      </div>
      <p class="ka-tip">{{ isRemind ? '前往设置-后台保活可随时开启' : '点「完成」后保活未开启时，下次打开仍会提醒' }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import Switch from '@/components/Switch.vue';
import { notificationManager } from '@/utils/notificationManager';
import { isTauri } from '@/utils/tauriBridge';

const GUIDE_KEY = 'dycast_keepalive_guided';

const visible = ref(false);
/** false = 首次强制引导；true = 每次打开的非强制提醒 */
const isRemind = ref(false);

const settings = notificationManager.getSettings();
const batteryOk = ref(false);

async function refreshBattery() {
  const { isIgnoringBatteryOptimizations } = await import('@/utils/notification');
  batteryOk.value = await isIgnoringBatteryOptimizations();
}

function onKeepAliveToggle(v: boolean) {
  notificationManager.updateSettings({ keepAlive: v });
  settings.keepAlive = v;
}

function openAutostart() {
  notificationManager.openAutostartSettings();
}

async function goBattery() {
  await notificationManager.openBatteryWhitelist();
  setTimeout(refreshBattery, 1500);
}

/**
 * 关闭弹窗（统一入口）：
 * - 首次引导/提醒都允许关闭；关闭时如实记录"已引导过"，
 *   下次启动若保活仍未开启则走提醒模式（isRemind=true）。
 */
function close() {
  visible.value = false;
  // 无论首次引导还是提醒，关闭即视为"已看过引导"，避免每次启动都弹
  try {
    localStorage.setItem(GUIDE_KEY, '1');
  } catch (e) {
    console.warn('[KeepAliveGuide] 记录引导状态失败', e);
  }
}

function onClose() {
  // 允许关闭（首次引导也可点遮罩/按钮关闭，只是下一次启动会走提醒模式）
  close();
}

async function checkAndShow() {
  if (!isTauri()) return; // 浏览器预览环境不弹
  try {
    const guided = localStorage.getItem(GUIDE_KEY) === '1';
    // 保活已开启：不再打扰（引导/提醒都不弹）
    if (settings.keepAlive) return;
    // ① 首次打开：强制走一遍保活引导
    if (!guided) {
      isRemind.value = false;
      visible.value = true;
      return;
    }
    // ② 已引导过但保活仍未开启：每次启动提醒一次
    isRemind.value = true;
    visible.value = true;
  } catch (e) {
    console.warn('[KeepAliveGuide] 检测失败', e);
  }
}

onMounted(() => {
  // 挂载即读取真实电池白名单状态（否则弹窗里恒显示"未加白"）
  refreshBattery();
  // 延迟到登录会话恢复/首页渲染后弹，避免首屏叠加
  setTimeout(checkAndShow, 1200);
});

defineExpose({ checkAndShow });
</script>

<style scoped lang="scss">
.ka-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 420;
  padding: 24px;
}
.ka-dialog {
  width: 100%;
  max-width: 320px;
  background: var(--white);
  border-radius: 12px;
  padding: 18px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
  max-height: 85vh;
  overflow-y: auto;
}
.ka-icon {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--theme);
  display: flex;
  align-items: center;
  justify-content: center;
}
.ka-icon.warn {
  background: #d98026;
}
.ka-icon .ice {
  font-size: 22px;
  color: var(--white);
}
.ka-title {
  margin: 0;
  font-size: 15px;
  font-weight: bold;
  color: var(--title);
}
.ka-body {
  width: 100%;
  text-align: left;
}
.ka-text {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--text);
  line-height: 1.6;
}
.ka-detail {
  opacity: 0.85;
}
.ka-steps {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ka-steps li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--bd);
  border-radius: 6px;
  padding: 8px 10px;
}
.ka-status {
  font-size: 11px;
  font-weight: bold;
  padding: 2px 8px;
  border-radius: 10px;
  flex-shrink: 0;
}
.ka-status.ok { color: var(--theme); background: var(--nav-active-bg, rgba(104,190,141,.15)); }
.ka-status.off { color: var(--text3); background: var(--loading-bg, rgba(128,128,128,.12)); }
.ka-link {
  color: var(--theme);
  font-size: 11px;
  font-weight: bold;
  cursor: pointer;
  flex-shrink: 0;
}
.btn-row {
  display: flex;
  gap: 8px;
  width: 100%;
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
.ka-tip {
  margin: 0;
  font-size: 10px;
  color: var(--tip);
  line-height: 1.5;
}
</style>