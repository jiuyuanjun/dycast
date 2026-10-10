/**
 * 版本自动更新：通过 Gitee Releases 公开 API（免登录）检查新版本并下载 APK。
 * 更新源：https://gitee.com/jiuyuanjun/dycast（releases/latest）
 */
import { getVersion } from '@tauri-apps/api/app';
import { fetchText, startApkDownload } from './tauriBridge';

const RELEASE_API = 'https://gitee.com/api/v5/repos/jiuyuanjun/dycast/releases/latest';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LAST_CHECK_KEY = 'dycast_last_update_check';
const DISMISSED_KEY = 'dycast_update_dismissed_version';

export interface UpdateInfo {
  hasUpdate: boolean;
  /** 最新版本号（不带 v 前缀） */
  latestVersion?: string;
  /** 当前版本号 */
  currentVersion?: string;
  /** 更新说明（Release body） */
  notes?: string;
  /** APK 下载直链 */
  apkUrl?: string;
  /** APK 文件名 */
  apkName?: string;
  /** 检查失败原因（网络异常 / API 解析失败）；为空表示本次检查成功 */
  error?: string;
  /** 无可用正式版（例如 Gitee 上只存在 prerelease 测试版） */
  noRelease?: boolean;
}

/** semver 风格版本比较：>0 表示 a 更新，<0 表示 b 更新，0 相同 */
export function compareVersion(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

/**
 * 检查更新。
 * @param force true = 手动检查（忽略 24h 节流）；false = 静默检查（24h 一次）
 */
export async function checkUpdate(force = false): Promise<UpdateInfo> {
  const none: UpdateInfo = { hasUpdate: false };
  try {
    const last = Number(localStorage.getItem(LAST_CHECK_KEY) || 0);
    if (!force && Date.now() - last < CHECK_INTERVAL_MS) return none;
  } catch {
    // localStorage 不可用时按 force 处理
  }
  const currentVersion = await getVersion().catch(() => '0.0.0');
  let text: string | null = null;
  try {
    text = await fetchText(RELEASE_API);
  } catch (err) {
    console.error('[updater] fetch release failed:', err);
    // 网络失败不写入节流时间：下次启动仍会重试（否则一次断网会静默 24h 不再检查）
    return { hasUpdate: false, error: '网络请求失败，请检查网络连接' };
  }
  if (!text) return { hasUpdate: false, error: '获取版本信息失败，请稍后重试' };

  // 请求成功后再记录检查时间，用于 24h 静默检查节流
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
  } catch {
    // ignore
  }

  try {
    const data = JSON.parse(text);
    if (data && data.message && /404|not found/i.test(String(data.message))) {
      return { hasUpdate: false, noRelease: true };
    }
    if (data.prerelease === true) return { hasUpdate: false, noRelease: true };
    const latestVersion = String(data.tag_name || '').replace(/^v/i, '').trim();
    const asset = (data.assets || []).find((a: { name?: string; browser_download_url?: string }) =>
      a.name && a.name.toLowerCase().endsWith('.apk') && a.browser_download_url);
    if (!latestVersion || !asset) return { hasUpdate: false, noRelease: true };
    const hasUpdate = compareVersion(latestVersion, currentVersion) > 0;
    return {
      hasUpdate,
      latestVersion,
      currentVersion,
      notes: String(data.body || '').trim(),
      apkUrl: asset.browser_download_url,
      apkName: asset.name
    };
  } catch (err) {
    console.error('[updater] parse release failed:', err);
    return { hasUpdate: false, error: '版本信息解析失败' };
  }
}

/** 下载更新 APK（系统 DownloadManager，完成后自动拉起安装器）。 */
export async function downloadUpdate(info: UpdateInfo): Promise<boolean> {
  if (!info.apkUrl || !info.apkName) return false;
  await startApkDownload(info.apkUrl, info.apkName);
  return true;
}

/** 用户点"暂不"后，同一版本不再自动弹窗。 */
export function markDismissed(version: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    // ignore
  }
}

export function isDismissed(version?: string): boolean {
  if (!version) return false;
  try {
    return localStorage.getItem(DISMISSED_KEY) === version;
  } catch {
    return false;
  }
}

/** 当前应用版本号。 */
export async function getCurrentVersion(): Promise<string> {
  return getVersion().catch(() => '');
}
