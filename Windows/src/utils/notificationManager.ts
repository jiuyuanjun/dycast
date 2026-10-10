import { CastMethod, type DyMessage } from '@/core/dycast';
import {
  clearNotifications,
  loadNotificationSettings,
  loadRoomAutoReply,
  postNotification,
  saveNotificationSettings,
  saveRoomAutoReply,
  startForegroundService,
  stopForegroundService,
  isAppForeground,
  isIgnoringBatteryOptimizations,
  requestBatteryOptimizationWhitelist,
  requestAutostartSettings,
  showKeepAliveGuide,
  type NotificationSettings,
  type RoomAutoReply
} from './notification';

interface PendingNotification {
  category: 'chat' | 'gift' | 'enter' | 'follow' | 'fansclub' | 'like';
  title: string;
  body: string;
  timestamp: number;
}

/** 自动回复发送器（由 store 注入，避免循环依赖） */
export type AutoReplySender = (content: string) => Promise<boolean>;

class NotificationManager {
  private settings: NotificationSettings = loadNotificationSettings();
  private pending: PendingNotification[] = [];
  private mergeTimer: ReturnType<typeof setInterval> | null = null;
  /** 自动清理通知定时器（设置-通知设置-自动清理消息） */
  private autoClearTimer: ReturnType<typeof setInterval> | null = null;
  private lastBatteryCheck = 0;
  /** 当前连接的直播间（自动回复按房间隔离） */
  private currentRoom = '';
  /** 服务启停后通知外部（如设置页刷新状态徽标） */
  onStatusChange: (() => void) | null = null;
  /** 自动回复发送器（由 store 注入） */
  autoReplySender: AutoReplySender | null = null;
  /** 自动回复冷却：同一用户 N 秒内只回一次，防刷屏 */
  private autoReplyCooldown = new Map<string, number>();
  private static readonly AUTO_REPLY_COOLDOWN_MS = 15000;
  /** 前后台状态缓存：避免每条消息都做一次 JNI 调用（弹幕高峰期开销明显） */
  private foregroundCache: { value: boolean; at: number } = { value: true, at: 0 };
  private static readonly FOREGROUND_CACHE_MS = 1000;

  constructor() {
    this.startMergeTimer();
    this.startAutoClear();
  }

  /**
   * 获取应用前后台状态（带 1s 缓存）。
   * WebView 可见性是最快的免费判据：隐藏时直接判定为后台，避免频繁跨 JNI 查询。
   */
  private async resolveForeground(): Promise<boolean> {
    const now = Date.now();
    if (now - this.foregroundCache.at < NotificationManager.FOREGROUND_CACHE_MS) {
      return this.foregroundCache.value;
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      this.foregroundCache = { value: false, at: now };
      return false;
    }
    const value = await isAppForeground();
    this.foregroundCache = { value, at: now };
    return value;
  }

  getSettings(): NotificationSettings {
    return this.settings;
  }

  /** 当前直播间（自动回复隔离上下文） */
  getCurrentRoom(): string {
    return this.currentRoom;
  }

  /**
   * 切换当前直播间（连接成功后调用）。
   * 自动回复按房间隔离：切换房间时自动加载该房间的开关与规则。
   */
  setCurrentRoom(roomNum: string) {
    if (!roomNum || roomNum === this.currentRoom) return;
    // 先保存旧房间的自动回复配置（如果之前处于某个房间）
    this.persistAutoReply();
    this.currentRoom = roomNum;
    // 加载新房间的自动回复配置；未配置过则使用全局默认（关 + 空规则）
    const roomCfg = loadRoomAutoReply(roomNum);
    if (roomCfg) {
      this.settings.autoReplyEnabled = roomCfg.enabled;
      this.settings.autoReplyRules = roomCfg.rules;
    } else {
      this.settings.autoReplyEnabled = false;
      this.settings.autoReplyRules = [];
    }
  }

  /** 退出房间/断开连接时调用：保存当前房间配置并清空当前房间标记 */
  clearCurrentRoom() {
    this.persistAutoReply();
    this.currentRoom = '';
  }

  /** 将当前 settings 中的自动回复配置落盘到当前房间（房间隔离存储） */
  private persistAutoReply() {
    if (!this.currentRoom) return;
    const cfg: RoomAutoReply = {
      enabled: this.settings.autoReplyEnabled,
      rules: this.settings.autoReplyRules
    };
    saveRoomAutoReply(this.currentRoom, cfg);
  }

