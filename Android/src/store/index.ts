import { reactive, computed, ref } from 'vue';
import {
  CastMethod,
  DyCast,
  DyCastCloseCode,
  SocialAction,
  type ConnectStatus,
  type DyMessage,
  type LiveRoom
} from '@/core/dycast';
import type { DomainEvent, RoomInfo, UserAccount, UserRankItem } from '@/core/domain';
import { configureSender } from '@/core/sender';
import { getLiveInfo, getMeInfo } from '@/core/request';
import { setProxySessionid, preloadDanmakuWebView, backupDouyinCookies, restoreDouyinCookies } from '@/utils/tauriBridge';
import { notificationManager } from '@/utils/notificationManager';
import type { ConsoleLog } from '@/components/ConsolePanel.vue';
import { CLog } from '@/utils/logUtil';

/** 账号数据（统一领域模型：与房间数据一同保存在 store，sessionid 与用户信息不分散） */
export type DyUser = UserAccount;

export interface RecentRoom {
  roomNum: string;
  nickname?: string;
  cover?: string;
}

export type SocialFilter = 'all' | 'enter' | 'follow' | 'fansclub';

interface StoreState {
  roomInput: string;
  roomNum: string;
  /** 房间信息（统一领域模型：HTML 静态 + WS 动态合并） */
  liveInfo: RoomInfo | null;
  status: ConnectStatus;
  startTime: number | null;
  /** 账号数据（含 sessionid + 用户信息，统一保存不独立） */
  user: UserAccount | null;
  allMessages: DyMessage[];
  chatMessages: DyMessage[];
  giftMessages: DyMessage[];
  socialMessages: DyMessage[];
  socialFilter: SocialFilter;
  recentRooms: RecentRoom[];
  /** 常用语（快捷发送短语），用户可主动增删改，localStorage 持久化 */
  quickPhrases: string[];
  consoleLogs: ConsoleLog[];
  statusText: string;
  /** 本场关注数（本次连接累计） */
  sessionFollowCount: number;
  /** 最高在线人数（本次连接峰值） */
  maxAudienceCount: number | null;
  /** 送礼贡献榜（WebcastRoomRankMessage，ROOM_RANK） */
  rankGiftList: UserRankItem[];
  /** 用户榜完整版（webcast/ranklist/audience 接口，最多 200 名，10s 刷新） */
  rankFullList: UserRankItem[];
  /** 在线互动榜（WebcastRoomUserSeqMessage，ROOM_USER_SEQ.ranks） */
  rankOnlineList: UserRankItem[];
  /** 主播 anchor_id（直播间链接解析得到，ranklist/audience 接口参数） */
  anchorId: string;
  /** 弹幕输入草稿：跨竖屏/横屏共享，横竖屏切换时不丢失 */
  chatDraft: string;
}

const RECENT_ROOMS_KEY = 'dycast_recent_rooms';
const MAX_RECENT_ROOMS = 2;
/** 常用语（快捷发送短语）持久化 key */
const QUICK_PHRASES_KEY = 'dycast_quick_phrases';
/** 常用语数量上限：避免面板过长、也避免超长存储 */
const MAX_QUICK_PHRASES = 50;
/** 登录会话持久化 key：避免每次打开都要重新登录 */
const SESSION_KEY = 'dycast_sessionid';
const USER_KEY = 'dycast_user';

function loadRecentRooms(): RecentRoom[] {
  try {
    const raw = localStorage.getItem(RECENT_ROOMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT_ROOMS) : [];
  } catch {
    return [];
  }
}

function saveRecentRooms(rooms: RecentRoom[]) {
  try {
    localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(rooms.slice(0, MAX_RECENT_ROOMS)));
  } catch {
    // ignore storage errors
  }
}

