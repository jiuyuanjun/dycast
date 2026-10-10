/**
 * Tauri / Browser runtime bridge.
 *
 * In Tauri the local Rust proxy listens on a free port chosen at runtime.
 * This module exposes that port plus a helper that rewrites proxy paths
 * ("/dylive", "/socket") to the absolute origin the runtime expects.
 *
 * When running outside Tauri (plain browser + `vite dev`), it falls back to
 * the current `location.origin`, which is what the original vite proxy serves.
 */

import { platform } from '@tauri-apps/plugin-os';

let cachedPort: number | null = null;
let detectionPromise: Promise<number | null> | null = null;

/** True when running inside a Tauri WebView. */
export function isTauri(): boolean {
  const flag = !!(window as any).__TAURI_INTERNALS__;
  console.info('[tauriBridge] isTauri =>', flag);
  return flag;
}

/**
 * 检测当前是否运行在安卓 Tauri 环境中。
 * 优先使用 @tauri-apps/plugin-os 的 platform()，失败时检查 Tauri OS 插件全局变量。
 * 注意：不使用 navigator.userAgent 回退，因为 tauri.android.conf.json 将 UA 设为桌面版以兼容抖音签名。
 */
export async function isAndroid(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return (await platform()) === 'android';
  } catch {
    // 回退：检查 OS 插件全局变量是否注入
    const internals = (window as any).__TAURI_OS_PLUGIN_INTERNALS__;
    if (internals && typeof internals.platform === 'string') {
      return internals.platform === 'android';
    }
    // 最终回退：检查 Tauri 内部标记（Android 构建产物会包含 android 标识）
    return false;
  }
}

/**
 * Detect the Tauri proxy port. Returns null in a plain browser.
 * Caches the result after the first successful detection.
 */
export async function getProxyPort(): Promise<number | null> {
  if (cachedPort !== null) return cachedPort;
  if (!isTauri()) return null;
  if (detectionPromise) return detectionPromise;
  detectionPromise = (async () => {
    // 冷启动时 Rust 代理可能尚未就绪：重试若干次。
    // 若这里直接返回 null，withProxyOrigin() 会静默退化成相对路径，
    // 请求会打到 tauri.localhost 而不是 127.0.0.1:<port>，
    // 导致接口全部失败 —— 表现为"明明已登录却提示要登录"。
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const port = await invoke<number | null>('get_proxy_port');
        if (typeof port === 'number' && port > 0) {
          cachedPort = port;
          console.info('[tauriBridge] proxy port =>', port, `(第 ${attempt + 1} 次探测)`);
          return port;
        }
      } catch (err) {
        console.error('[tauriBridge] get_proxy_port invoke failed:', err);
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    // 彻底失败：清空探测缓存，允许后续调用重新尝试（不要永久卡在 null）
    console.error('[tauriBridge] 代理端口探测失败，后续请求将回退为相对路径');
    detectionPromise = null;
    return null;
  })();
  return detectionPromise;
}

/**
 * Return the origin that proxy paths should be prefixed with.
 * - Tauri:  http://127.0.0.1:<port>
 * - Browser: '' (same origin, vite proxy handles it)
 */
export async function getProxyOrigin(): Promise<string> {
  const port = await getProxyPort();
  if (port) return `http://127.0.0.1:${port}`;
  return '';
}

/**
 * Prepend the runtime origin to a path like `/dylive/...` or `/socket/...`.
 * Falls back to the raw path when running in a plain browser.
 */
export async function withProxyOrigin(path: string): Promise<string> {
  if (!path.startsWith('/dylive') && !path.startsWith('/socket')) return path;
  const origin = await getProxyOrigin();
  return origin + path;
}

export interface LoginWebViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Open the native Android WebView for Douyin login embedded at the given screen bounds.
 * The backend uses CookieManager to extract `sessionid` after the user logs in.
 */