  updateSettings(partial: Partial<NotificationSettings>): NotificationSettings {
    this.settings = { ...this.settings, ...partial };
    saveNotificationSettings(this.settings);
    // 自动回复相关变更同步到当前房间的隔离存储
    if (partial.autoReplyEnabled !== undefined || partial.autoReplyRules !== undefined) {
      this.persistAutoReply();
    }
    // 自动清理间隔变更：重置定时器
    if (partial.autoClearSeconds !== undefined) {
      this.startAutoClear();
    }
    this.syncKeepAlive();
    return this.settings;
  }

  /**
   * 自动清理通知：按"设置-通知设置-自动清理消息"配置的间隔（秒）周期性清空通知栏，
   * 防止通知堆积过多后系统不再显示新通知。0 = 不清理。
   */
  private startAutoClear() {
    if (this.autoClearTimer) {
      clearInterval(this.autoClearTimer);
      this.autoClearTimer = null;
    }
    const seconds = Number(this.settings.autoClearSeconds) || 0;
    if (seconds <= 0) return;
    this.autoClearTimer = setInterval(() => {
      clearNotifications().then(ok => {
        if (!ok) console.warn('[NotificationManager] 自动清理通知失败');
      });
    }, seconds * 1000);
  }

  async init() {
    // 严格按"后台保活"开关同步服务：开→启动，关→显式停止。
    // 修复：此前关闭保活后重启 App，服务仍会被拉起且不会被停止。
    if (this.settings.keepAlive) {
      await startForegroundService();
    } else {
      await stopForegroundService();
    }
    this.maybePromptBatteryOptimization();
  }

  async syncKeepAlive() {
    if (this.settings.keepAlive) {
      await startForegroundService();
    } else {
      await stopForegroundService();
    }
    // 服务启停是异步的，延迟刷新状态徽标避免读到旧值
    setTimeout(() => this.onStatusChange?.(), 1200);
  }

  /** 退出登录时调用：无论保活开关状态，立即停止前台服务并关闭保活开关。 */
  async stopOnLogout() {
    this.settings.keepAlive = false;
    saveNotificationSettings(this.settings);
    await stopForegroundService();
    setTimeout(() => this.onStatusChange?.(), 1200);
  }

  /** 直播结束时调用：停止后台保活前台服务（不登出、不清空会话），让进程不再驻留后台。 */
  async stopOnLiveEnd() {
    this.settings.keepAlive = false;
    saveNotificationSettings(this.settings);
    await stopForegroundService();
    setTimeout(() => this.onStatusChange?.(), 1200);
  }

  async maybePromptBatteryOptimization() {
    if (this.settings.batteryOptimizationAsked) return;
    const ignored = await isIgnoringBatteryOptimizations();
    if (!ignored) {
      await showKeepAliveGuide();
    }
    this.updateSettings({ batteryOptimizationAsked: true });
  }

  async openBatteryWhitelist() {
    await requestBatteryOptimizationWhitelist();
  }

  async openAutostartSettings() {
    await requestAutostartSettings();
  }

  /**
   * Process incoming DyCast messages and enqueue notifications according to settings.
   */
  async handleMessages(msgs: DyMessage[]) {
    try {
      if (!this.settings.enabled) return;

      const foreground = await this.resolveForeground();
      if (foreground && !this.settings.foregroundEnabled) return;
      if (!foreground && !this.settings.backgroundEnabled) return;

      for (const msg of msgs) {
        const pending = this.toPending(msg);
        if (!pending) continue;
        if (!this.settings.categories[pending.category]) continue;
        this.pending.push(pending);
      }

      if (this.settings.mergeSeconds <= 0) {
        this.flush();
      }

      // 自动回复：检测弹幕命中关键词后自动发送预设内容（防刷屏：同用户 15s 冷却）
      if (this.settings.autoReplyEnabled && this.settings.autoReplyRules.length) {
        this.tryAutoReply(msgs);
      }
    } catch (err) {
      console.error('[NotificationManager] handleMessages failed:', err);
    }
  }

