import { reactive } from 'vue';

interface TipState {
  visible: boolean;
  text: string;
  isError: boolean;
}

/** 全局轻提示状态（App 级单例，任意组件可调用 showGlobalTip 弹出提示） */
export const tipState = reactive<TipState>({
  visible: false,
  text: '',
  isError: false
});

let tipTimer: number | undefined = undefined;

/**
 * 显示全局轻提示（默认 2.5 秒后自动消失）
 * @param text 提示文本
 * @param isError 是否为错误样式（红底）
 */
export function showGlobalTip(text: string, isError = false, duration = 2500) {
  tipState.text = text;
  tipState.isError = isError;
  tipState.visible = true;
  if (tipTimer) window.clearTimeout(tipTimer);
  tipTimer = window.setTimeout(() => {
    tipState.visible = false;
  }, duration);
}