/** 从 localStorage 恢复常用语，非法/超长则清理后返回合法列表 */
function loadQuickPhrases(): string[] {
  try {
    const raw = localStorage.getItem(QUICK_PHRASES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      .map(p => p.trim())
      .slice(0, MAX_QUICK_PHRASES);
  } catch {
    return [];
  }
}

function saveQuickPhrases(list: string[]) {
  try {
    localStorage.setItem(QUICK_PHRASES_KEY, JSON.stringify(list.slice(0, MAX_QUICK_PHRASES)));
  } catch {
    // ignore storage errors
  }
}

/** 从 localStorage 恢复上次的登录会话（账号统一数据），无则返回空 */
function loadStoredSession(): UserAccount | null {
  try {
    const sid = localStorage.getItem(SESSION_KEY);
    if (!sid) return null;
    let user: UserAccount | null = null;
    const rawUser = localStorage.getItem(USER_KEY);
    if (rawUser) {
      try {
        user = JSON.parse(rawUser);
      } catch {
        user = null;
      }
    }
    // 账号数据统一保存：sessionid 与用户信息同处一个对象
    return {
      sessionid: sid,
      nickname: user?.nickname || '',
      avatar: user?.avatar || '',
      following: user?.following || 0,
      follower: user?.follower || 0,
      did: user?.did,
      secUid: user?.secUid,
      sign: user?.sign
    };
  } catch {
    return null;
  }
}

/** 持久化保存登录会话（账号统一数据） */
function saveSession(account: UserAccount | null) {
  try {
    if (account?.sessionid) {
      localStorage.setItem(SESSION_KEY, account.sessionid);
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
    if (account) {
      localStorage.setItem(USER_KEY, JSON.stringify(account));
    } else {
      localStorage.removeItem(USER_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

const storedAccount = loadStoredSession();

const state = reactive<StoreState>({
  roomInput: '',
  roomNum: '',
  liveInfo: null,
  status: 0,
  startTime: null,
  user: storedAccount,
  allMessages: [],
  chatMessages: [],
  giftMessages: [],
  socialMessages: [],
  socialFilter: 'all',
  recentRooms: loadRecentRooms(),
  quickPhrases: loadQuickPhrases(),
  consoleLogs: [],
  statusText: '未连接',
  sessionFollowCount: 0,
  maxAudienceCount: null,
  rankGiftList: [],
  rankFullList: [],
  rankOnlineList: [],
  anchorId: '',
  chatDraft: ''
});

let castWs: DyCast | null = null;
const msgIdSet = new Set<string>();
let durationTimer: number | null = null;

/** 已处理消息 id 上限：超出后按插入顺序淘汰最旧的，避免长时间直播内存持续增长 */
const MAX_DEDUPE_IDS = 5000;
/** 各消息列表保留上限（保留最新） */
const MAX_LIST_ALL = 2000;
const MAX_LIST_CHAT = 1000;
const MAX_LIST_GIFT = 500;
const MAX_LIST_SOCIAL = 500;

/** 记录已处理消息 id（带上限淘汰） */
function rememberMsgId(key: string) {
  msgIdSet.add(key);
  if (msgIdSet.size > MAX_DEDUPE_IDS) {
    const overflow = msgIdSet.size - MAX_DEDUPE_IDS;
    let removed = 0;
    for (const old of msgIdSet) {
      msgIdSet.delete(old);
      if (++removed >= overflow) break;
    }
  }
}

/** 追加消息并裁剪到上限（保留最新），防止长时间直播列表无限增长 */
function pushCapped(target: DyMessage[], items: DyMessage[], cap: number) {
  if (items.length) target.push(...items);
  if (target.length > cap) target.splice(0, target.length - cap);
}

/** 从礼物列表末尾向前查找同 id 的那条（连击更新帧用），找不到返回 -1 */
function findLastGiftIndexById(list: DyMessage[], id?: string): number {
  if (!id) return -1;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.id === id) return i;
  }
  return -1;
}

/**
 * 状态快照类消息：服务端周期性整表重推（内容会变，但 msgId 可能为空或复用）。
 * 这些消息必须"每次都处理"，不能参与 msgId 去重，否则贡献榜 / 在线人数会永久为空或冻结。
 */
function isSnapshotMethod(method?: CastMethod): boolean {
  return (
    method === CastMethod.ROOM_RANK ||
    method === CastMethod.ROOM_USER_SEQ ||
    method === CastMethod.ROOM_STATS
  );
}

/**
 * 断线自动重连（2026-09-15 保活增强）：
 * - manualDisconnect：用户手动断开/切房间时置 true，避免误重连
 * - lastAutoRoom：需要自动恢复的房间号；异常断线时记录，回前台自动重连
 */
let manualDisconnect = false;
let lastAutoRoom = '';
let autoReconnectTimer: ReturnType<typeof setTimeout> | null = null;
/** 避免后台恢复瞬间的重连风暴 */
let lastAutoReconnectAt = 0;
const AUTO_RECONNECT_MIN_GAP = 3000;

/** 尝试自动恢复连接（限频：3 秒内不重复触发） */
function scheduleAutoReconnect(roomNum: string) {
  lastAutoRoom = roomNum;
  if (manualDisconnect) return;
  const now = Date.now();
  if (now - lastAutoReconnectAt < AUTO_RECONNECT_MIN_GAP) return;
  lastAutoReconnectAt = now;
  if (autoReconnectTimer) clearTimeout(autoReconnectTimer);
  autoReconnectTimer = setTimeout(() => {
    if (manualDisconnect || !lastAutoRoom || state.status === 1) return;
    CLog.info(`后台断线自动恢复 => ${lastAutoRoom}`);
    addConsole({ level: 'info', tag: '重连', content: '检测到后台连接中断，正在自动恢复...' });
    connectLive(lastAutoRoom);
  }, 500);
}

/** App 启动时挂载：回前台（visibilitychange visible）时若处于断线状态则自动重连 */
function initAutoReconnect() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (manualDisconnect || !lastAutoRoom) return;
    if (state.status !== 1 && state.roomNum) {
      scheduleAutoReconnect(state.roomNum);
    }
  });
}

/** 用户手动断开时调用（切房间/退出前标记，防止自动重连） */
function markManualDisconnect() {
  manualDisconnect = true;
  lastAutoRoom = '';
}

const durationText = ref('00:00:00');

/** 直播已结束提醒（主播下播时置 true，弹窗提示后由用户关闭） */
const liveEndTipVisible = ref(false);
/** 提醒标题：下播为"直播已关闭"，异常断线为"连接已断开" */
const liveEndTipTitle = ref('直播已关闭');
/** 下播/断线原因文案 */
const liveEndTipText = ref('');

function nowTime() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function pad(n: number) {
  return `${n}`.padStart(2, '0');
}

function addConsole(log: Omit<ConsoleLog, 'time'>) {
  state.consoleLogs.push({ ...log, time: nowTime() });
  if (state.consoleLogs.length > 200) {
    state.consoleLogs = state.consoleLogs.slice(-200);
  }
}

/**
 * 清空本场累积状态。
 * @param keepRank 保留贡献榜（自动重连同一房间时使用）：
 *   服务端不一定会立刻补推榜单快照，清空会让贡献榜长时间显示为空。
 *   同房间重连时也一并保留 liveInfo/anchorId（房间未变，主播信息仍有效）。
 *   真正切换房间时（keepRank=false）除弹幕/礼物/榜单外，
 *   还会清掉 liveInfo / anchorId / startTime，避免旧房间数据残留。
 */
function clearMessages(keepRank = false) {
  msgIdSet.clear();
  state.allMessages = [];
  state.chatMessages = [];
  state.giftMessages = [];
  state.socialMessages = [];
  state.sessionFollowCount = 0;
  state.maxAudienceCount = null;
  if (!keepRank) {
    state.rankGiftList = [];
    state.rankFullList = [];
    state.rankOnlineList = [];
    state.liveInfo = null;
    state.anchorId = '';
    state.startTime = null;
  }
}

/** 观众贡献榜刷新定时器（连接期间每 60s 拉一次） */
let rankFullTimer: ReturnType<typeof setInterval> | null = null;

function stopRankFullTimer() {
  if (rankFullTimer) {
    clearInterval(rankFullTimer);
    rankFullTimer = null;
  }
}

/**
 * 拉取用户榜完整版（webcast/ranklist/audience，最多 200 名）。
 * 接口的 room_id 参数要求 19 位数字 room_id（web_rid 会报参数错误），
 * 页面加载用 web_rid、查询用 liveInfo.roomId。
 * 走 WebView 页面上下文（完整 cookie + 页面 secsdk 自动补 bd-ticket 头，
 * 代理裸 sessionid 会被返回空 body）。失败保留旧榜（榜单为周期性刷新，失败由下次轮询自愈）。
 */
async function fetchRankAudience(webRid: string) {
  const apiRoomId = state.liveInfo?.roomId || webRid;
  const anchorPart = state.anchorId ? `&anchor_id=${encodeURIComponent(state.anchorId)}` : '';
  const apiPath =
    `/webcast/ranklist/audience/?aid=6383&app_name=douyin_web&device_platform=web` +
    `&room_id=${encodeURIComponent(apiRoomId)}&rank_type=30&title_type=1${anchorPart}`;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const started = await invoke<boolean>('page_fetch', {
      roomId: webRid,
      url: `https://live.douyin.com${apiPath}`
    });
    let body: string | null = null;
    if (started) {
      for (let i = 0; i < 40; i++) {
        const result = await invoke<string | null>('take_page_fetch');
        if (result) {
          const parsed = JSON.parse(result);
          if (parsed.status === 200) body = parsed.body;
          break;
        }
        await new Promise(r => setTimeout(r, 250));
      }
    }
    if (!body) {
      CLog.warn('[RankFull] 用户榜页面抓取失败，保留旧榜（下次轮询自动重试）');
      return;
    }
    const data = JSON.parse(body);
    const ranks = data?.data?.ranks;
    if (!Array.isArray(ranks) || !ranks.length) {
      CLog.warn('[RankFull] 空榜单 =>', body.slice(0, 120));
      return;
    }
    // 用户榜上限 200 名：接口可能一次返回不足，按实际返回展示（超出时截断到 200）
    state.rankFullList = ranks
      .slice(0, 200)
      .map((r: any, i: number) => ({
        nickname: r?.user?.nickname || '',
        avatar: r?.user?.avatar_thumb?.url_list?.[0] || '',
        rank: r?.rank || i + 1,
        score: Number(r?.score) || 0
      }));
    CLog.info('[RankFull] 用户榜已更新：', state.rankFullList.length, '人');
  } catch (e) {
    CLog.error('[RankFull] 用户榜抓取失败（保留旧榜，下次轮询自愈） =>', e);
  }
}