  /** 自动回复检测与发送 */
  private tryAutoReply(msgs: DyMessage[]) {
    const sender = this.autoReplySender;
    if (!sender) return;
    const now = Date.now();
    for (const msg of msgs) {
      // 只处理弹幕消息
      if (msg.method !== CastMethod.CHAT && msg.method !== CastMethod.EMOJI_CHAT) continue;
      const content = msg.content || '';
      const userId = msg.user?.id || msg.user?.name || '';
      if (!content || !userId) continue;

      // 冷却检查：同一用户 15s 内不重复回复
      const last = this.autoReplyCooldown.get(userId) || 0;
      if (now - last < NotificationManager.AUTO_REPLY_COOLDOWN_MS) continue;

      // 关键词匹配（包含即命中）
      const rule = this.settings.autoReplyRules.find(r => {
        const kw = (r.keyword || '').trim();
        return kw && content.includes(kw);
      });
      if (!rule || !(rule.reply || '').trim()) continue;

      this.autoReplyCooldown.set(userId, now);
      const reply = (rule.reply || '').trim();
      // 支持 @ 原用户：{user} 占位符替换为 @昵称
      const finalReply = reply.includes('{user}')
        ? reply.replace(/\{user\}/g, `@${msg.user?.name || ''}`)
        : reply;
      console.info('[AutoReply] 命中关键词自动回复 =>', finalReply);
      sender(finalReply).then(ok => {
        if (!ok) console.warn('[AutoReply] 自动回复发送失败');
      });
    }
  }

  private toPending(msg: DyMessage): PendingNotification | null {
    const user = msg.user?.name || '未知用户';
    switch (msg.method) {
      case CastMethod.CHAT:
      case CastMethod.EMOJI_CHAT:
        if (!this.settings.categories.chat) return null;
        return {
          category: 'chat',
          title: `${user}`,
          body: msg.content || '',
          timestamp: Date.now()
        };
      case CastMethod.GIFT:
        if (!this.settings.categories.gift) return null;
        return {
          category: 'gift',
          title: `${user}`,
          body: `送出了 ${msg.gift?.name || '礼物'} ×${msg.gift?.count || 1}`,
          timestamp: Date.now()
        };
      case CastMethod.MEMBER:
        if (!this.settings.categories.enter) return null;
        return {
          category: 'enter',
          title: `${user}`,
          body: msg.content || '进入了直播间',
          timestamp: Date.now()
        };
      case CastMethod.SOCIAL:
        if (!this.settings.categories.follow) return null;
        return {
          category: 'follow',
          title: `${user}`,
          body: msg.content || '关注了直播间',
          timestamp: Date.now()
        };
      case CastMethod.FANSCLUB:
        if (!this.settings.categories.fansclub) return null;
        return {
          category: 'fansclub',
          title: `${user}`,
          body: msg.content || '加入了粉丝团',
          timestamp: Date.now()
        };
      case CastMethod.LIKE:
        if (!this.settings.categories.like) return null;
        return {
          category: 'like',
          title: `${user}`,
          // msg.content 形如"为主播点赞了(5)"，直接使用；缺失时给默认文案
          body: msg.content || '点赞了直播间',
          timestamp: Date.now()
        };
      default:
        return null;
    }
  }

  private startMergeTimer() {
    if (this.mergeTimer) return;
    this.mergeTimer = setInterval(() => {
      if (this.pending.length === 0) return;
      if (this.settings.mergeSeconds <= 0) return;
      const deadline = Date.now() - this.settings.mergeSeconds * 1000;
      if (this.pending.some(item => item.timestamp <= deadline)) {
        this.flush();
      }
    }, 1000);
  }

  private flush() {
    if (this.pending.length === 0) return;

    // Group by category and merge bodies.
    const groups = new Map<string, PendingNotification[]>();
    for (const item of this.pending) {
      const list = groups.get(item.category) || [];
      list.push(item);
      groups.set(item.category, list);
    }

    this.pending = [];

    for (const [category, list] of groups) {
      if (list.length === 1) {
        const item = list[0];
        postNotification({
          category: item.category as any,
          title: item.title,
          body: item.body,
          group: category
        });
      } else {
        const mergedBody = list.map(it => `${it.title}: ${it.body}`).join('\n');
        const categoryName = {
          chat: '弹幕',
          gift: '礼物',
          enter: '进入',
          follow: '关注',
          fansclub: '粉丝团',
          like: '点赞'
        }[category] || category;
        postNotification({
          category: category as any,
          title: `抖音直播弹幕助手 ${categoryName} (${list.length})`,
          body: mergedBody.length > 500 ? mergedBody.slice(0, 500) + '...' : mergedBody,
          group: category
        });
      }
    }
  }

  destroy() {
    if (this.mergeTimer) {
      clearInterval(this.mergeTimer);
      this.mergeTimer = null;
    }
    if (this.autoClearTimer) {
      clearInterval(this.autoClearTimer);
      this.autoClearTimer = null;
    }
    this.flush();
  }
}

export const notificationManager = new NotificationManager();
