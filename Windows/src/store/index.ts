import { reactive, computed, ref } from 'vue';
import {
  CastMethod,
  DyCast,
  DyCastCloseCode,
  SocialAction,
  type ConnectStatus,
  type DyLiveInfo,
  type DyMessage,
  type LiveRankItem,
  type LiveRoom
} from '@/core/dycast';
import { getLiveInfo, getMeInfo } from '@/core/request';
import { extractDouyinSessionid, setProxySessionid } from '@/utils/tauriBridge';
import { notificationManager } from '@/utils/notificationManager';
import { sendChatMessage } from '@/core/sendMessage';
import { formatDate } from '@/utils/commonUtil';
import type { ConsoleLog } from '@/components/ConsolePanel.vue';
import { CLog } from '@/utils/logUtil';

export interface DyUser {
  nickname: string;
  avatar: string;
  following: number;
  follower: number;
  did?: string;
  /** sec_uid：发弹幕接口需要 */
  secUid?: string;
}

export interface RecentRoom {
  roomNum: string;
  nickname?: string;
  cover?: string;
}

export type SocialFilter = 'all' | 'enter' | 'follow' | 'fansclub';

interface StoreState {
  roomInput: string;
  roomNum: string;
  liveInfo: DyLiveInfo | null;
  status: ConnectStatus;
  startTime: number | null;
  sessionid: string | null;
  user: DyUser | null;
  allMessages: DyMessage[];
  chatMessages: DyMessage[];
  giftMessages: DyMessage[];
  socialMessages: DyMessage[];
  socialFilter: SocialFilter;
  recentRooms: RecentRoom[];
  consoleLogs: ConsoleLog[];
  statusText: string;
  /** 本场关注数（本次连接累计） */
  sessionFollowCount: number;
  /** 最高在线人数（本次连接峰值） */
  maxAudienceCount: number | null;
  /** 送礼贡献榜（WebcastRoomRankMessage，ROOM_RANK） */
  rankGiftList: LiveRankItem[];
  /** 在线互动榜（WebcastRoomUserSeqMessage，ROOM_USER_SEQ.ranks） */
  rankOnlineList: LiveRankItem[];
}

const RECENT_ROOMS_KEY = 'dycast_recent_rooms';
const MAX_RECENT_ROOMS = 2;
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

/** 从 localStorage 恢复上次的登录会话（sessionid + 用户信息），无则返回空 */
function loadStoredSession(): { sessionid: string | null; user: DyUser | null } {
  try {
    const sid = localStorage.getItem(SESSION_KEY);
    if (!sid) return { sessionid: null, user: null };
    let user: DyUser | null = null;
    const rawUser = localStorage.getItem(USER_KEY);
    if (rawUser) {
      try {
        user = JSON.parse(rawUser);
      } catch {
        user = null;
      }
    }
    return { sessionid: sid, user };
  } catch {
    return { sessionid: null, user: null };
  }
}