function startRankFullPolling(webRid: string) {
  stopRankFullTimer();
  state.rankFullList = [];
  // 立即拉一次，随后 10s 刷新（用户榜更新频率要求）
  fetchRankAudience(webRid);
  rankFullTimer = setInterval(() => fetchRankAudience(webRid), 10_000);
}

function startDurationTimer() {
  stopDurationTimer();
  durationTimer = window.setInterval(() => {
    if (!state.startTime) return;
    const diff = Math.floor((Date.now() - state.startTime) / 1000);
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const s = diff % 60;
    durationText.value = `${pad(h)}:${pad(m)}:${pad(s)}`;
  }, 1000);
}

function stopDurationTimer() {
  if (durationTimer) {
    clearInterval(durationTimer);
    durationTimer = null;
  }
  durationText.value = '00:00:00';
}

function setStatus(status: ConnectStatus, text?: string) {
  state.status = status;
  if (text) state.statusText = text;
  else {
    switch (status) {
      case 0:
        state.statusText = '未连接';
        break;
      case 1:
        state.statusText = '已连接';
        break;
      case 2:
        state.statusText = '连接失败';
        break;
      case 3:
        state.statusText = '已断开';
        break;
    }
  }
}

/** 动态统计字段合并（旧名兼容层：统一委托 applyRoomInfo，避免两套覆盖逻辑漂移） */
function setRoomCounts(room?: LiveRoom) {
  if (!room) return;
  applyRoomInfo(room as Partial<RoomInfo>);
}

function pushRecentRoom(roomNum: string, nickname?: string, cover?: string) {
  const rooms = state.recentRooms.filter(r => r.roomNum !== roomNum);
  rooms.unshift({ roomNum, nickname, cover });
  state.recentRooms = rooms.slice(0, MAX_RECENT_ROOMS);
  saveRecentRooms(state.recentRooms);
}

