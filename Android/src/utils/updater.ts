/**
 * 版本自动更新：通过 Git 托管平台 Releases 公开 API（免登录）检查新版本，应用内下载（带进度条）并安装。
 * 更新源：GitHub Releases（原 Gitee 已被平台封禁，2026-10-10 实测 API 404 / raw 403，弃用）。
 */
import { getVersion } from '@tauri-apps/api/app';
import {
  downloadApkFile,
  fetchText,
  installApkFile,
  isApkDownloaded,
  onApkDownloadProgress,
  startApkDownload,
  type ApkProgress
} from './tauriBridge';

/**
 * 更新源配置：GitHub Releases 公开 API（可随时改 owner/repo 指向新仓库）。
 * 平台可用性汇总（2026-10-10 实测）：
 *  - GitHub api.github.com/repos/{owner}/{repo}/releases/latest → 200（仓库存在时）
 *  - Gitee gitee.com/api/v5/... → 404（仓库被封）；raw gitee.com/.../raw/... → 403
 */
export const UPDATE_SOURCE = {
  owner: 'jiuyuanjun',
  repo: 'dycast'
};

/** GitHub Releases API（免登录公开读取） */
export const RELEASE_API = `https://api.github.com/repos/${UPDATE_SOURCE.owner}/${UPDATE_SOURCE.repo}/releases/latest`;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LAST_CHECK_KEY = 'dycast_last_update_check';
/** 已下载好但用户还没安装的更新包（避免下次重复下载） */
const DOWNLOADED_KEY = 'dycast_update_downloaded';

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
  /** 无可用正式版（例如仓库不存在 / 只存在 prerelease 测试版） */
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
    const msg = String((err as Error)?.message || err || '');
    // 404 = 更新源仓库/版本不存在（如仓库未创建或从未发布过 Release），给出可行动提示
    if (/404|not found|HTTP 404/i.test(msg)) {
      return { hasUpdate: false, error: '更新源暂未发布版本，请稍后再试' };
    }
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

/** 下载更新 APK（系统 DownloadManager，通知栏进度，完成后自动拉起安装器）。 */
export async function downloadUpdate(info: UpdateInfo): Promise<boolean> {
  if (!info.apkUrl || !info.apkName) return false;
  await startApkDownload(info.apkUrl, info.apkName);
  return true;
}

/** 已下载待安装的更新包记录 */
export interface DownloadedApk {
  /** 该安装包对应的版本号（不带 v 前缀） */
  version: string;
  /** 安装包在设备上的绝对路径 */
  path: string;
  /** 字节数（用于展示） */
  size?: number;
  /** 下载完成时间（毫秒时间戳） */
  at?: number;
}

/** 读取"已下载待安装"记录（不校验文件是否还在，见 getDownloadedApk） */
export function getDownloadedRecord(): DownloadedApk | null {
  try {
    const raw = localStorage.getItem(DOWNLOADED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DownloadedApk;
    return parsed && parsed.path && parsed.version ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 取指定版本（不传则任意版本）已下载且仍存在的安装包。
 * 文件被系统清理或路径失效时自动清除记录，返回 null 让调用方重新下载。
 */
export async function getDownloadedApk(version?: string): Promise<DownloadedApk | null> {
  const rec = getDownloadedRecord();
  if (!rec) return null;
  if (version && rec.version !== version) return null;
  const alive = await isApkDownloaded(rec.path);
  if (!alive) {
    clearDownloadedRecord();
    return null;
  }
  return rec;
}

/** 记录已下载的安装包（供"稍后安装"后下次直接安装，不再重复下载） */
export function saveDownloadedRecord(rec: DownloadedApk): void {
  try {
    localStorage.setItem(DOWNLOADED_KEY, JSON.stringify(rec));
  } catch {
    // ignore
  }
}

/** 清除已下载记录（安装完成或文件失效时调用） */
export function clearDownloadedRecord(): void {
  try {
    localStorage.removeItem(DOWNLOADED_KEY);
  } catch {
    // ignore
  }
}

/**
 * 应用内下载更新包，实时回调进度。成功返回安装包记录，失败返回 null。
 * @param onProgress 进度回调（服务端未返回总大小时 percent 为 0）
 */
export async function downloadUpdateWithProgress(
  info: UpdateInfo,
  onProgress?: (p: ApkProgress) => void
): Promise<DownloadedApk | null> {
  if (!info.apkUrl || !info.apkName || !info.latestVersion) return null;
  let finalBytes = 0;
  const off = await onApkDownloadProgress(p => {
    if (p.downloaded > finalBytes) finalBytes = p.downloaded;
    onProgress?.(p);
  });
  try {
    const path = await downloadApkFile(info.apkUrl, info.apkName);
    if (!path) return null;
    const rec: DownloadedApk = {
      version: info.latestVersion,
      path,
      size: finalBytes || undefined,
      at: Date.now()
    };
    saveDownloadedRecord(rec);
    return rec;
  } finally {
    off();
  }
}

/** 安装已下载的更新包（不重新下载） */
export async function installDownloadedApk(rec: DownloadedApk): Promise<boolean> {
  const alive = await isApkDownloaded(rec.path);
  if (!alive) {
    clearDownloadedRecord();
    return false;
  }
  return installApkFile(rec.path);
}

/**
 * 用户点"暂不/稍后"后的忽略记录。
 * 注意：仅对本次运行有效（不写 localStorage）——用户下次打开 App 时仍会再次提示，
 * 此时若安装包已下载好，可直接安装而无需重复下载。
 */
const dismissedThisSession = new Set<string>();

export function markDismissed(version: string): void {
  if (version) dismissedThisSession.add(version);
}

export function isDismissed(version?: string): boolean {
  return !!version && dismissedThisSession.has(version);
}

/** 当前应用版本号。 */
export async function getCurrentVersion(): Promise<string> {
  return getVersion().catch(() => '');
}
