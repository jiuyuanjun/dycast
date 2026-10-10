/**
 * 前端热更新：小功能 / bug 修复免装 APK。
 *
 * 链路：清单(manifest.json) → Rust 下载文件到 app_data/hotupdate/{version}/ →
 * 本模块写启动标记 localStorage['dycast_hot_boot'] → location.reload() →
 * index.html 内置引导脚本经 hotres:// 自定义协议加载新版资源。
 * 失败防护：引导脚本 8s 看门狗 + sessionStorage 防循环，异常时自动回退内置资源。
 */
import { invoke } from '@tauri-apps/api/core';

/**
 * 默认热更清单地址：GitHub 仓库 hot/manifest.json（public-clean 分支，与默认分支一致）。
 * 原 Gitee raw 已被平台封禁（403），改走 GitHub；manifest 需随前端构建产物推送到
 * 仓库 `hot/` 目录（由 scripts/make-hot-manifest.mjs 生成后 commit 到默认分支）。
 */
export const HOT_MANIFEST_URL = 'https://raw.githubusercontent.com/jiuyuanjun/dycast/public-clean/hot/manifest.json';

const BOOT_KEY = 'dycast_hot_boot';

export interface HotCheckInfo {
  available: boolean;
  version?: string | null;
  notes?: string | null;
  currentHot?: string | null;
  currentApp?: string;
  /** true = 热更版本与当前 APK 不匹配（应用已升级，旧热更作废） */
  incompatible?: boolean;
  error?: string;
  /** 本次检查实际使用的清单地址（用于安装时保证检查/安装同源） */
  sourceUrl?: string;
}

export interface HotApplyResult {
  version: string;
  entryJs: string;
  entryCss?: string | null;
}

interface HotBootConfig {
  version: string;
  js: string;
  css?: string;
}

/** 当前生效的热更版本（未启用返回 null） */
export function getActiveHotVersion(): string | null {
  try {
    const raw = localStorage.getItem(BOOT_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw) as HotBootConfig;
    return cfg?.version || null;
  } catch {
    return null;
  }
}

/** 检查热更新：默认检查 GitHub 仓库的发布清单；可显式传入 URL 测试新清单。 */
export async function checkHotUpdate(manifestUrl: string = HOT_MANIFEST_URL): Promise<HotCheckInfo> {
  const info = await invoke<HotCheckInfo>('hot_check', { manifestUrl });
  // APK 已升级导致旧热更失配：清掉本地启动标记，回退内置资源
  if (info.incompatible && getActiveHotVersion()) {
    localStorage.removeItem(BOOT_KEY);
  }
  return { ...info, sourceUrl: manifestUrl };
}

/** 下载并应用热更新；成功后写启动标记，刷新页面（location.reload）后生效。 */
export async function applyHotUpdate(manifestUrl: string = HOT_MANIFEST_URL): Promise<HotApplyResult> {
  const result = await invoke<HotApplyResult>('hot_apply', { manifestUrl });
  const cfg: HotBootConfig = {
    version: result.version,
    js: result.entryJs,
    css: result.entryCss || undefined
  };
  localStorage.setItem(BOOT_KEY, JSON.stringify(cfg));
  // 清除本会话的回退标记：此前失败过一次的热更会话内标记仍会让引导脚本拒绝加载
  // 新热更（表现为"显示已安装、实际跑的还是内置资源"），安装新包时必须放开
  try {
    sessionStorage.removeItem('dycast_hot_fallback');
  } catch {
    // ignore
  }
  return result;
}

/** 回滚热更新：清除启动标记并删除原生版本标记，刷新后回到内置资源 */
export async function rollbackHotUpdate(): Promise<void> {
  localStorage.removeItem(BOOT_KEY);
  try {
    await invoke('hot_rollback');
  } catch {
    // 本地标记已清即可回退，原生标记残留无副作用
  }
}