function setSocialFilter(filter: SocialFilter) {
  state.socialFilter = filter;
}

function setChatDraft(value: string) {
  state.chatDraft = value || '';
}

/**
 * 统一领域事件入口：所有数据源（WS 消息 / HTML 房间快照 / 用户榜轮询 / 账号）都经这里进入 store。
 * store 的消费方（页面渲染 / 通知）只认这一份标准数据，不再各自解析多套结构。
 */
function applyEvent(event: DomainEvent) {
  switch (event.kind) {
    case 'messages':
      if (event.messages?.length) {
        handleMessages(event.messages);
        notificationManager.handleMessages(event.messages);
      }
      break;
    case 'roomInfo':
    case 'roomStats':
      // 房间信息（HTML 静态 + WS 动态合并）：静态字段一次性写入、动态字段实时覆盖
      if (event.room) applyRoomInfo(event.room);
      break;
    case 'roomRank':
      // 送礼贡献榜：快照覆盖
      if (event.rank?.length) state.rankGiftList = event.rank;
      break;
    case 'roomUserSeq':
      // 在线互动榜：快照覆盖 + 在线人数
      if (event.rank?.length) state.rankOnlineList = event.rank;
      if (event.room) applyRoomInfo(event.room);
      break;
    case 'rankFull':
      // 用户榜完整版：10s 轮询结果覆盖
      if (event.rank?.length) state.rankFullList = event.rank;
      break;
    case 'account':
      if (event.account) {
        state.user = event.account;
        saveSession(state.user);
        // 账号更新后同步刷新统一发送层上下文（secUid 可能刚补齐）
        if (state.liveInfo) {
          configureSender({
            roomId: state.liveInfo.roomId,
            webRid: state.roomNum || undefined,
            secUid: state.user?.secUid
          });
        }
      }
      break;
  }
}

/**
 * 合并房间信息字段到 liveInfo：
 * - 静态字段（title/nickname/avatar/cover/roomId/uniqueId）：仅 HTML 事件携带，写一次；
 * - 动态字段（audienceCount/.../status）：WS 实时覆盖，用 != null 判定防止缺失字段打穿已有值。
 */
function applyRoomInfo(partial: Partial<RoomInfo>) {
  if (!state.liveInfo) {
    // 尚无基础信息（未连接或已清空）：先建一个最小房间信息壳，后续字段逐个补
    state.liveInfo = {
      roomId: partial.roomId || '',
      uniqueId: partial.uniqueId || '',
      nickname: partial.nickname || '',
      avatar: partial.avatar || '',
      cover: partial.cover || '',
      title: partial.title || '',
      status: partial.status ?? 4
    };
  }
  const info = state.liveInfo;
  // 静态字段：有值才写（HTML 快照只在连接前抓一次，不覆盖已有静态信息）
  if (partial.roomId) info.roomId = partial.roomId;
  if (partial.uniqueId) info.uniqueId = partial.uniqueId;
  if (partial.nickname) info.nickname = partial.nickname;
  if (partial.avatar) info.avatar = partial.avatar;
  if (partial.cover) info.cover = partial.cover;
  if (partial.title) info.title = partial.title;
  // 动态字段：!= null 判定（排除 undefined 与 JSON null），缺失字段绝不覆盖已有值
  if (partial.status != null) info.status = partial.status;
  if (partial.audienceCount != null) {
    info.audienceCount = `${partial.audienceCount}`;
    const n = Number(partial.audienceCount);
    if (!Number.isNaN(n)) state.maxAudienceCount = Math.max(state.maxAudienceCount ?? 0, n);
  }
  if (partial.followCount != null) info.followCount = `${partial.followCount}`;
  if (partial.likeCount != null) info.likeCount = `${partial.likeCount}`;
  if (partial.totalUserCount != null) info.totalUserCount = `${partial.totalUserCount}`;
}