export async function openDouyinLoginWindowAt(bounds: LoginWebViewBounds): Promise<boolean> {
  if (!isTauri()) {
    // In a plain browser, open the official login page in a new tab.
    window.open('https://live.douyin.com', '_blank');
    return false;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_douyin_login', { bounds });
    return true;
  } catch (err) {
    console.error('[tauriBridge] open_douyin_login failed:', err);
    return false;
  }
}

/**
 * Close the Douyin login WebView / dialog.
 */
export async function closeDouyinLoginWindow(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('close_douyin_login');
  } catch (err) {
    console.error('[tauriBridge] close_douyin_login failed:', err);
  }
}

/**
 * Open the native Android WebView for Douyin live room search embedded at the given screen bounds.
 */
export async function openDouyinRoomSearchAt(bounds: LoginWebViewBounds, url?: string): Promise<boolean> {
  if (!isTauri()) {
    window.open(url || 'https://live.douyin.com', '_blank');
    return false;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_douyin_room_search', { bounds, url });
    return true;
  } catch (err) {
    console.error('[tauriBridge] open_douyin_room_search failed:', err);
    return false;
  }
}

/**
 * Close the Douyin room search WebView / dialog.
 */
export async function closeDouyinRoomSearchWindow(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('close_douyin_room_search');
  } catch (err) {
    console.error('[tauriBridge] close_douyin_room_search failed:', err);
  }
}

/**
 * Ask the Rust backend to extract the current URL from the room search WebView.
 * Returns the URL string, or null if unavailable.
 */
export async function extractDouyinRoomUrl(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const url = await invoke<string | null>('extract_douyin_room_url');
    return url;
  } catch (err) {
    console.error('[tauriBridge] extract_douyin_room_url failed:', err);
    return null;
  }
}

/**
 * Ask the Rust backend to extract `sessionid` from the login window's cookie store.
 * Returns the sessionid string, or null if not logged in yet.
 */
export async function extractDouyinSessionid(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const sid = await invoke<string | null>('extract_douyin_sessionid');
    return sid;
  } catch (err) {
    console.error('[tauriBridge] extract_douyin_sessionid failed:', err);
    return null;
  }
}

/**
 * Forward the user-provided sessionid to the Rust proxy so it can inject the
 * cookie into Douyin HTTP / WebSocket requests. Pass an empty string to clear.
 */
export async function sendDanmakuInWebView(roomId: string, requestUrl: string): Promise<{ ok: boolean; status: number; body: string }> {
  if (!isTauri()) return { ok: false, status: 0, body: '非 Tauri 环境' };
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const started = await invoke<boolean>('start_danmaku_send', { roomId, requestUrl });
    if (!started) return { ok: false, status: 0, body: '发送页面未就绪' };
    // 80 次 × 250ms = 20s：首次发送需加载房间页（大房间可超 10s），超时视为未确认
    for (let i = 0; i < 80; i++) {
      const result = await invoke<string | null>('extract_danmaku_result');
      if (result) {
        try { return JSON.parse(result); } catch { return { ok: false, status: 0, body: result }; }
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return { ok: false, status: 0, body: '发送页面响应超时' };
  } catch (err) {
    console.error('[tauriBridge] send danmaku failed:', err);
    return { ok: false, status: 0, body: String(err) };
  }
}

/**
 * 预热弹幕发送 WebView：提前加载当前房间页（不发请求），
 * 用户点发送时页面已就绪，fetch 毫秒级返回。连接成功后调用。
 */
export async function preloadDanmakuWebView(roomId: string): Promise<boolean> {
  if (!isTauri() || !roomId) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<boolean>('preload_danmaku_webview', { roomId });
  } catch (err) {
    console.warn('[tauriBridge] preload danmaku webview failed:', err);
    return false;
  }
}

/** 备份 live.douyin.com 全部 cookie（进程被杀时 WebView 内存 cookie 会丢失） */
export async function backupDouyinCookies(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string | null>('backup_douyin_cookies');
  } catch {
    return null;
  }
}

