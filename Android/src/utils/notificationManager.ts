import { CastMethod, type DyMessage } from '@/core/dycast';
import {
  clearExpiredNotifications,
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
  syncNativeSettings,
  type NotificationSettings,
  type RoomAutoReply
} from './notification';

interface PendingNotification {
  category: 'chat' | 'gift' | 'enter' | 'follow' | 'fansclub' | 'like';
  title: string;
  body: string;
  timestamp: number;
  /** 单次事件携带的数量（点赞数 / 礼物数量），用于 xN 累加；其余类别忽略 */
  count?: number;
  /** 每用户累加标识（like=用户名，gift="用户名|礼物名"）；点赞/礼物特有 */
  actionKey?: string;
  /** 操作文案模板（如 "点赞了直播间" / "送出了 玫瑰"） */
  actionText?: string;
}

type NotifyCategory = PendingNotification['category'];

/**
 * 每个类别一个**固定通知 id**。
 * Android 的 notify(id, ...) 在 id 相同时会"覆盖"旧通知而不是新建，
 * 因此同类消息始终只占 1 条通知、内容实时刷新 —— 这就是"更新消息"的实现方式。
 * 过去不传 id，Kotlin 侧兜底生成"内容 + 时间戳"哈希，于是每条消息都会新弹一个。
 */
const CATEGORY_NOTIFY_ID: Record<NotifyCategory, number> = {
  chat: 2001,
  gift: 2002,
  enter: 2003,
  follow: 2004,
  fansclub: 2005,
  like: 2006
};

/** 类别中文名（通知标题用） */
const CATEGORY_NAME: Record<NotifyCategory, string> = {
  chat: '弹幕',
  gift: '礼物',
  enter: '进入',
  follow: '关注',
  fansclub: '粉丝团',
  like: '点赞'
};

/** 同一条通知正文里最多保留的最近消息条数 */
const MAX_ACCUM_ITEMS = 10;
/** 同一条通知正文字符上限 */
const MAX_BODY_CHARS = 800;

/** 自动回复发送器（由 store 注入，避免循环依赖） */
export type AutoReplySender = (content: string) => Promise<boolean>;

