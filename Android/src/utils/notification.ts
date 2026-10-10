import { invoke } from '@tauri-apps/api/core';

/** 通知类别（常量集合，前端与原生共用） */
export type NotifyCategory = 'chat' | 'gift' | 'enter' | 'follow' | 'fansclub' | 'like';
/** 每类消息的展示方式：merge 合并刷新 / independent 每条独立 / perUser 按用户合并 */
export type CatMode = 'merge' | 'independent' | 'perUser';
/** 每类消息的重要性/打扰级别（对应 Android channel IMPORTANCE） */
export type CatImportance = 'min' | 'low' | 'default' | 'high';
/** 锁屏可见性 */
export type LockVisibility = 'public' | 'private' | 'secret';

export interface NotificationSettings {
  /** Main master switch */
  enabled: boolean;
  /** Push notifications when app is in foreground */
  foregroundEnabled: boolean;
  /** Push notifications when app is in background */
  backgroundEnabled: boolean;
  /** 前端与原生按类别展示/合并时使用的类别集合 */
  categories: Record<NotifyCategory, boolean>;
  /** 每类消息的展示方式（用户可配）：merge / independent / perUser */
  categoryModes: Record<NotifyCategory, CatMode>;
  /** 每类消息的重要性/打扰级别（用户可配） */
  categoryImportance: Record<NotifyCategory, CatImportance>;
  /** 锁屏可见性（全局，用户可配） */
  lockVisibility: LockVisibility;
  /** Merge window in seconds (0 = disabled) */
  mergeSeconds: number;
  /** 是否按时间清理通知 */
  timeCleanupEnabled: boolean;
  /** 时间清理阈值（秒） */
  autoClearSeconds: number;
  /** 是否按数量限制通知 */
  countCleanupEnabled: boolean;
  /** 最多保留的消息通知数量，0 = 不限制 */
  maxNotificationCount: number;
  /** Whether to keep the foreground service alive in background */
  keepAlive: boolean;
  /** Whether user has been asked for battery whitelist */
  batteryOptimizationAsked: boolean;
  /** 自动回复：总开关（当前房间） */
  autoReplyEnabled: boolean;
  /** 自动回复规则：关键词 -> 回复内容（当前房间） */
  autoReplyRules: { keyword: string; reply: string }[];
}

/** 自动回复按房间隔离：每个房间独立保存开关 + 规则 */
export interface RoomAutoReply {
  enabled: boolean;
  rules: { keyword: string; reply: string }[];
}

/** 每类消息的展示方式默认值 */
const DEFAULT_CATEGORY_MODES: Record<NotifyCategory, CatMode> = {
  chat: 'independent', // 弹幕：每条独立
  gift: 'perUser', // 礼物：按 用户+礼物 合并
  enter: 'merge', // 进入：合并刷新
  follow: 'merge',
  fansclub: 'merge',
  like: 'perUser' // 点赞：按用户合并
};

/** 每类消息的重要性/打扰级别默认值（与旧版渠道 IMPORTANCE 保持一致：礼物高、点赞低、其余中） */
const DEFAULT_CATEGORY_IMPORTANCE: Record<NotifyCategory, CatImportance> = {
  chat: 'default',
  gift: 'high',
  enter: 'default',
  follow: 'default',
  fansclub: 'default',
  like: 'low'
};

const DEFAULT_LOCK_VISIBILITY: LockVisibility = 'private';

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  foregroundEnabled: false,
  backgroundEnabled: true,
  categories: {
    chat: false,
    gift: true,
    enter: true,
    follow: true,
    fansclub: true,
    like: false
  },
  categoryModes: { ...DEFAULT_CATEGORY_MODES },
  categoryImportance: { ...DEFAULT_CATEGORY_IMPORTANCE },
  lockVisibility: DEFAULT_LOCK_VISIBILITY,
  mergeSeconds: 5,
  keepAlive: true,
  timeCleanupEnabled: true,
  autoClearSeconds: 300,
  countCleanupEnabled: false,
  maxNotificationCount: 100,
  batteryOptimizationAsked: false,
  autoReplyEnabled: false,
  autoReplyRules: []
};