/** 恢复 cookie 到 CookieManager 并 flush 落盘 */
export async function restoreDouyinCookies(cookieHeader: string): Promise<boolean> {
  if (!isTauri() || !cookieHeader) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<boolean>('restore_douyin_cookies', { cookieHeader });
  } catch (err) {
    console.warn('[tauriBridge] restore cookies failed:', err);
    return false;
  }
}

export async function destroyDanmakuWebView(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('destroy_danmaku_webview');
  } catch (err) {
    console.error('[tauriBridge] destroy danmaku WebView failed:', err);
  }
}

export async function setProxySessionid(sessionid: string | null): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_sessionid', { sessionid });
  } catch (err) {
    console.error('[tauriBridge] set_sessionid failed:', err);
  }
}

/**
 * Resolve a v.douyin.com short link to its final landing URL via the Rust
 * backend (desktop UA + redirect follow, no CORS restrictions in WebView).
 * Returns null when not running inside Tauri or on failure.
 */
export async function resolveShortUrlRust(url: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string | null>('resolve_short_url', { url });
  } catch (err) {
    console.error('[tauriBridge] resolve_short_url failed:', err);
    return null;
  }
}

/**
 * Whether the keep-alive foreground service is currently running.
 */
export async function isForegroundServiceRunning(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<boolean>('is_foreground_service_running');
  } catch (err) {
    console.error('[tauriBridge] is_foreground_service_running failed:', err);
    return false;
  }
}

/**
 * Fetch a public URL's text body via the Rust backend (desktop UA, no CORS limits).
 * Returns null when not running inside Tauri or on failure.
 */
export async function fetchText(url: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string>('fetch_text', { url });
  } catch (err) {
    console.error('[tauriBridge] fetch_text failed:', err);
    return null;
  }
}

/**
 * Start downloading the update APK via the system DownloadManager.
 */
export async function startApkDownload(url: string, name: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('start_apk_download', { url, name });
  } catch (err) {
    console.error('[tauriBridge] start_apk_download failed:', err);
  }
}

/** APK 下载进度负载（对应 Rust `update-progress` 事件） */
export interface ApkProgress {
  downloaded: number;
  total: number;
  percent: number;
  done: boolean;
  path?: string | null;
  error?: string | null;
}

/**
 * 订阅 APK 下载进度事件；返回取消订阅函数。
 * 非 Tauri 环境返回空函数，调用方无需额外判空。
 */
export async function onApkDownloadProgress(
  cb: (p: ApkProgress) => void
): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { listen } = await import('@tauri-apps/api/event');
    const un = await listen<ApkProgress>('update-progress', e => cb(e.payload));
    return () => {
      try {
        un();
      } catch {
        // ignore
      }
    };
  } catch (err) {
    console.error('[tauriBridge] listen update-progress failed:', err);
    return () => {};
  }
}

/** 应用内下载更新 APK（带进度事件），成功返回文件绝对路径。 */
export async function downloadApkFile(url: string, name: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string>('download_apk', { url, name });
  } catch (err) {
    console.error('[tauriBridge] download_apk failed:', err);
    return null;
  }
}

/** 校验已下载的安装包是否仍然存在（缓存可能被系统清理）。 */
export async function isApkDownloaded(path: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<boolean>('apk_downloaded', { path });
  } catch (err) {
    console.error('[tauriBridge] apk_downloaded failed:', err);
    return false;
  }
}

/** 安装已下载的 APK（不重新下载）。 */
export async function installApkFile(path: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('install_apk', { path });
    return true;
  } catch (err) {
    console.error('[tauriBridge] install_apk failed:', err);
    return false;
  }
}

/**
 * Open the system "install unknown apps" settings page for this app.
 */
export async function openUnknownSourceSettings(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_unknown_source_settings');
  } catch (err) {
    console.error('[tauriBridge] open_unknown_source_settings failed:', err);
  }
}