class NotificationManager {
  private settings: NotificationSettings = loadNotificationSettings();
  private pending: PendingNotification[] = [];
  /** 各类别滚动累积的最近消息：每次 flush 用整段文本覆盖同一条通知 */
  private accum = new Map<NotifyCategory, PendingNotification[]>();
  /** 各类别最近一次刷新时间（用于按保留时长清掉累积文本） */
  private accumAt = new Map<NotifyCategory, number>();
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
  /** 冷却 Map 容量上限，防止长直播期间无界增长 */
  private static readonly AUTO_REPLY_COOLDOWN_LIMIT = 2000;
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
    if (
      partial.autoClearSeconds !== undefined ||
      partial.timeCleanupEnabled !== undefined ||
      partial.countCleanupEnabled !== undefined ||
      partial.maxNotificationCount !== undefined
    ) {
      this.startAutoClear();
    }
    this.syncKeepAlive();
    // v1.3.0：镜像到原生侧，后台时 Rust notify_backend 按此判定发通知
    this.syncNative();
    return this.settings;
  }

  /**
   * 消息按时间自动删除：每 10 秒扫描一次，只删除存在时间超过 settings.autoClearSeconds 的通知
   * （设置项语义为"消息保留时长"）。0 = 不删除。
   * 相比过去"每隔 N 秒整体清空一次"，这样刚弹出来的新消息不会被立刻清掉。
   */
  private startAutoClear() {
    if (this.autoClearTimer) {
      clearInterval(this.autoClearTimer);
      this.autoClearTimer = null;
    }
    const seconds = this.settings.timeCleanupEnabled ? Number(this.settings.autoClearSeconds) || 0 : 0;
    if (seconds <= 0) return;
    this.autoClearTimer = setInterval(() => {
      clearExpiredNotifications(seconds).then(ok => {
        if (!ok) console.warn('[NotificationManager] 清理超时通知失败');
      });
      // 同步丢弃前端侧的累积文本，避免通知已删除后又被旧内容"复活"
      const now = Date.now();
      for (const [category, at] of [...this.accumAt]) {
        if (now - at >= seconds * 1000) {
          this.accum.delete(category);
          this.accumAt.delete(category);
        }
      }
    }, 10 * 1000);
  }

  /**
   * 直播间连接成功时调用（store 的 cast.on('open')）：
   * 按"后台保活"开关拉起前台服务。服务契约：只在连接直播间期间存活，
   * 未进直播间/离开房间时由 startup()/stopKeepAlive() 停止。
   */
  async init() {
    if (this.settings.keepAlive) {
      await startForegroundService();
    } else {
      await stopForegroundService();
    }
    // v1.3.0：镜像设置到原生侧（后台时 Rust 独立判定）
    this.syncNative();
    this.maybePromptBatteryOptimization();
  }

  /**
   * App 启动（尚未连接任何直播间）时调用：
   * 停掉上次进程可能遗留的保活服务与常驻通知 —— 用户停在首页/登录页时
   * 通知栏不应出现"正在后台运行"。服务会在连接成功（init）时按开关重新拉起。
   */
  async startup() {
    await stopForegroundService();
    this.syncNative();
    this.maybePromptBatteryOptimization();
  }

  /** 离开直播间/断开连接时调用：立即停止保活服务（不清"后台保活"开关，下次连接自动恢复）。 */
  async stopKeepAlive() {
    await stopForegroundService();
    // 服务启停是异步的，延迟刷新状态徽标避免读到旧值
    setTimeout(() => this.onStatusChange?.(), 1200);
  }

  async syncKeepAlive() {
    // 服务契约：只在连接直播间期间存活。开关只记录用户偏好：
    // 开 = 连接期间拉起；关 = 连接期间也不拉起；未在房间时一律保持停止。
    if (this.settings.keepAlive && this.currentRoom) {
      await startForegroundService();
    } else {
      await stopForegroundService();
    }
    // 服务启停是异步的，延迟刷新状态徽标避免读到旧值
    setTimeout(() => this.onStatusChange?.(), 1200);
  }

  /**
   * 把通知设置镜像到原生侧（fire-and-forget）。
   * 后台时 Rust notify_backend 按这份镜像独立判定是否发通知。
   */
  private syncNative() {
    // 后台通知镜像依赖这份设置：失败会使 Rust notify_backend 用过期/空的镜像，
    // 表现为后台该通知时不通知。重试 2 次（间隔递增），仍失败才记录。
    const attempt = (tryCount: number) => {
      syncNativeSettings(this.settings)
        .catch((e: unknown) => {
          if (tryCount < 3) {
            setTimeout(() => attempt(tryCount + 1), 300 * tryCount);
          } else {
            console.warn('[NotificationManager] 同步原生通知设置失败', e);
          }
        });
    };
    attempt(1);
  }

  /** 退出登录时调用：无论保活开关状态，立即停止前台服务并关闭保活开关。 */
  async stopOnLogout() {
    this.settings.keepAlive = false;
    saveNotificationSettings(this.settings);
    await stopForegroundService();
    setTimeout(() => this.onStatusChange?.(), 1200);
  }

  /**
   * 直播结束时调用：停止本次后台保活前台服务（不登出、不清空会话）。
   *
   * 注意：**不再把 keepAlive 落盘为 false**。
   * 下播只代表"这一场直播结束了"，不代表用户想关掉保活。旧实现顺手把开关写死成 false，
   * 于是用户下次连接直播间时 init() 会直接走 stopForegroundService()，
   * 表现为"后台服务再也不起来"——这是系统后台统计里只能存活几秒的直接原因之一。
   * 现在只停本次服务、保留开关，下次连接（cast.on('open') → init()）会自动重新拉起。
   */
  async stopOnLiveEnd() {
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
      // 自动回复独立于通知展示开关：必须放在所有通知类 early-return 之前。
      // 此前排在 foregroundEnabled（默认 false）之后，前台直接 return，
      // 导致"配好了规则却从不回复"；通知总开关关闭时同样会被误杀。
      if (this.settings.autoReplyEnabled && this.settings.autoReplyRules.length) {
        this.tryAutoReply(msgs);
      }

      if (!this.settings.enabled) return;

      const foreground = await this.resolveForeground();
      // v1.3.0：后台通知已整体下沉到 Rust 原生侧（notify_backend 在代理层旁路解析，
      // 直接调系统通知），前端绝不在后台重复调用 post_notification —— 两路互斥，天然去重。
      if (!foreground) return;
      if (!this.settings.foregroundEnabled) return;

      for (const msg of msgs) {
        const pending = this.toPending(msg);
        if (!pending) continue;
        if (!this.settings.categories[pending.category]) continue;
        this.pending.push(pending);
      }

      if (this.settings.mergeSeconds <= 0) {
        this.flush();
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

      // 容量保护：冷却 Map 会随活跃用户数持续增长（长时间直播内存无界增长）。
      // 写入前先清掉已过冷却期的旧条目；若仍超上限（应不会，因为 15s 冷却自然淘汰），
      // 删除时间最早的条目，保证 Map 有界。
      if (this.autoReplyCooldown.size >= NotificationManager.AUTO_REPLY_COOLDOWN_LIMIT) {
        for (const [k, v] of this.autoReplyCooldown) {
          if (now - v >= NotificationManager.AUTO_REPLY_COOLDOWN_MS) {
            this.autoReplyCooldown.delete(k);
          }
        }
      }
      if (this.autoReplyCooldown.size >= NotificationManager.AUTO_REPLY_COOLDOWN_LIMIT) {
        let oldestKey: string | null = null;
        let oldestVal = Infinity;
        for (const [k, v] of this.autoReplyCooldown) {
          if (v < oldestVal) {
            oldestVal = v;
            oldestKey = k;
          }
        }
        if (oldestKey) this.autoReplyCooldown.delete(oldestKey);
      }
      this.autoReplyCooldown.set(userId, now);
      // 直接发送预设内容（@ 相关功能已整体移除：不做 {user} 占位符替换、不自动 @）
      const finalReply = (rule.reply || '').trim();
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
        const giftName = msg.gift?.name || '礼物';
        return {
          category: 'gift',
          title: `${user}`,
          body: `送出了 ${giftName} ×${msg.gift?.count || 1}`,
          timestamp: Date.now(),
          // 同一用户同一礼物合并成一条通知：actionKey 带上礼物名
          actionKey: `${user}|${giftName}`,
          actionText: `送出了 ${giftName}`,
          count: Number(msg.gift?.count) || 1
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
        // 单次点赞携带的数量，形如"为主播点赞了(5)"，解析失败按 1 计
        const likeCount = (msg.content?.match(/\((\d+)\)/) || [])[1];
        return {
          category: 'like',
          title: `${user}`,
          body: msg.content || '点赞了直播间',
          timestamp: Date.now(),
          // 同一用户点赞合并成一条通知：actionKey 只按用户区分
          actionKey: `${user}`,
          actionText: '点赞了直播间',
          count: likeCount ? parseInt(likeCount, 10) || 1 : 1
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

  /**
   * 把待发消息按类别归并后，按**每类展示方式**分发：
   * - independent：每条消息单独发一条独立通知（原生侧分配唯一 id）
   * - perUser：同一用户同一操作合并成一条，交原生侧累计 xN
   * - merge：固定 id 覆盖刷新同一条通知（滚动累积最近若干条）
   * 所有通知统一带上该类 importance 与全局锁屏可见性。
   */
  private flush() {
    if (this.pending.length === 0) return;

    // 按类别归并本批消息
    const groups = new Map<NotifyCategory, PendingNotification[]>();
    for (const item of this.pending) {
      const list = groups.get(item.category) || [];
      list.push(item);
      groups.set(item.category, list);
    }
    this.pending = [];

    const now = Date.now();
    const visibility = this.settings.lockVisibility;
    for (const [category, batch] of groups) {
      const importance = this.settings.categoryImportance[category];
      const mode = this.settings.categoryModes[category] || 'merge';

      // 每条独立：本批每条消息各发一条独立通知，可被单独清理
      if (mode === 'independent') {
        for (const item of batch) {
          postNotification({
            category,
            title: item.title,
            body: item.body,
            group: category,
            independent: true,
            importance,
            visibility
          });
        }
        continue;
      }

      // 按用户合并：同一用户同一操作合并成一条，交原生侧累计 xN
      if (mode === 'perUser') {
        const byKey = new Map<string, PendingNotification[]>();
        for (const item of batch) {
          const k = item.actionKey || item.title;
          const list = byKey.get(k) || [];
          list.push(item);
          byKey.set(k, list);
        }
        for (const items of byKey.values()) {
          const sample = items[0];
          postNotification({
            category,
            title: sample.title,
            body: sample.body,
            group: category,
            // 由原生侧按 actionKey 派生固定 id 并累计次数
            actionKey: sample.actionKey || sample.title,
            actionText: sample.actionText,
            // 本批该 (用户,操作) 的数量合计，交原生侧叠加到历史计数
            count: items.reduce((s, it) => s + (it.count || 1), 0),
            importance,
            visibility
          });
        }
        continue;
      }

      // 合并刷新：追加到该类别的滚动累积（只保留最近 MAX_ACCUM_ITEMS 条）
      const history = this.accum.get(category) || [];
      history.push(...batch);
      if (history.length > MAX_ACCUM_ITEMS) {
        history.splice(0, history.length - MAX_ACCUM_ITEMS);
      }
      this.accum.set(category, history);
      this.accumAt.set(category, now);

      let body = history.map(it => `${it.title}: ${it.body}`).join('\n');
      if (body.length > MAX_BODY_CHARS) {
        body = body.slice(-MAX_BODY_CHARS);
      }

      postNotification({
        category,
        title: `${CATEGORY_NAME[category]} (${history.length})`,
        body,
        group: category,
        // 固定 id：系统覆盖同一条通知，实现"实时刷新"而不是越堆越多
        id: CATEGORY_NOTIFY_ID[category],
        // 本批实际条数，供分组汇总计数
        count: batch.length,
        importance,
        visibility
      });
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