const STORAGE_KEY = 'dycast_notification_settings';

/** 自动回复按房间隔离的存储 key：roomNum -> RoomAutoReply */
const AUTO_REPLY_ROOM_KEY = 'dycast_auto_reply_by_room';

export function loadNotificationSettings(): NotificationSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_NOTIFICATION_SETTINGS;
    const parsed = JSON.parse(raw);
    const settings = { ...DEFAULT_NOTIFICATION_SETTINGS, ...parsed };
    // Migrate old combined "social" category to three separate toggles.
    if (parsed.categories && typeof parsed.categories.social === 'boolean') {
      const socialValue = parsed.categories.social;
      settings.categories.enter = socialValue;
      settings.categories.follow = socialValue;
      settings.categories.fansclub = socialValue;
      delete (settings.categories as any).social;
    }
    // 新字段（展示方式 / 重要性 / 锁屏可见性）按默认值补全，保证 6 类都有合法枚举值。
    settings.categoryModes = { ...DEFAULT_CATEGORY_MODES, ...(parsed.categoryModes || {}) };
    settings.categoryImportance = { ...DEFAULT_CATEGORY_IMPORTANCE, ...(parsed.categoryImportance || {}) };
    if (!settings.lockVisibility) settings.lockVisibility = DEFAULT_LOCK_VISIBILITY;
    if (typeof settings.timeCleanupEnabled !== 'boolean') settings.timeCleanupEnabled = true;
    if (typeof settings.countCleanupEnabled !== 'boolean') settings.countCleanupEnabled = false;
    if (typeof settings.maxNotificationCount !== 'number') settings.maxNotificationCount = 100;
    return settings;
  } catch {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
}

