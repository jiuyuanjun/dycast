import { onMounted, onUnmounted, ref } from 'vue';

/**
 * 全局共享的横竖屏状态。
 * 所有页面复用同一个 ref 与同一组监听（遵循 agent.md Bug 10：定时器/监听必须挂 ref 并随组件卸载清理）。
 */
const isLandscape = ref(false);
let listenerCount = 0;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

/** LivePage 是否仍在"自动切横屏"档位；退出横屏时短暂置 false，避免刚退出就被弹回 */
let autoPushResetTimer: ReturnType<typeof setTimeout> | undefined;
export const landscapeAutoPush = ref(true);
export function suppressLandscapeAutoPush(ms = 600) {
  landscapeAutoPush.value = false;
  clearTimeout(autoPushResetTimer);
  autoPushResetTimer = setTimeout(() => {
    landscapeAutoPush.value = true;
  }, ms);
}

function update() {
  isLandscape.value = window.innerWidth > window.innerHeight;
}

function handleChange() {
  clearTimeout(debounceTimer);
  // 延迟检测，等待 WebView 上报新尺寸
  debounceTimer = setTimeout(update, 200);
}

/**
 * 横竖屏检测组合式函数。返回全局共享的 isLandscape ref，
 * 模板中可直接 `v-if="isLandscape"`，逻辑中 `watch(isLandscape, ...)`。
 */
export function useLandscape() {
  onMounted(() => {
    listenerCount++;
    if (listenerCount === 1) {
      update();
      window.addEventListener('resize', handleChange);
      window.addEventListener('orientationchange', handleChange);
    } else {
      update();
    }
  });
  onUnmounted(() => {
    listenerCount--;
    if (listenerCount <= 0) {
      listenerCount = 0;
      clearTimeout(debounceTimer);
      window.removeEventListener('resize', handleChange);
      window.removeEventListener('orientationchange', handleChange);
    }
  });
  return isLandscape;
}
