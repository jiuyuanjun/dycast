import { invoke } from '@tauri-apps/api/core';

export interface NotificationSettings {
  /** Main master switch */
  enabled: boolean;
  /** Push notifications when app is in foreground */
  foregroundEnabled: boolean;
  /** Push notifications when app is in background */
  backgroundEnabled: boolean;
  /** Category switches */
  categories: {
    chat: boolean;
    gift: boolean;
    enter: boolean;
    follow: boolean;
    fansclub: boolean;
    like: boolean;
  };
  /** Merge window in seconds (0 = disabled) */
  mergeSeconds: number;
  /** 自动清理通知间隔（秒）：每隔该时长清空一次通知栏，0 = 不清理 */
  autoClearSeconds: number;
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
  mergeSeconds: 5,
  keepAlive: true,
  autoClearSeconds: 300,
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
  id?: number;
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