function handleMessages(msgs: DyMessage[]) {
  const all: DyMessage[] = [];
  const chat: DyMessage[] = [];
  const gifts: DyMessage[] = [];
  const social: DyMessage[] = [];
  for (const msg of msgs) {
    // 状态快照类消息（贡献榜 / 在线人数 / 房间统计）是"周期性整表重推"，
    // 内容在变但 msgId 可能为空或复用 —— 若参与 id 去重会被直接丢弃，
    // 导致贡献榜永久为空或冻结。这类消息都是幂等的整表覆盖赋值，重复处理无副作用。
    const isSnapshotMsg = isSnapshotMethod(msg.method);
    // 礼物连击：同一 msgId 的后续帧不是"新礼物"，而是"连击次数更新"。
    // 若仍走上方 msgId 去重，它们会被直接丢弃，连击总量永远停留在首帧（通常为 1）。
    const isGiftComboUpdate =
      !isSnapshotMsg && msg.method === CastMethod.GIFT && !!msg.id &&
      msgIdSet.has(`${msg.method}-${msg.id}`);
    if (!isSnapshotMsg && !isGiftComboUpdate) {
      if (!msg.id) continue;
      const key = `${msg.method}-${msg.id}`;
      if (msgIdSet.has(key)) continue;
      rememberMsgId(key);
    }
    // 连击更新帧：不新增列表条目，改在已展示的那一条上覆盖最新数据（计数/结束标记），避免重复项
    if (isGiftComboUpdate) {
      const gi = findLastGiftIndexById(state.giftMessages, msg.id);
      if (gi >= 0) state.giftMessages[gi] = msg;
      continue;
    }
    all.push(msg);
    // 仅"关注"计入本场关注数：SocialMessage 还包含取消关注 / 分享直播
    if (
      msg.method === CastMethod.SOCIAL &&
      (msg.social?.action ?? SocialAction.FOLLOW) === SocialAction.FOLLOW
    ) {
      state.sessionFollowCount++;
    }
    switch (msg.method) {
      case CastMethod.CHAT:
      case CastMethod.EMOJI_CHAT:
        chat.push(msg);
        break;
      case CastMethod.GIFT:
        if (!msg.gift?.repeatEnd) gifts.push(msg);
        break;
      case CastMethod.LIKE:
      case CastMethod.MEMBER:
      case CastMethod.SOCIAL:
      case CastMethod.FANSCLUB:
        social.push(msg);
        setRoomCounts(msg.room);
        break;
      case CastMethod.ROOM_USER_SEQ:
      case CastMethod.ROOM_STATS:
        setRoomCounts(msg.room);
        if (msg.method === CastMethod.ROOM_USER_SEQ && msg.rank?.length) {
          state.rankOnlineList = msg.rank;
        }
        break;
      case CastMethod.ROOM_RANK:
        // 用户榜（送礼贡献快照）：实时刷新榜单（快照类，已在上面豁免 id 去重）
        if (msg.rank?.length) {
          state.rankGiftList = msg.rank;
          CLog.info(`[Rank] 用户榜已更新：${msg.rank.length} 人（msgId=${msg.id || '空'}）`);
        } else {
          CLog.info(`[Rank] 收到空用户榜快照，保留原数据（msgId=${msg.id || '空'}）`);
        }
        break;
      case CastMethod.CONTROL:
        // 下播判定与断开统一由核心层处理（CONTROL 会触发 LIVE_END close 事件）。
        // 此处只记录消息，若再调用 disconnectLive() 会以 NORMAL 覆盖 LIVE_END 的关闭意图，
        // 导致"直播已关闭"弹窗丢失、且连接被误判为普通断开。
        social.push(msg);
        break;
    }
  }
  pushCapped(state.allMessages, all, MAX_LIST_ALL);
  pushCapped(state.chatMessages, chat, MAX_LIST_CHAT);
  pushCapped(state.giftMessages, gifts, MAX_LIST_GIFT);
  pushCapped(state.socialMessages, social, MAX_LIST_SOCIAL);
}