export function saveNotificationSettings(settings: NotificationSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/**
 * 读取指定房间的自动回复配置（未配置返回 null）。
 * 通过房间号隔离，不同直播间各自独立的开关与规则。
 */
export function loadRoomAutoReply(roomNum: string): RoomAutoReply | null {
  if (!roomNum) return null;
  try {
    const raw = localStorage.getItem(AUTO_REPLY_ROOM_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw);
    return map?.[roomNum] || null;
  } catch {
    return null;
  }
}

/**
 * 保存指定房间的自动回复配置。
 */
export function saveRoomAutoReply(roomNum: string, config: RoomAutoReply): void {
  if (!roomNum) return;
  try {
    const raw = localStorage.getItem(AUTO_REPLY_ROOM_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[roomNum] = config;
    localStorage.setItem(AUTO_REPLY_ROOM_KEY, JSON.stringify(map));
  } catch (e) {
    console.error('[notification] save room auto reply failed:', e);
  }
}

/**
 * 删除指定房间的自动回复配置（切房间清理等场景）。
 */
export function removeRoomAutoReply(roomNum: string): void {
  if (!roomNum) return;
  try {
    const raw = localStorage.getItem(AUTO_REPLY_ROOM_KEY);
    if (!raw) return;
    const map = JSON.parse(raw);
    delete map[roomNum];
    localStorage.setItem(AUTO_REPLY_ROOM_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export async function startForegroundService(): Promise<void> {
  await invoke('start_foreground_service').catch(err => {
    console.error('[notification] start foreground service failed:', err);
  });
}

export async function stopForegroundService(): Promise<void> {
  await invoke('stop_foreground_service').catch(err => {
    console.error('[notification] stop foreground service failed:', err);
  });
}

export async function isForegroundServiceRunning(): Promise<boolean> {
  try {
    return await invoke<boolean>('is_foreground_service_running');
  } catch {
    return false;
  }
}

export async function postNotification(payload: {
  category: 'chat' | 'gift' | 'enter' | 'follow' | 'fansclub' | 'like';
  title: string;
  body: string;
  group?: string;
  /** 固定通知 id：同一 id 会覆盖同一条通知（不传则退化为内容哈希，通知会越堆越多） */
  id?: number;
  /** 本次刷新代表的消息条数，用于汇总通知计数 */
  count?: number;
  /** 每用户累加标识：like 用用户名、gift 用 "用户名|礼物名"；传了才走 x1/x2 累加 */
  actionKey?: string;
  /** 操作文案模板（如 "点赞了直播间" / "送出了 玫瑰"），配合 actionKey 渲染累加数 */
  actionText?: string;
  /** 每条消息独立一条通知（true 时不传固定 id，原生侧分配唯一 id） */
  independent?: boolean;
  /** 该类消息的重要性/打扰级别（用于原生建/改 channel） */
  importance?: CatImportance;
  /** 锁屏可见性（映射 PUBLIC/PRIVATE/SECRET） */
  visibility?: LockVisibility;
}): Promise<boolean> {
  try {
    return await invoke<boolean>('post_notification', { payload: JSON.stringify(payload) });
  } catch (err) {
    console.error('[notification] post notification failed:', err);
    return false;
  }
}

export async function isAppForeground(): Promise<boolean> {
  try {
    return await invoke<boolean>('is_app_foreground');
  } catch {
    // fail-open：判定失败时按"后台"处理（继续推送通知）。
    // 若返回 true，配合默认 foregroundEnabled=false 会导致通知被静默全部丢弃。
    return false;
  }
}

export async function isIgnoringBatteryOptimizations(): Promise<boolean> {
  try {
    return await invoke<boolean>('is_ignoring_battery_optimizations');
  } catch {
    return false;
  }
}

export async function requestBatteryOptimizationWhitelist(): Promise<void> {
  await invoke('request_battery_optimization_whitelist').catch(err => {
    console.error('[notification] request battery whitelist failed:', err);
  });
}

export async function requestAutostartSettings(): Promise<void> {
  await invoke('request_autostart_settings').catch(err => {
    console.error('[notification] request autostart failed:', err);
  });
}

export async function showKeepAliveGuide(): Promise<void> {
  await invoke('show_keep_alive_guide').catch(err => {
    console.error('[notification] show keep alive guide failed:', err);
  });
}

/**
 * 清空通知栏中的所有 DyCast 通知。
 * 由"自动清理消息"定时器周期性调用，避免通知堆积过多导致系统不再显示新通知。
 */
export async function clearNotifications(): Promise<boolean> {
  try {
    await invoke('clear_notifications');
    return true;
  } catch (err) {
    console.error('[notification] clear notifications failed:', err);
    return false;
  }
}

/**
 * 按"消息保留时长"删除超时的通知（只删老的，新消息不受影响）。
 * @param maxAgeSeconds 保留时长（秒）；<= 0 表示不清理
 */
export async function clearExpiredNotifications(maxAgeSeconds: number): Promise<boolean> {
  if (!maxAgeSeconds || maxAgeSeconds <= 0) return true;
  try {
    await invoke('clear_expired_notifications', { maxAgeSeconds });
    return true;
  } catch (err) {
    console.error('[notification] clear expired notifications failed:', err);
    return false;
  }
}

/**
 * 把通知设置镜像到原生侧（内存 + SharedPreferences）。
 * 后台时由 Rust notify_backend 按这份镜像独立决定是否发通知，
 * 保证后台通知的开关 / 类别过滤与前台完全一致。
 */
export async function syncNativeSettings(settings: NotificationSettings): Promise<void> {
  const payload = {
    enabled: settings.enabled,
    backgroundEnabled: settings.backgroundEnabled,
    categories: settings.categories,
    categoryModes: settings.categoryModes,
    categoryImportance: settings.categoryImportance,
    lockVisibility: settings.lockVisibility,
    timeCleanupEnabled: settings.timeCleanupEnabled,
    autoClearSeconds: settings.autoClearSeconds,
    countCleanupEnabled: settings.countCleanupEnabled,
    maxNotificationCount: settings.maxNotificationCount
  };
  await invoke('sync_native_settings', { settingsJson: JSON.stringify(payload) }).catch(err => {
    console.error('[notification] sync native settings failed:', err);
  });
}