/** 持久化保存登录会话 */
function saveSession(sid: string | null, user: DyUser | null) {
  try {
    if (sid) {
      localStorage.setItem(SESSION_KEY, sid);
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

const storedSession = loadStoredSession();

const state = reactive<StoreState>({
  roomInput: '',
  roomNum: '',
  liveInfo: null,
  status: 0,
  startTime: null,
  sessionid: storedSession.sessionid,
  user: storedSession.user,
  allMessages: [],
  chatMessages: [],
  giftMessages: [],
  socialMessages: [],
  socialFilter: 'all',
  recentRooms: loadRecentRooms(),
  consoleLogs: [],
  statusText: '未连接',
  sessionFollowCount: 0,
  maxAudienceCount: null,
  rankGiftList: [],
  rankOnlineList: []
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

function clearMessages() {
  msgIdSet.clear();
  state.allMessages = [];
  state.chatMessages = [];
  state.giftMessages = [];
  state.socialMessages = [];
  state.sessionFollowCount = 0;
  state.maxAudienceCount = null;
  state.rankGiftList = [];
  state.rankOnlineList = [];
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

function setRoomCounts(room?: LiveRoom) {
  if (!room || !state.liveInfo) return;
  if (room.audienceCount !== undefined) {
    state.liveInfo.audienceCount = `${room.audienceCount}`;
    const n = Number(room.audienceCount);
    if (!Number.isNaN(n)) state.maxAudienceCount = Math.max(state.maxAudienceCount ?? 0, n);
  }
  if (room.followCount !== undefined) state.liveInfo.followCount = `${room.followCount}`;
  if (room.likeCount !== undefined) state.liveInfo.likeCount = `${room.likeCount}`;
  if (room.totalUserCount !== undefined) state.liveInfo.totalUserCount = `${room.totalUserCount}`;
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

function handleMessages(msgs: DyMessage[]) {
  const all: DyMessage[] = [];
  const chat: DyMessage[] = [];
  const gifts: DyMessage[] = [];
  const social: DyMessage[] = [];
  for (const msg of msgs) {
    if (!msg.id) continue;
    const key = `${msg.method}-${msg.id}`;
    if (msgIdSet.has(key)) continue;
    rememberMsgId(key);
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
        // 送礼贡献榜：实时刷新榜单
        if (msg.rank?.length) {
          state.rankGiftList = msg.rank;
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
    clearMessages();
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
          // 主播下播：弹窗提醒（直播已结束，计时已暂停）
          liveEndTipTitle.value = '直播已关闭';
          liveEndTipText.value = reason || '直播已结束';
          liveEndTipVisible.value = true;
          break;
        case DyCastCloseCode.CONNECTING_ERROR:
          // 连接过程出错（含直播间信息解析失败/网络异常）：与"主播已下播"区分开，
          // 不触发自动恢复，避免解析失败被误判成下播且无限重连。
          addConsole({ level: 'warning', tag: '连接', content: `连接失败: ${reason || '获取直播间信息失败'}` });
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
      handleMessages(msgs);
      notificationManager.handleMessages(msgs);
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
}

/**
 * 退出房间（需求⑨）：断开连接 + 清空房间号/直播间信息 + 保留登录态 + 回首页。
 * 与"退出登录"不同：不清理 sessionid/用户信息；"最近进入"记录保留，方便下次快速再进。
 */
function exitRoom() {
  disconnectLive();
  stopDurationTimer();
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
  state.liveInfo = info;
  return info;
}

async function setSessionid(sid: string | null) {
  state.sessionid = sid;
  await setProxySessionid(sid);
  if (sid) {
    try {
      const res = await getMeInfo();
      if (res.data) {
        state.user = {
          nickname: res.data.nickname || '已登录',
          avatar: res.data.avatar || '',
          following: res.data.following || 0,
          follower: res.data.follower || 0,
          did: res.data.did,
          secUid: res.data.uid || undefined
        };
      }
    } catch (e) {
      CLog.warn('获取用户信息失败', e);
    }
  } else {
    state.user = null;
  }
  // 持久化登录会话：重启 App 后自动恢复，避免反复登录（礼物页不再反复提示）
  saveSession(sid, state.user);
}

/**
 * 应用启动时恢复上次登录的会话。
 * 目的：用户登录过一次后，后续打开 App 不再要求重新登录。
 * 会将 sessionid 重新同步到本地代理（确保弹幕/礼物请求带上 cookie），
 * 并校验用户信息是否仍然有效，失效则自动清除。
 */
async function restoreSession(): Promise<boolean> {
  if (!state.sessionid) return false;
  try {
    // 同步到代理（前端启动时代理可能刚就绪，需要重新注入 cookie）
    await setProxySessionid(state.sessionid);
    // 校验 sessionid 是否仍有效（cookie 会过期）
    const res = await getMeInfo();
    if (res.code === 0 && res.data) {
      state.user = {
        nickname: res.data.nickname || '已登录',
        avatar: res.data.avatar || '',
        following: res.data.following || 0,
        follower: res.data.follower || 0,
        did: res.data.did,
        secUid: res.data.uid || undefined
      };
      saveSession(state.sessionid, state.user);
      return true;
    }
    // sessionid 已失效，自动清除登录态
    CLog.warn('登录会话已失效，自动退出登录');
    await setSessionid(null);
    return false;
  } catch (e) {
    CLog.warn('恢复登录会话失败（可能网络暂时不可用），保留原状态', e);
    // 网络错误不强制登出，保留缓存用户信息；下次机会再校验
    return !!state.user;
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

export function useStore() {
  return {
    state,
    durationText: computed(() => durationText.value),
    isLoggedIn: computed(() => !!state.sessionid && !!state.user),
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
    logout,
    setRoomInput(value: string) {
      state.roomInput = value;
    },
    setRoomNum(value: string) {
      state.roomNum = value;
    },
    setSocialFilter,
    pushRecentRoom
  };
}

// 注入自动回复发送器：复用发弹幕能力（含 @ 用户占位符）
notificationManager.autoReplySender = async (content: string) => {
  // 必须使用直播间的 room_id（roomNum 是 web_rid，两者不同），且需处于已连接状态；
  // 条件不满足时直接跳过，避免把弹幕发到错误的直播间。
  const roomId = state.liveInfo?.roomId;
  if (!roomId || state.status !== 1) {
    CLog.warn('自动回复跳过：直播间未连接或信息未就绪');
    return false;
  }
  const res = await sendChatMessage(roomId, content, state.user?.secUid);
  if (!res.ok) CLog.warn(`自动回复发送失败: ${res.msg}`);
  return res.ok;
};