async function connectLive(roomNum: string) {
  try {
    // 主动发起连接：彻底清理上一次直播的残留状态（弹窗、断开标记、自动恢复目标），
    // 避免旧直播间结束后遗留的 liveEndTip 弹窗/roomNum 干扰新直播间。
    liveEndTipVisible.value = false;
    liveEndTipTitle.value = '直播已关闭';
    liveEndTipText.value = '';
    manualDisconnect = false;
    lastAutoRoom = roomNum;
    if (castWs) {
      castWs.close(1000, '切换房间');
      castWs = null;
    }
    // 自动重连同一个直播间时保留贡献榜：服务端不一定立刻补推快照，
    // 全清会让榜单长时间空白。切换房间则照常清空。
    const sameRoomReconnect = state.roomNum === roomNum;
    clearMessages(sameRoomReconnect);
    state.roomNum = roomNum;
    setStatus(0, '连接中...');
    addConsole({ level: 'info', tag: '连接', content: `正在连接: ${roomNum}` });
    const cast = new DyCast(roomNum);
    /**
     * 是否为"当前生效"的连接实例。
     * 切换房间/退出时旧实例的关闭事件是异步到达的，若不过滤会把新连接的状态
     * 改成"已断开"、并重置自动重连标记，导致新直播间明明已连上却显示断开。
     */
    const isCurrent = () => castWs === cast;
    cast.on('open', (ev, info) => {
      if (!isCurrent()) return;
      CLog.info('DyCast 房间连接成功');
      if (info) state.liveInfo = info;
      setStatus(1, '已连接');
      state.startTime = Date.now();
      startDurationTimer();
      addConsole({ level: 'success', tag: '连接', content: `房间连接成功: ${roomNum}` });
      notificationManager.init();
      // 自动回复按房间隔离：连接成功时切换到当前房间的配置
      notificationManager.setCurrentRoom(roomNum);
      pushRecentRoom(roomNum, info?.nickname, info?.cover);
      // 注入统一发送层上下文：手动弹幕 / 自动回复 / 后续扩展发送功能共用
      configureSender({
        roomId: info?.roomId || '',
        webRid: roomNum,
        secUid: state.user?.secUid
      });
      // 用户榜完整版：连接成功即拉取并 10s 轮询
      startRankFullPolling(roomNum);
      // 预热弹幕发送 WebView：提前加载当前房间页，发送时省去 10s+ 的页面加载
      preloadDanmakuWebView(roomNum).catch(() => {});
    });
    cast.on('error', err => {
      if (!isCurrent()) return;
      CLog.error('DyCast 连接出错 =>', err);
      setStatus(2, '连接失败');
      addConsole({ level: 'error', tag: '连接', content: `连接出错: ${err.message || err}` });
    });
    cast.on('close', (code, reason) => {
      // 旧实例（已切换房间 / 已退出）的关闭事件直接忽略
      if (!isCurrent()) return;
      stopRankFullTimer();
      setStatus(3);
      stopDurationTimer();
      switch (code) {
        case DyCastCloseCode.NORMAL:
          // 用户主动断开连接，不弹窗打扰
          manualDisconnect = true;
          addConsole({ level: 'info', tag: '连接', content: '断开成功' });
          break;
        case DyCastCloseCode.LIVE_END:
          // 已下播：标记为"不再自动恢复"，避免回前台时自动重连一个已结束的直播间
          markManualDisconnect();
          addConsole({ level: 'warning', tag: '直播间', content: reason || '主播尚未开播或已下播' });
          // 下播即停保活服务（契约：只在连接直播间期间存活），不等用户关闭弹窗
          notificationManager.stopKeepAlive();
          // 主播下播：弹窗提醒（直播已结束，计时已暂停）
          liveEndTipTitle.value = '直播已关闭';
          liveEndTipText.value = reason || '直播已结束';
          liveEndTipVisible.value = true;
          break;
        case DyCastCloseCode.CONNECTING_ERROR:
          // 连接过程出错（含直播间信息解析失败/网络异常）：与"主播已下播"区分开，
          // 不触发自动恢复，避免解析失败被误判成下播且无限重连。
          addConsole({ level: 'warning', tag: '连接', content: `连接失败: ${reason || '获取直播间信息失败'}` });
          // 连接失败 = 未进入直播间，同样停掉可能残留的保活服务（换房间失败的场景）
          notificationManager.stopKeepAlive();
          liveEndTipTitle.value = '连接失败';
          liveEndTipText.value = reason || '无法获取直播间信息，请确认房间号正确后重试';
          liveEndTipVisible.value = true;
          break;
        default:
          addConsole({ level: 'warning', tag: '连接', content: `连接已断开: ${reason || ''}` });
          // 非用户主动断开（网络异常/后台冻结）：推迟弹窗，先尝试自动恢复
          if (castWs && lastAutoRoom) {
            scheduleAutoReconnect(lastAutoRoom);
          }
          liveEndTipTitle.value = '连接已断开';
          liveEndTipText.value = `与直播间的连接中断（${reason || '网络异常'}），正在尝试自动恢复...`;
          liveEndTipVisible.value = true;
      }
    });
    cast.on('message', msgs => {
      if (!isCurrent()) return;
      // 消息统一经 applyEvent 处理（handleMessages 为 messages 事件内部实现）
      applyEvent({ kind: 'messages', messages: msgs });
    });
    cast.on('reconnecting', (count, code, reason) => {
      if (!isCurrent()) return;
      if (code === DyCastCloseCode.CANNOT_RECEIVE) {
        addConsole({ level: 'warning', tag: '重连', content: '无法正常接收弹幕，准备重连中' });
      } else {
        addConsole({ level: 'warning', tag: '重连', content: `正在重连中: ${count}` });
      }
    });
    cast.on('reconnect', () => {
      if (!isCurrent()) return;
      addConsole({ level: 'success', tag: '重连', content: '房间重连完成' });
    });
    // 先登记当前实例再发起连接，确保事件回调里的 isCurrent() 判定可用
    castWs = cast;
    cast.connect();
  } catch (err) {
    CLog.error('房间连接过程出错:', err);
    setStatus(2, '连接失败');
    addConsole({ level: 'error', tag: '连接', content: `房间连接过程出错: ${(err as Error).message || err}` });
  }
}

function disconnectLive() {
  manualDisconnect = true;
  lastAutoRoom = '';
  if (castWs) {
    castWs.close(1000, '断开连接');
    // 置空后旧实例的关闭事件会被 isCurrent() 过滤，因此在这里补记断开日志
    castWs = null;
    addConsole({ level: 'info', tag: '连接', content: '断开成功' });
  }
  // 断开连接：退出自动回复的房间隔离上下文（配置已落盘，下次进入自动恢复）
  notificationManager.clearCurrentRoom();
  // 保活服务契约：只在连接直播间期间存活 —— 断开即停。
  // 退出房间/更换房间/下播确认/手动断开都经过这里；下次连接成功时 init() 按开关重新拉起。
  notificationManager.stopKeepAlive();
  // 关键：断开后状态必须显式回到"未连接"。
  // castWs 已同步置空，旧实例的 close 事件会被 isCurrent() 过滤、不会回调 setStatus，
  // 若在此不重置，status 会一直停在"已连接"，导致下次进新房间时 LivePage 误判已连接
  // 而跳过 connectLive —— 旧房间数据残留且新房间不建立连接。
  setStatus(0);
}

/**
 * 退出房间（需求⑨）：断开连接 + 清空房间号/直播间信息 + 保留登录态 + 回首页。
 * 与"退出登录"不同：不清理 sessionid/用户信息；"最近进入"记录保留，方便下次快速再进。
 */
function exitRoom() {
  disconnectLive();
  stopDurationTimer();
  // 退出房间即视为切换房间的前置动作：一次性清空本场所有累积数据
  // （弹幕/礼物/榜单/直播信息/贡献榜），避免再次进入其他房间时旧数据残留。
  clearMessages(false);
  state.roomNum = '';
  state.roomInput = '';
  state.liveInfo = null;
  state.startTime = null;
  liveEndTipVisible.value = false;
  liveEndTipTitle.value = '直播已关闭';
  liveEndTipText.value = '';
}

