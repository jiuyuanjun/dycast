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
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      console.info('[tauriBridge] invoking get_proxy_port...');
      const port = await invoke<number | null>('get_proxy_port');
      console.info('[tauriBridge] proxy port =>', port);
      if (typeof port === 'number' && port > 0) {
        cachedPort = port;
        return port;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[tauriBridge] get_proxy_port invoke failed:', err);
    }
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
