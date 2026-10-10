import './style.css';
import './assets/font/font.css';

import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import { isAndroid } from '@/utils/tauriBridge';

console.info('[App] userAgent =>', navigator.userAgent);
console.info('[App] isTauri =>', !!(window as any).__TAURI_INTERNALS__);

const internals = (window as any).__TAURI_OS_PLUGIN_INTERNALS__;
if (internals && internals.platform === 'android') {
  document.documentElement.classList.add('is-android');
}

isAndroid().then(android => {
  if (android) {
    document.documentElement.classList.add('is-android');
    console.info('[App] isAndroid => true');
  }
});

function applyTheme(name: 'light' | 'dark' | string) {
  document.documentElement.setAttribute('data-theme', name === 'dark' ? 'dark' : 'light');
}

function syncTheme() {
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  applyTheme(mql.matches ? 'dark' : 'light');
  mql.addEventListener('change', (e) => applyTheme(e.matches ? 'dark' : 'light'));
}

syncTheme();

const app = createApp(App);
app.use(router);
app.mount('#app');
// 热更新引导的启动成功标记：挂载完成即视为本次加载的前端（内置或热更）可用，
// 引导脚本的 8s 看门狗据此判断是否需要回退内置资源
(window as any).__DYCAST_BOOTED = true;