async function fetchRoomInfo(roomNum: string) {
  const info = await getLiveInfo(roomNum);
  // HTML 房间快照统一经 applyEvent 进入 store（静态字段写入，供确认页/连接页展示）
  applyEvent({ kind: 'roomInfo', room: info });
  return info;
}

/** 把 getMeInfo 的返回映射为统一账号对象（含 sessionid，账号数据不独立保存） */
function toDyUser(data: any): UserAccount {
  return {
    sessionid: state.user?.sessionid ?? null,
    nickname: data?.nickname || '已登录',
    avatar: data?.avatar || '',
    following: data?.following || 0,
    follower: data?.follower || 0,
    did: data?.did,
    secUid: data?.uid || undefined,
    sign: data?.sign
  };
}

async function setSessionid(sid: string | null) {
  if (sid) {
    state.user = {
      ...(state.user || {}),
      sessionid: sid,
      nickname: state.user?.nickname || '',
      avatar: state.user?.avatar || '',
      following: state.user?.following || 0,
      follower: state.user?.follower || 0
    } as UserAccount;
  } else {
    state.user = null;
  }
  await setProxySessionid(sid);
  if (sid) {
    CLog.info('[Auth] 已保存登录 cookie，开始拉取用户信息');
    // 备份 WebView CookieManager 全部 cookie：进程被杀时内存 cookie 会丢失，
    // 恢复会话时用 restoreDouyinCookies 写回（否则 WebView 网络请求会掉回未登录态）
    try {
      const backup = await backupDouyinCookies();
      if (backup) {
        localStorage.setItem('dycast_cookie_backup', backup);
        CLog.info(`[Auth] cookie 已备份（${backup.split(';').length} 条）`);
      }
    } catch (e) {
      CLog.warn('[Auth] cookie 备份失败', e);
    }
    try {
      const res = await getMeInfo();
      if (res.data) {
        state.user = { ...state.user, ...toDyUser(res.data), sessionid: sid } as UserAccount;
        CLog.info(
          `[Auth] 用户信息已就绪: nickname=${state.user.nickname} secUid=${state.user.secUid ? '有' : '无'}`
        );
      } else {
        CLog.warn(`[Auth] 用户信息为空(code=${res.code})，登录态仍然有效，稍后可重试`);
      }
    } catch (e) {
      CLog.warn('[Auth] 获取用户信息失败，登录态仍然有效', e);
    }
  } else {
    CLog.info('[Auth] 已清除登录 cookie（退出登录）');
  }
  // 持久化登录会话：重启 App 后自动恢复，避免反复登录（礼物页不再反复提示）
  saveSession(state.user);
}

/**
 * 确保用户信息（尤其是发弹幕必需的 secUid）已就绪，缺失时实时补拉一次。
 * 设计前提：本地有 cookie 就是"已登录"，不能因为 user 尚未拉到而拒绝发送弹幕。
 */
async function ensureUserInfo(): Promise<DyUser | null> {
  if (state.user?.secUid) return state.user;
  if (!state.user?.sessionid) return state.user;
  try {
    const res = await getMeInfo();
    if (res.code === 0 && res.data) {
      state.user = { ...state.user, ...toDyUser(res.data) } as UserAccount;
      saveSession(state.user);
      CLog.info(`[Auth] 补齐用户信息成功 secUid=${state.user.secUid ? '有' : '无'}`);
    } else {
      CLog.warn(`[Auth] 补齐用户信息失败(code=${res.code})`);
    }
  } catch (e) {
    CLog.warn('[Auth] 补齐用户信息异常', e);
  }
  return state.user;
}

/**
 * 应用启动时恢复上次登录的会话。
 * 目的：用户登录过一次后，后续打开 App 不再要求重新登录。
 * 会将 sessionid 重新同步到本地代理（确保弹幕/礼物请求带上 cookie），
 * 并校验用户信息是否仍然有效，失效则自动清除。
 */
async function restoreSession(): Promise<boolean> {
  const sid = state.user?.sessionid;
  if (!sid) {
    CLog.info('[Auth] 本地无登录记录（cookie 为空），按未登录处理');
    return false;
  }
  CLog.info('[Auth] 发现本地登录记录（cookie 非空），正在同步到代理并尝试补齐用户信息');
  try {
    // 恢复 WebView CookieManager：进程被杀会丢内存 cookie（ttwid 等），
    // 不恢复的话 WebView 页面/隐藏发送 WebView 会掉回未登录态
    const backup = localStorage.getItem('dycast_cookie_backup');
    if (backup) {
      const ok = await restoreDouyinCookies(backup);
      CLog.info(`[Auth] WebView cookie 恢复${ok ? '成功' : '失败'}（${backup.split(';').length} 条）`);
    }
    // 同步到代理（前端启动时代理可能刚就绪，需要重新注入 cookie）
    await setProxySessionid(sid);
    // 拉取用户信息：仅用于补齐昵称/头像/secUid，**不作为登录判据**
    const res = await getMeInfo();
    if (res.code === 0 && res.data) {
      state.user = { ...state.user, ...toDyUser(res.data), sessionid: sid } as UserAccount;
      saveSession(state.user);
      CLog.info(
        `[Auth] 用户信息已就绪: nickname=${state.user.nickname} secUid=${state.user.secUid ? '有' : '无'}`
      );
      return true;
    }
    // 用户信息接口没返回有效数据：只告警，**绝不清除登录态**。
    // 抖音 cookie 仍在，用户依然处于已登录状态；一次接口失败（风控/网络）不能让他登出。
    CLog.warn(`[Auth] 用户信息获取失败(code=${res.code})，保留登录态，后续可重试`);
    return true;
  } catch (e) {
    // 网络异常 / 接口抛错：同样保留登录态
    CLog.warn('[Auth] 恢复会话时接口异常（网络或风控），保留登录态', e);
    return true;
  }
}

function logout() {
  setSessionid(null);
  // 退出登录后不再保留通知服务（前台服务与通知一并停止）
  notificationManager.stopOnLogout();
  notificationManager.clearCurrentRoom();
}

/** 关闭"直播已结束"提醒弹窗（用户点击"知道了"后调用） */
function closeLiveEndTip() {
  liveEndTipVisible.value = false;
}

/**
 * 直播结束收尾：下播确认后调用。
 * 关闭提醒弹窗 → 断开连接 → 停止后台保活前台服务（进程不再驻留后台）。
 * 注意：不登出、不清 sessionid，用户仍可重新连接其他直播间。
 */
async function handleLiveEndExit() {
  liveEndTipVisible.value = false;
  liveEndTipTitle.value = '直播已关闭';
  liveEndTipText.value = '';
  disconnectLive();
  try {
    await notificationManager.stopOnLiveEnd();
  } catch (e) {
    CLog.warn('直播结束停止保活服务失败', e);
  }
}

/**
 * 合并多来源榜单（去重、保序、限量）：
 * 在线互动榜（ROOM_USER_SEQ）只推"有互动的观众"，人数随互动波动（有时 3 人、有时 18 人）；
 * 与用户榜完整版（ranklist/audience，10s 刷新）取并集后列表更满、更稳定。
 * 优先级：primary 在前，secondary 中未出现过的追加在后；按昵称去重。
 */
export function mergeRankLists(primary: UserRankItem[], secondary: UserRankItem[], cap = 200): UserRankItem[] {
  const merged: UserRankItem[] = [];
  const seen = new Set<string>();
  for (const item of [...primary, ...secondary]) {
    const name = item?.nickname || '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    merged.push(item);
    if (merged.length >= cap) break;
  }
  return merged;
}

export function useStore() {
  return {
    state,
    durationText: computed(() => durationText.value),
    /**
     * 是否已登录：以本地已保存的 sessionid（抖音 cookie）为唯一判据（统一存于 user.sessionid）。
     * 只要 cookie 还在就视为已登录 —— 不再要求 state.user 同时存在。
     * 原因：用户信息接口失败（网络/风控/字段变更）不代表未登录。
     */
    isLoggedIn: computed(() => !!state.user?.sessionid),
    /**
     * 是否存在登录记录（本地已保存 sessionid）。
     * 与 isLoggedIn 同源，保留给既有调用点（礼物页等不再反复提示登录）。
     */
    hasLoginRecord: computed(() => !!state.user?.sessionid),
    isConnected: computed(() => state.status === 1),
    liveEndTipVisible,
    liveEndTipTitle,
    liveEndTipText,
    closeLiveEndTip,
    handleLiveEndExit,
    addConsole,
    clearMessages,
    initAutoReconnect,
    connectLive,
    disconnectLive,
    exitRoom,
    fetchRoomInfo,
    setSessionid,
    restoreSession,
    ensureUserInfo,
    logout,
    setRoomInput(value: string) {
      state.roomInput = value;
    },
    /** 统一领域事件入口（所有数据源进入 store 的唯一通道） */
    applyEvent,
    setRoomNum(value: string) {
      state.roomNum = value;
    },
    setAnchorId(value: string) {
      state.anchorId = value;
    },
    setSocialFilter,
    setChatDraft,
    pushRecentRoom,
    /** 新增一条常用语（自动去空、去重、限长、持久化） */
    addQuickPhrase(value: string) {
      const v = (value || '').trim();
      if (!v) return;
      const list = state.quickPhrases.filter(p => p !== v);
      list.push(v);
      state.quickPhrases = list.slice(-MAX_QUICK_PHRASES);
      saveQuickPhrases(state.quickPhrases);
    },
    /** 删除指定常用语 */
    removeQuickPhrase(index: number) {
      const list = state.quickPhrases.slice();
      if (index >= 0 && index < list.length) {
        list.splice(index, 1);
        state.quickPhrases = list;
        saveQuickPhrases(state.quickPhrases);
      }
    },
    /** 修改指定常用语（新值为空则删除） */
    updateQuickPhrase(index: number, value: string) {
      const v = (value || '').trim();
      const list = state.quickPhrases.slice();
      if (index < 0 || index >= list.length) return;
      if (!v) {
        list.splice(index, 1);
      } else {
        list[index] = v;
      }
      state.quickPhrases = list;
      saveQuickPhrases(state.quickPhrases);
    }
  };
}

// 注入自动回复发送器：复用统一发送层（@ 相关功能已整体移除，直接发送预设内容）。
// 发送上下文（roomId/secUid）由 configureSender 在连接成功时注入，此处只判断发送就绪。
notificationManager.autoReplySender = async (content: string) => {
  // 必须处于已连接状态（roomId 已注入统一发送层）；条件不满足时直接跳过，
  // 避免把弹幕发到错误的直播间。
  if (state.status !== 1) {
    CLog.warn('自动回复跳过：直播间未连接');
    return false;
  }
  const { sendText } = await import('@/core/sender');
  const res = await sendText(content);
  if (!res.ok) CLog.warn(`自动回复发送失败: ${res.msg}`);
  return res.ok;
};
