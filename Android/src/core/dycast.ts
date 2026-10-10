import { CLog } from '@/utils/logUtil';
import { Emitter, type EventMap } from './emitter';
import pako from 'pako';
import {
  decodeChatMessage,
  decodeControlMessage,
  decodeEmojiChatMessage,
  decodeGiftMessage,
  decodeLikeMessage,
  decodeMemberMessage,
  decodePushFrame,
  decodeResponse,
  decodeRoomRankMessage,
  decodeRoomStatsMessage,
  decodeRoomUserSeqMessage,
  decodeSocialMessage,
  encodePushFrame
} from './model';
import type {
  GiftStruct,
  Message,
  RoomRankMessage_RoomRank,
  RoomUserSeqMessage_Contributor,
  Text,
  User
} from './model';
import type { RoomInfo, RoomStats, UserRankItem } from './domain';
import { fetchUser, getImInfo, getLiveInfo } from './request';
import { getSignature } from './signature';
import { getProxyPort } from '@/utils/tauriBridge';
// import { logUserCast } from '@/utils/debugUtil';

/**
 * 连接状态
 *  - 0 - 未连接
 *  - 1 - 连接中(连接完成)
 *  - 2 - 连接失败
 *  - 3 - 已断开
 */
export type ConnectStatus = 0 | 1 | 2 | 3;

/** 直播间动态统计（统一领域模型 RoomStats；旧名兼容层，字段一致） */
export type LiveRoom = RoomStats;

/** 直播间信息-连接信息（统一领域模型 RoomInfo；旧名兼容层，字段一致） */
export type DyLiveInfo = RoomInfo;
/** 直播间信息-初次连接信息 */
export interface DyImInfo {
  cursor?: string;
  fetchInterval?: string;
  now?: string;
  internalExt?: string;
  fetchType?: number;
  pushServer?: string;
  liveCursor?: string;
}

/**
 * 用户榜条目（统一领域模型 UserRankItem；旧名兼容层，字段一致）
 */
export type LiveRankItem = UserRankItem;

export interface CastUser {
  // user.sec_uid | user.id_str
  id?: string;
  // user.nickname
  name?: string;
  // user.avatar_thumb.url_list.0
  avatar?: string;
  // 性别 0 | 1 | 2 => 未知 | 男 | 女
  gender?: number;
}

export interface CastGift {
  id?: string;
  name?: string;
  // 抖音币 diamond_count
  price?: number;
  type?: number;
  // 描述
  desc?: string;
  // 图片
  icon?: string;
  // 数量 repeat_count | combo_count
  count?: number | string;
  // 礼物消息可能重复发送，0 表示第一次，未重复
  repeatEnd?: number;
}

/**
 * 富文本类型
 *  1 - 普通文本
 *  2 - 合并表情
 */
export enum CastRtfContentType {
  TEXT = 1,
  EMOJI = 2,
  USER = 3
}

/**
 * 社交消息动作（WebcastSocialMessage.action）
 */
export enum SocialAction {
  /** 关注了主播 */
  FOLLOW = 1,
  /** 取消关注主播 */
  UNFOLLOW = 2,
  /** 分享本次直播 */
  SHARE = 3
}

/**
 * 直播间控制动作（WebcastControlMessage.action）
 *  - 3 / 4 / 6 均表示直播结束
 */
export enum ControlAction {
  /** 直播暂停 */
  PAUSE = 1,
  /** 直播恢复 */
  RESUME = 2,
  /** 主播下播 */
  FINISH = 3,
  /** 管理员关闭直播间 */
  FINISH_BY_ADMIN = 4,
  CHANGE_NODE = 5,
  /** 切换节点导致直播结束 */
  ROOM_FINISH_BY_SWITCH = 6,
  PING_TIMEOUT = 7
}

/** 社交消息附加信息 */
export interface CastSocial {
  action?: number;
  /** 关注时为主播 id；分享时为分享形式 */
  target?: string;
  type?: string;
}

// 富文本
export interface CastRtfContent {
  type?: CastRtfContentType;
  text?: string;
  url?: string;
  user?: CastUser;
}

export interface DyMessage {
  id?: string;
  method?: CastMethod;
  user?: CastUser;
  toUser?: CastUser;
  gift?: CastGift;
  content?: string;
  rtfContent?: CastRtfContent[];
  room?: LiveRoom;
  rank?: LiveRankItem[];
  /** 社交消息附加信息（关注 / 取消关注 / 分享） */
  social?: CastSocial;
}

export enum CastMethod {
  CHAT = 'WebcastChatMessage',
  GIFT = 'WebcastGiftMessage',
  LIKE = 'WebcastLikeMessage',
  MEMBER = 'WebcastMemberMessage',
  SOCIAL = 'WebcastSocialMessage',
  ROOM_USER_SEQ = 'WebcastRoomUserSeqMessage',
  CONTROL = 'WebcastControlMessage',
  ROOM_RANK = 'WebcastRoomRankMessage',
  ROOM_STATS = 'WebcastRoomStatsMessage',
  EMOJI_CHAT = 'WebcastEmojiChatMessage',
  FANSCLUB = 'WebcastFansclubMessage',
  ROOM_DATA_SYNC = 'WebcastRoomDataSyncMessage',
  /** 自定义消息 */
  CUSTOM = 'CustomMessage'
}

/**
 * 直播间直播状态
 */
export enum RoomStatus {
  PREPARE = 1,
  LIVING = 2,
  PAUSE = 3,
  END = 4
}
/** 客户端状态 */
enum WSRoomStatus {
  /** 未连接 */
  UNCONNECTED = 1,
  /** 正在连接 */
  CONNECTING = 2,
  /** 连接中|已连接 */
  CONNECTED = 3,
  /** 重连中 */
  RECONNECTING = 4,
  /** 已关闭 */
  CLOSED = 5
}

/**
 * DyCast Event
 */
interface DyCastEvent extends EventMap {
  /**
   * 监听ws打开
   * @param ev
   * @returns
   */
  open: (ev?: Event, info?: DyLiveInfo) => void;
  /**
   * 监听关闭
   * @param code
   * @param reason
   * @returns
   */
  close: (code: number, reason: string) => void;
  /**
   * 监听错误
   * @param e
   * @returns
   */
  error: (e: Error) => void;
  /**
   * 监听弹幕
   * @param messages
   * @returns
   */
  message: (messages: DyMessage[]) => void;
  /** 重连中 */
  reconnecting: (count?: number, code?: DyCastCloseCode, reason?: string) => void;
  /** 重连完成 */
  reconnect: (ev?: Event) => void;
}

/**
 * 自定义关闭码
 */
export enum DyCastCloseCode {
  /** 正常关闭 */
  NORMAL = 1000,
  /** 终端离开，可能因为服务端错误，也可能因为浏览器正从打开连接的页面跳转离开 */
  GOING_AWAY = 1001,
  /** 由于协议错误而中断连接 */
  PROTOCOL_ERROR = 1002,
  /** 接收到不允许的数据类型而断开连接 */
  UNSUPPORTED = 1003,
  /** 没有收到预期的状态码 */
  NO_STATUS = 1005,
  /** 没有处理关闭帧 */
  ABNORMAL = 1006,
  /** 应用自定义状态码 */
  /** 主播未开播 */
  LIVE_END = 4001,
  /** 连接过程错误 */
  CONNECTING_ERROR = 4002,
  /** 无法正常接收信息 */
  CANNOT_RECEIVE = 4003,
  /** 因重连关闭 */
  RECONNECTING = 4004
}

// 配置
interface DyCastOptions {
  aid?: string;
  app_name?: string;
  browser_language?: string;
  browser_name?: string;
  browser_online?: boolean;
  browser_platform?: string;
  browser_version?: string;
  compress?: string;
  cookie_enabled?: boolean;
  cursor: string;
  device_platform?: string;
  did_rule?: number;
  endpoint?: string;
  heartbeatDuration?: string;
  host?: string;
  identity?: string;
  im_path?: string;
  insert_task_id?: string;
  internal_ext: string;
  live_id?: number;
  live_reason?: string;
  need_persist_msg_count?: string;
  room_id: string;
  screen_height?: number;
  screen_width?: number;
  signature: string;
  support_wrds?: number;
  tz_name?: string;
  update_version_code?: string;
  user_unique_id: string;
  version_code?: string;
  webcast_sdk_version?: string;
}

interface DyCastCursor {
  cursor?: string;
  firstCursor?: string;
  internalExt?: string;
}

/**
 * dycast 自定义关闭信息
 */
interface DyCastCloseEvent {
  code: number;
  msg: string;
}

// 消息体类型
enum PayloadType {
  Ack = 'ack',
  Close = 'close',
  Hb = 'hb',
  Msg = 'msg'
}

/** API */
// wss://webcast5-ws-web-lf.douyin.com/webcast/im/push/v2/  => version: 1.0.14-beta.0
// wss://webcast100-ws-web-lq.douyin.com/webcast/im/push/v2/  => version: 1.0.15
// Local proxy socket path. In Tauri, the runtime prepends ws://127.0.0.1:<port>;
// in a browser, the vite proxy serves it on the same origin.
const BASE_URL_PATH = `/socket/webcast/im/push/v2/`;

/**
 * Resolve the BASE_URL using the runtime proxy origin.
 *  - Browser: ws://<location.host>/socket/webcast/im/push/v2/  (vite proxy)
 *  - Tauri:   ws://127.0.0.1:<port>/socket/webcast/im/push/v2/ (rust proxy)
 */
async function resolveBaseUrl(): Promise<string> {
  const port = await getProxyPort();
  if (port) return `ws://127.0.0.1:${port}${BASE_URL_PATH}`;
  // browser fallback: derive ws(s)://<origin>
  const origin = (typeof location !== 'undefined' ? location.origin : '').replace(/^http/, 'ws');
  return `${origin}${BASE_URL_PATH}`;
}

/** SDK 版本 */
export const VERSION = '1.0.15';

/**
 * 默认配置
 */
const defaultOpts: Partial<DyCastOptions> = {
  aid: '6383',
  app_name: 'douyin_web',
  browser_language: 'zh-CN',
  browser_name: 'Mozilla',
  browser_online: true,
  browser_platform: 'Win32',
  browser_version:
    '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0',
  compress: 'gzip',
  cookie_enabled: true,
  device_platform: 'web',
  did_rule: 3,
  endpoint: 'live_pc',
  heartbeatDuration: '0',
  host: 'https://live.douyin.com',
  identity: 'audience',
  im_path: '/webcast/im/fetch/',
  insert_task_id: '',
  live_id: 1,
  live_reason: '',
  need_persist_msg_count: '15',
  screen_height: 1080,
  screen_width: 1920,
  support_wrds: 1,
  tz_name: 'Asia/Shanghai',
  update_version_code: VERSION,
  version_code: '180800',
  webcast_sdk_version: VERSION
};

export class DyCast {
  /** 房间号 */
  private roomNum: string;

  /** 房间信息 */
  private info: DyLiveInfo;

  // 初次连接信息
  private imInfo: DyImInfo;

  /** WS客户端 */
  private ws: WebSocket | undefined;

  /** 连接 url */
  private url: string | undefined;

  // 连接状态
  private state: boolean;

  /** 客户端状态 */
  private wsRoomStatus: WSRoomStatus;

  /** 直播间直播状态 */
  private status: RoomStatus;

  /** 连接配置 */
  private options: DyCastOptions | undefined;

  // 心跳
  // 主要用于检查消息接收是否正常
  private heartbeatDuration: number = 10000;
  // 心跳次数
  private pingCount: number = 0;
  // 心跳阈值
  // 如果 heartbeatDuration ms 内心跳次数大于等于该值，证明消息接收出错
  // 即 如果 10000 ms 内都没接收到新消息，证明消息接收出错
  private downgradePingCount: number = 2;

  private pingTimer: ReturnType<typeof setTimeout> | undefined = void 0;

  // 直播间状态轮询（用于检测主播下播）
  private statusPollTimer: ReturnType<typeof setTimeout> | undefined = void 0;
  // 连续读到"已结束"的次数
  private statusPollEndCount: number = 0;
  // 状态轮询间隔
  private readonly statusPollInterval: number = 30000;
  // 连续读到"已结束"达到该次数才判定下播（避免解析瞬断误判）
  private readonly statusPollEndThreshold: number = 2;

  // 上次接收时间
  private lastReceiveTime: number;

  private cursor: DyCastCursor;

  /**
   * 自定义实现的 错误信息提示
   *  - 由于 dycast 的服务端并不会正确处理关闭帧
   *  - 调用 websocket close 后，关闭监听返回 1006
   */
  private closeEvent: DyCastCloseEvent;

  /** 当前重连次数 */
  private reconnectCount: number;
  /** 最大重连尝试次数 */
  private maxReconnectCount: number;
  // 是否需要重连
  private shouldReconnect: boolean;
  // 正在重连中
  private isReconnecting: boolean;
  /**
   * 连接代次：每建立一条新连接递增。
   * 用于识别"已被新连接取代"的旧 socket 事件，避免旧连接的 close 事件
   * 清空 this.ws 并触发二次重连（重复连接的根因）。
   */
  private connSeq: number;
  /**
   * 主动关闭标记：由 close() 置位（用户断开 / 切换房间 / 下播 / 重连换连接），
   * 新建连接时复位。置位期间的关闭不会被判定为"需要自动重连"。
   */
  private manualClosed: boolean;
  /** 是否有重连正在排队/进行中（防止并发重连建立多条连接） */
  private reconnectPending: boolean;

  // 订阅者
  private emitter: Emitter<DyCastEvent>;

  constructor(roomNum: string) {
    // 初始化
    this.roomNum = roomNum;
    this.state = !1;
    // 10秒心跳
    this.heartbeatDuration = 10000;
    this.pingCount = 0;
    this.downgradePingCount = 2;
    this.cursor = {
      cursor: '',
      firstCursor: '',
      internalExt: ''
    };
    // 当前重连次数
    this.reconnectCount = 0;
    // 最大重连次数：保持极大值，直播间未结束时持续重连
    this.maxReconnectCount = 9999;
    // 上一次接收消息时间
    this.lastReceiveTime = Date.now();
    // 当前客户端状态
    this.wsRoomStatus = WSRoomStatus.UNCONNECTED;
    this.shouldReconnect = !1;
    /**
     * 默认情况
     *  - 即未收到预期的状态码
     */
    this.closeEvent = { code: 1005, msg: '无状态关闭' };
    this.info = {
      roomId: '',
      uniqueId: '',
      avatar: '',
      cover: '',
      nickname: '',
      title: '',
      status: 4
    };
    this.imInfo = {};
    this.status = RoomStatus.END;
    this.emitter = new Emitter<DyCastEvent>();
    this.isReconnecting = false;
    this.connSeq = 0;
    this.manualClosed = false;
    this.reconnectPending = false;
  }

  /**
   * 监听
   * @param event
   * @param listener
   */
  public on<K extends keyof DyCastEvent>(event: K, listener: DyCastEvent[K]) {
    this.emitter.on(event, listener);
  }

  /**
   * 取消监听
   * @param event
   * @param listener
   */
  public off<K extends keyof DyCastEvent>(event: K, listener: DyCastEvent[K]) {
    this.emitter.off(event, listener);
  }

  /**
   * 一次性监听
   *  - 如监听打开关闭
   * @param event
   * @param listener
   */
  public once<K extends keyof DyCastEvent>(event: K, listener: DyCastEvent[K]) {
    this.emitter.once(event, listener);
  }

  /**
   * 连接
   * @returns
   */
  public async connect() {
    try {
      if (this.state) {
        this.emitter.emit('error', Error('已连接，请勿重复连接'));
        return;
      }
      await this.fetchConnectInfo(this.roomNum);
      const params = this.getWssParam();
      console.info('[DyCast] isLiving=' + this.isLiving() + ' status=' + this.status + ' RoomStatus.LIVING=' + RoomStatus.LIVING);
      if (this.isLiving()) {
        // 连接中
        this.wsRoomStatus = WSRoomStatus.CONNECTING;
        this._connect(params);
      } else {
        // 主播未开播
        const liveStatus = this.getLiveStatus();
        console.warn('[DyCast] room not living, close with LIVE_END => ' + liveStatus.msg);
        this.wsRoomStatus = WSRoomStatus.CLOSED;
        this.emitter.emit('close', DyCastCloseCode.LIVE_END, liveStatus.msg);
      }
    } catch (err) {
      // 过程错误
      CLog.error('房间连接前错误 =>', err);
      // 关闭：把真实原因带给上层（此前固定文案会吞掉"响应为空/风控/网络"等根因）
      const errMsg = err instanceof Error && err.message ? err.message : '房间连接前出错';
      this.emitter.emit('close', DyCastCloseCode.CONNECTING_ERROR, errMsg);
      this._afterClose();
      // 报错
      this.emitter.emit('error', err as Error);
    }
  }

  /**
   * 获取当前连接状态
   */
  public getRoomStatus() {
    return this.wsRoomStatus;
  }

  /**
   * 实际连接逻辑
   * @param opts
   */
  private async _connect(opts: DyCastOptions) {
    // 连接前的初始化
    this.options = opts;
    this.url = await this._getSocketUrl(opts);
    console.info('[DyCast] connecting to', this.url);
    this.cursor = {
      cursor: '',
      firstCursor: opts.cursor,
      internalExt: opts.internal_ext
    };
    this.lastReceiveTime = Date.now();
    this.pingCount = 0;
    try {
      // 连接代次 +1：本连接之后产生的旧连接事件一律忽略
      const seq = ++this.connSeq;
      const isStale = () => seq !== this.connSeq;
      const socket = new WebSocket(this.url);
      // 新连接建立：清除"主动关闭"标记，恢复正常的重连判定
      this.manualClosed = false;
      this.ws = socket;
      socket.binaryType = 'arraybuffer';
      socket.addEventListener('open', (ev: Event) => {
        if (isStale()) return;
        console.info('[DyCast] ws open');
        // 可能初次打开，也可能是重连打开
        if (this.reconnectCount > 0) {
          // 重连成功
          this.reconnectCount = 0;
          this.emitter.emit('reconnect', ev);
        } else {
          // 初次连接
          this.emitter.emit('open', ev, this.info);
        }
        this.ping();
        this._afterOpen();
      });
      socket.addEventListener('close', (ev: CloseEvent) => {
        // 过期连接（已被更新的连接取代）的关闭事件必须忽略：
        // 否则会把新连接的 this.ws 清空，并再次触发重连造成重复连接
        if (isStale()) {
          CLog.info('忽略过期连接的关闭事件');
          return;
        }
        console.warn('[DyCast] ws close raw =>', ev.code, ev.reason);
        this.handleClose(ev);
      });
      socket.addEventListener('error', (ev: Event) => {
        if (isStale()) return;
        console.error('[DyCast] ws error =>', ev);
        this.emitter.emit('error', Error(ev.type || '未知错误'));
      });
      socket.addEventListener('message', (ev: MessageEvent) => {
        // 过期连接的消息同样丢弃，避免旧连接的缓存帧被新连接 ACK
        if (isStale()) return;
        console.info('[DyCast] ws message received, size=', ev.data?.byteLength || 0);
        this.handleMessage(ev.data);
      });
    } catch (err) {
      CLog.error('房间连接过程错误 =>', err);
      // 可能原因为 WebSocket 不可用
      // 关闭
      this.emitter.emit('close', DyCastCloseCode.CONNECTING_ERROR, '房间连接过程出错');
      this._afterClose();
      // 报错
      this.emitter.emit('error', err as Error);
    }
  }

  /** 处理关闭 */
  private handleClose(ev: CloseEvent) {
    let { code, reason } = ev;
    console.warn('[DyCast] handleClose =>', code, reason);
    let msg: string = reason.toString();
    switch (code) {
      case DyCastCloseCode.NO_STATUS:
      case DyCastCloseCode.ABNORMAL:
        // 抖音服务端不处理关闭帧：即便是主动 close 也会以 1006 回调，
        // 因此用 closeEvent 中记录的真实意图覆盖原始关闭码
        code = this.closeEvent.code || code;
        msg = this.closeEvent.msg || msg || '已关闭';
        break;
    }

    // 因重连而关闭旧连接：静默收尾。进行中的重连会建立新连接，
    // 这里若抛出 close 会误报"连接已断开"并触发重复重连。
    if (code === DyCastCloseCode.RECONNECTING) {
      this._afterClose();
      return;
    }

    // 是否需要自动重连：
    //  - 已确认下播            → 不重连
    //  - 主动关闭（用户断开 / 切房间 / 下播）→ 不重连
    //  - 正常关闭 / 下播关闭    → 不重连
    //  - 其余异常（无状态关闭、网络闪断、后台冻结、无法接收消息）→ 重连
    const noReconnect =
      this.status === RoomStatus.END ||
      this.manualClosed ||
      code === DyCastCloseCode.NORMAL ||
      code === DyCastCloseCode.LIVE_END;
    this.shouldReconnect = !noReconnect;

    // _afterClose() 会把 cursor 清空；重连前先保留一份，避免以空 cursor 重连、
    // 丢失上次 ack 位置导致重复消费/断点丢弹幕。
    const saved = { cursor: this.cursor.cursor, internalExt: this.cursor.internalExt };
    this._afterClose();
    if (this.shouldReconnect) {
      this.cursor.cursor = saved.cursor;
      this.cursor.internalExt = saved.internalExt;
      this.reconnect();
    } else {
      // 正常关闭：把真实关闭码/原因抛给订阅者
      this.emitter.emit('close', code, msg);
    }
  }

  /**
   * 处理消息
   */
  private async handleMessage(data: ArrayBuffer | string) {
    this.pingCount = 0;
    // Rust proxy now emits one canonical JSON event for decoded webcast messages.
    // Keep the binary path below as a compatibility fallback for older proxy sessions.
    if (typeof data === 'string') {
      try {
        const event = JSON.parse(data);
        if (event?.type === 'dycast' && Array.isArray(event.messages)) {
          this.setCursor(String(event.cursor || ''), String(event.internalExt || ''));
          const messages: DyMessage[] = event.messages
            .map((item: any) => this.fromUnifiedMessage(item))
            .filter((item: DyMessage | null): item is DyMessage => !!item);
          if (messages.length) this.emitter.emit('message', messages);
          // 统一链路的下播即时判定：CONTROL(action=3/4/6) 经 Rust 解码为 room.status=4。
          // 旧二进制路径在 _dealMessage 里处理，统一链路绕过了它 —— 不补上的话，
          // 下播只能靠心跳超时（约 20s）或状态轮询（60~90s）才发现，计时还继续走。
          const endMsg = messages.find(
            m => m.method === CastMethod.CONTROL && m.room?.status === RoomStatus.END
          );
          if (endMsg) this.handleLiveEnd(endMsg.content || '主播已下播');
          return;
        }
      } catch (err) {
        CLog.warn('[DyCast] 统一消息 JSON 解析失败，回落二进制路径', err);
      }
      return;
    }
    this.lastReceiveTime = Date.now();
    let res;
    try {
      res = await this._decodeFrame(new Uint8Array(data));
    } catch (err) {
      console.error('[DyCast] decode frame error =>', err);
      res = null;
    }
    if (!res) return;
    const { response, frame, cursor, needAck, internalExt } = res;
    console.info('[DyCast] decoded frame => payloadType=', frame?.payloadType, 'msgCount=', response?.messages?.length, 'needAck=', needAck);
    if (needAck) {
      this.setCursor(cursor, internalExt);
      // 后台时 JS 与 Rust 原生后端会各自 ack → 双 ack 可能被抖音判异常；
      // 统一由 Rust 在后台回 ack（notify_backend 仅后台返回 ack），前端后台不再回发。
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      if (!hidden) {
        const ack = this._ack(internalExt, frame?.logId);
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(ack);
        } else {
          // ACK 无法发送说明连接已不可用：按异常关闭处理，交由 handleClose 判定是否重连。
          // （原实现只做 _afterClose 且不通知上层，会出现"界面一直显示已连接、却再也不来弹幕"的静默死亡）
          CLog.error(`ACK发送异常 => 直播间[${this.roomNum}]连接不可用`);
          const socket = this.ws;
          if (socket && socket.readyState !== WebSocket.CLOSED) {
            socket.close();
          } else {
            this._afterClose();
            this.emitter.emit('close', DyCastCloseCode.ABNORMAL, '连接已不可用');
          }
        }
      }
    }
    // 处理消息体
    if (frame) {
      // 判断消息体类型
      if (frame.payloadType === PayloadType.Msg) {
        this._dealMessages(response.messages);
      }
      if (frame.payloadType === PayloadType.Close) {
        // 关闭连接
        this.close(DyCastCloseCode.NORMAL, '因消息类型关闭');
      }
    }
  }

  /**
   * 重连
   */
  private async reconnect() {
    // 直播间已结束，停止重连
    if (this.status === RoomStatus.END) {
      CLog.info('直播间已结束，停止重连');
      this.emitter.emit('close', DyCastCloseCode.LIVE_END, '直播已结束');
      return;
    }
    // 已有重连在排队/进行中：忽略重复触发，避免并发建立多条连接
    if (this.reconnectPending) {
      CLog.info('重连已在进行中，忽略重复触发');
      return;
    }
    this.reconnectPending = true;

    // 重连前刷新直播间状态，若期间主播已下播则停止重连，避免无限重连
    try {
      const info = await getLiveInfo(this.roomNum);
      if (info.status === RoomStatus.END) {
        this.status = RoomStatus.END;
        this.stopStatusPoll();
        this.reconnectPending = false;
        CLog.info('直播间已结束，停止重连');
        this._afterClose();
        this.emitter.emit('close', DyCastCloseCode.LIVE_END, '直播已结束');
        return;
      }
      this.status = info.status;
    } catch (err) {
      // 刷新失败沿用旧状态，继续重连
      CLog.warn('重连前刷新直播间状态失败', err);
    }

    // 状态刷新期间用户可能已主动断开
    if (this.manualClosed || this.isLiveEnded()) {
      this.reconnectPending = false;
      return;
    }

    // 修复：重连必须刷新连接信息（cursor/pushServer）。
    // getWssParam 取的是 this.imInfo，而 it 只在首次连接（fetchConnectInfo）拉取过一次；
    // 若某房间推流因游标/节点失效而停滞，重连沿用旧 imInfo 只会一次次连到坏节点、
    // 永远无法自动恢复——而"换直播间正常"正是因为切换时重新拉取了连接信息。
    // 这里让重连也重新拉取一次，使自动恢复与手动切换等效。
    try {
      const info = await (this.info ? Promise.resolve(this.info) : getLiveInfo(this.roomNum));
      const freshIm = await getImInfo(info.roomId, info.uniqueId);
      this.imInfo = freshIm;
      this.cursor.cursor = freshIm.cursor || this.cursor.cursor;
      this.cursor.internalExt = freshIm.internalExt || this.cursor.internalExt;
      CLog.info(
        '[DyCast] 重连已刷新连接信息 => cursor=' + freshIm.cursor + ' pushServer=' + freshIm.pushServer
      );
    } catch (err) {
      CLog.warn('重连刷新连接信息失败，沿用旧连接信息', err);
    }

    const opts: DyCastOptions = Object.assign({}, this.options, {
      cursor: this.cursor.cursor,
      internal_ext: this.cursor.internalExt
    });
    this.shouldReconnect = !1;
    this.reconnectCount++;
    if (this.reconnectCount > this.maxReconnectCount) {
      CLog.error('已超过最大重连次数，请稍后重试');
      this.emitter.emit('error', Error('已超过最大重连次数，请稍后重试'));
      this.reconnectPending = false;
      return;
    }

    this.wsRoomStatus = WSRoomStatus.RECONNECTING;
    this.emitter.emit('reconnecting', this.reconnectCount);
    // 退避重试：网络异常时避免高速空转（1s → 2s → 4s … 最长 30s）
    const delay = Math.min(30000, 1000 * Math.pow(2, Math.min(this.reconnectCount - 1, 5)));
    CLog.info(`将在 ${delay}ms 后发起第 ${this.reconnectCount} 次重连`);
    await new Promise(resolve => setTimeout(resolve, delay));

    // 退避期间可能已被用户关闭 / 已确认下播
    if (this.manualClosed || this.isLiveEnded()) {
      this.reconnectPending = false;
      return;
    }

    // 关闭仍在打开的旧连接（其关闭码为 RECONNECTING，会被静默丢弃，不触发再次重连）
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.close(DyCastCloseCode.RECONNECTING, '因重连而关闭');
    }
    this.isReconnecting = true;
    this._connect(opts);
  }

  /**
   * 停止直播间状态轮询
   */
  private stopStatusPoll() {
    if (this.statusPollTimer) {
      clearTimeout(this.statusPollTimer);
      this.statusPollTimer = void 0;
    }
  }

  /**
   * 启动直播间状态轮询
   *  - 连接保持期间定时刷新直播间状态，检测主播是否下播
   */
  private startStatusPoll() {
    this.stopStatusPoll();
    this.statusPollTimer = setTimeout(async () => {
      this.statusPollTimer = void 0;
      await this.checkLiveStatus();
      // 仅当仍保持连接时继续轮询（下播后会在 handleLiveEnd 停止）
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.startStatusPoll();
    }, this.statusPollInterval);
  }

  /**
   * 定时刷新直播间状态，检测主播是否已下播
   */
  private async checkLiveStatus() {
    try {
      const info = await getLiveInfo(this.roomNum);
      if (info.status === RoomStatus.END) {
        this.statusPollEndCount++;
        if (this.statusPollEndCount >= this.statusPollEndThreshold) {
          this.handleLiveEnd('直播已结束');
        }
      } else {
        this.statusPollEndCount = 0;
        this.status = info.status;
      }
    } catch (err) {
      // 刷新失败不判定下播
      this.statusPollEndCount = 0;
    }
  }

  /**
   * 处理直播结束：置状态并触发关闭
   */
  private handleLiveEnd(reason: string = '主播已下播') {
    if (this.status === RoomStatus.END) return;
    this.status = RoomStatus.END;
    this.stopStatusPoll();
    CLog.info('[DyCast] 直播间已关闭 =>', reason);
    const socket = this.ws;
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      // 走 close => handleClose 转发为 close 事件
      this.close(DyCastCloseCode.LIVE_END, reason);
    } else {
      this._afterClose();
      this.emitter.emit('close', DyCastCloseCode.LIVE_END, reason);
    }
  }

  /**
   * 关闭
   * @param code 关闭码
   * @param reason 关闭原因
   * @param manual 是否为主动关闭（用户断开/切换房间/下播/重连换连接）。
   *               true 时不再触发自动重连；无法接收消息等异常场景传 false 以保留重连能力。
   */
  public close(code: number = 1005, reason: string = '关闭', manual: boolean = true) {
    this.stopStatusPoll();
    // 主动关闭：置位后 handleClose 不再判定需要重连，同时取消排队中的重连
    this.manualClosed = manual;
    this.reconnectPending = false;
    const socket = this.ws;
    if (!socket) {
      this._afterClose();
      return;
    }
    this.state = !1;
    this.closeEvent = { code, msg: reason };
    if (socket.readyState === WebSocket.CLOSED) {
      // socket 已彻底关闭，不会再回调 close 事件，这里直接收尾
      this._afterClose();
      return;
    }
    // 注意：不在此处清空 this.ws——close 事件回来时还需用它判断是否为当前连接
    // （connSeq 判定），否则旧连接的事件无法被识别与忽略。
    const rs = socket.readyState;
    if (rs === WebSocket.CONNECTING) {
      // CONNECTING 状态同样要真正关闭：按 WHATWG 规范 close() 在 CONNECTING 下
      // 会"fail the WebSocket connection"（不抛错），旧实现只提升代次不关闭，
      // 被抛弃的握手最终会连上并保持打开 —— 代理仍为它向上游回 ack 维持活跃，
      // 后台通知链路也继续收到旧房间的消息（切房间后仍收到旧房间通知的根源）。
      this.connSeq++;
      try {
        socket.close();
      } catch {
        // 个别实现可能抛错：代次已提升，后续 open/close 事件都会被当作过期忽略
      }
      this._afterClose();
      return;
    }
    try {
      socket.close();
    } catch (e) {
      // 兜底：close() 抛错不会有 close 事件回来，需自行收尾并通知订阅者
      this._afterClose();
      this.emitter.emit('close', code, reason);
    }
  }

  /**
   * 发送心跳帧
   */
  private ping() {
    try {
      let dur = Math.max(10000, Number(this.heartbeatDuration));
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // 连接正常
        // 发送心跳 => hb
        this.ws.send(this._ping());
        this.pingCount++;
        if (this.pingCount >= this.downgradePingCount) {
          return this.cannotReceiveMessage();
        }
      }
      // 心跳：大概每 10 秒发送一次
      this.pingTimer = setTimeout(() => {
        this.state && this.ping();
      }, dur);
    } catch (err) {
      // 发送过程出错
      CLog.error('DyCast Ping Error =>', err);
    }
  }

  /**
   * 无法正常接收消息
   *  - 长时间未接收到消息
   */
  private cannotReceiveMessage() {
    // 先关闭（manual=false：属异常场景，close 后仍需自动重连）
    this.close(DyCastCloseCode.CANNOT_RECEIVE, '客户端无法正常接收信息', false);
    let tmp = Date.now() - this.lastReceiveTime;
    CLog.error(`DyCast Cannot Receive Message => after ${tmp} ms`);
    // 直播间未结束时持续重连（真正是否重连由 handleClose 统一判定）
    if (this.status !== RoomStatus.END) {
      this.emitter.emit(
        'reconnecting',
        this.reconnectCount,
        DyCastCloseCode.CANNOT_RECEIVE,
        '客户端无法正常接收信息'
      );
    }
  }

  /**
   * 设置 cursor
   * @param cur
   * @param ext
   */
  private setCursor(cur: string, ext: string) {
    this.cursor.cursor = cur;
    this.cursor.internalExt = ext;
    if (!this.cursor.firstCursor) {
      this.cursor.firstCursor = cur;
    }
  }

  private fromUnifiedMessage(item: any): DyMessage | null {
    if (!item || typeof item.method !== 'string') return null;
    const user = item.user
      ? {
          id: item.user.id,
          name: item.user.name,
          gender: item.user.gender,
          avatar: item.user.avatar
        }
      : undefined;
    const toUser = item.toUser
      ? {
          id: item.toUser.id,
          name: item.toUser.name,
          gender: item.toUser.gender,
          avatar: item.toUser.avatar
        }
      : undefined;
    const gift = item.gift
      ? {
          id: item.gift.id,
          name: item.gift.name,
          price: item.gift.price,
          type: item.gift.type,
          desc: item.gift.desc,
          icon: item.gift.icon,
          count: item.gift.count == null ? undefined : String(item.gift.count),
          repeatEnd: item.gift.repeatEnd
        }
      : undefined;
    const room = item.room
      ? {
          audienceCount: item.room.audienceCount,
          likeCount: item.room.likeCount,
          followCount: item.room.followCount,
          totalUserCount: item.room.totalUserCount,
          status: item.room.status
        }
      : undefined;
    const social = item.social
      ? { action: Number(item.social.action), target: item.social.target, type: item.social.type }
      : undefined;
    return {
      id: item.id ? String(item.id) : undefined,
      method: item.method as CastMethod,
      user,
      toUser,
      // EMOJI_CHAT：content 优先取 Rust 解析出的表情图片 URL（UI 用 <img src>），
      // 取不到再回退文本（defaultContent），保证表情消息可正常显示。
      content: item.method === CastMethod.EMOJI_CHAT ? item.emojiIcon || item.content || undefined : item.content,
      gift,
      room,
      rank: Array.isArray(item.rank) ? item.rank : undefined,
      social
    };
  }

  /**
   * 处理统一 Rust 事件之外的旧二进制消息集。
   */
  private async _dealMessages(msgs?: Message[]) {
    if (!msgs || msgs.length < 1) return;
    const messages: DyMessage[] = [];
    try {
      for (const msg of msgs) {
        const message = await this._dealMessage(msg);
        if (message) messages.push(message);
      }
    } catch (err) {}
    if (!messages.length) return;
    this.emitter.emit('message', messages);
  }

  /**
   * 处理一条消息
   * @param msg
   */
  private async _dealMessage(msg: Message) {
    const method = msg.method;
    const data: DyMessage | null = {};
    data.id = msg.msgId;
    let message = null;
    let payload = msg.payload;
    if (!payload) return null;
    try {
      // 处理消息
      switch (method) {
        case CastMethod.CHAT:
          message = decodeChatMessage(payload);
          data.method = CastMethod.CHAT;
          data.user = this._getCastUser(message.user);
          data.content = message.content;
          // 获取富文本：包含合并表情
          data.rtfContent = this._getCastRtfContent(message.rtfContentV2);
          break;
        case CastMethod.GIFT:
          message = decodeGiftMessage(payload);
          data.method = CastMethod.GIFT;
          data.user = this._getCastUser(message.user);
          data.toUser = this._getCastUser(message.toUser);
          data.gift = this._getCastGift(message.gift, message.repeatCount || message.comboCount, message.repeatEnd);
          break;
        case CastMethod.LIKE:
          message = decodeLikeMessage(payload);
          data.method = CastMethod.LIKE;
          data.user = this._getCastUser(message.user);
          data.content = `为主播点赞了(${message.count})`;
          data.room = { likeCount: message.total };
          break;
        case CastMethod.MEMBER:
          message = decodeMemberMessage(payload);
          data.method = CastMethod.MEMBER;
          data.user = this._getCastUser(message.user);
          data.content = '进入直播间';
          data.room = { audienceCount: message.memberCount };
          break;
        case CastMethod.SOCIAL: {
          message = decodeSocialMessage(payload);
          data.method = CastMethod.SOCIAL;
          data.user = this._getCastUser(message.user);
          // SocialMessage 可能是"关注 / 取消关注 / 分享直播"，按 action 区分文案
          const socialAction = Number(message.action);
          data.content =
            socialAction === SocialAction.UNFOLLOW
              ? '取消了关注'
              : socialAction === SocialAction.SHARE
                ? '分享了直播间'
                : '关注了主播';
          data.social = {
            action: socialAction,
            target: message.shareTarget,
            type: message.shareType
          };
          data.room = { followCount: message.followCount };
          break;
        }
        case CastMethod.EMOJI_CHAT:
          message = decodeEmojiChatMessage(payload);
          data.method = CastMethod.EMOJI_CHAT;
          data.user = this._getCastUser(message.user);
          data.content = this._getCastEmoji(message.emojiContent);
          break;
        case CastMethod.ROOM_USER_SEQ:
          message = decodeRoomUserSeqMessage(payload);
          data.method = CastMethod.ROOM_USER_SEQ;
          data.rank = this._getCastRanksA(message.ranks);
          data.room = { audienceCount: message.total, totalUserCount: message.totalUser };
          break;
        case CastMethod.CONTROL:
          message = decodeControlMessage(payload);
          data.method = CastMethod.CONTROL;
          data.content = message.common?.describe;
          if (this.isControlLiveEnd(message.action, message.common?.describe)) {
            // 主播下播
            data.room = { status: RoomStatus.END };
            this.handleLiveEnd(message.common?.describe || '主播已下播');
          }
          break;
        case CastMethod.ROOM_RANK:
          message = decodeRoomRankMessage(payload);
          data.method = CastMethod.ROOM_RANK;
          data.rank = this._getCastRanksB(message.ranks);
          break;
        case CastMethod.ROOM_STATS:
          message = decodeRoomStatsMessage(payload);
          data.method = CastMethod.ROOM_STATS;
          data.room = { audienceCount: message.displayMiddle };
          break;
      }
      if (!data.method) return null;
    } catch (err) {
      // MLog.error('DyCast Message Decode Error =>', method);
      return null;
    }
    return data;
  }

  /**
   * 获取当前的送礼榜单
   * @param data
   */
  private _getCastRanksA(data?: RoomUserSeqMessage_Contributor[]): LiveRankItem[] | undefined {
    if (!data || !data.length) return void 0;
    const list: LiveRankItem[] = [];
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      list.push({
        avatar: item.user?.avatarThumb?.urlList?.[0] || '',
        nickname: item.user?.nickname || '',
        rank: item.rank || i + 1
      });
    }
    return list;
  }

  /**
   * 获取当前的送礼榜单
   * @param data
   */
  private _getCastRanksB(data?: RoomRankMessage_RoomRank[]): LiveRankItem[] | undefined {
    if (!data || !data.length) return void 0;
    const list: LiveRankItem[] = [];
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      list.push({
        avatar: item.user?.avatarThumb?.urlList?.[0] || '',
        nickname: item.user?.nickname || '',
        // scoreStr 是贡献值，不是名次。名次由前端按榜单顺序显示。
        rank: i + 1
      });
    }
    return list;
  }

  /**
   * 获取弹幕用户
   * @param data
   * @returns
   */
  private _getCastUser(data?: User): CastUser | undefined {
    if (!data) return void 0;
    return {
      id: data.secUid,
      name: data.nickname,
      gender: data.gender,
      avatar: data.avatarThumb?.urlList?.[0]
    };
  }

  /**
   * 获取弹幕礼物
   * @param data
   * @returns
   */
  private _getCastGift(data?: GiftStruct, count?: string, end?: number): CastGift | undefined {
    if (!data) return void 0;
    return {
      id: data.id,
      name: data.name,
      price: data.diamondCount,
      type: data.type,
      desc: data.describe,
      icon: data.image?.urlList?.[0],
      count: count,
      repeatEnd: end
    };
  }

  /**
   * 获取会员表情
   * @param data
   * @returns
   */
  private _getCastEmoji(data?: Text): string | undefined {
    if (!data) return void 0;
    return data.pieces?.[0]?.imageValue?.image?.urlList?.[0];
  }

  /**
   * 获取弹幕富文本内容
   * @param data
   * @returns
   */
  private _getCastRtfContent(data?: Text): CastRtfContent[] | undefined {
    if (!data) return void 0;
    if (!data.pieces) return void 0;
    const pieces = data.pieces;
    const list: CastRtfContent[] = [];
    /**
     * pieces 类型
     *  - type = 1  : 普通的聊天文本 : 关键字段(stringValue)
     *  - type = 11 : @ 用户 : 关键字段(userValue.user)
     *  - type = 15 : 合成表情 : 关键字段(imageValue)
     */
    for (let i = 0; i < pieces.length; i++) {
      if (pieces[i].imageValue) {
        // 合成表情
        let url = pieces[i].imageValue?.image?.urlList?.[0];
        let name = pieces[i].imageValue?.image?.content?.name;
        list.push({
          type: CastRtfContentType.EMOJI,
          text: name,
          url
        });
      } else if (pieces[i].userValue) {
        // 艾特用户
        let atUser = pieces[i].userValue?.user;
        list.push({
          type: CastRtfContentType.USER,
          text: `@${atUser?.nickname}`,
          user: this._getCastUser(atUser)
        });
      } else {
        // 假定为普通文本类型
        // 实际还可能是 giftValue 之类的
        list.push({
          type: CastRtfContentType.TEXT,
          text: pieces[i].stringValue || ''
        });
      }
    }
    return list;
  }

  /**
   * 处理接收的二进制消息
   * @param data
   */
  private async _decodeFrame(data: Uint8Array) {
    const frame = decodePushFrame(data);
    let payload = frame.payload;
    const headers = frame.headersList;
    let cursor = '';
    let internalExt = '';
    let needAck = !1;
    if (!payload) return null;
    if (headers) {
      if (headers['compress_type'] && headers['compress_type'] === 'gzip') {
        payload = pako.ungzip(payload);
      }
      if (headers['im-cursor']) {
        cursor = headers['im-cursor'];
      }
      if (headers['im-internal_ext']) {
        internalExt = headers['im-internal_ext'];
      }
    }
    const res = decodeResponse(payload);
    if (!cursor && res.cursor) cursor = res.cursor;
    if (!internalExt && res.internalExt) internalExt = res.internalExt;
    if (res.needAck) needAck = res.needAck;
    return {
      response: res,
      frame,
      cursor,
      needAck,
      internalExt
    };
  }

  /** 心跳数据 */
  private _ping() {
    return encodePushFrame({
      payloadType: PayloadType.Hb
    }) as Uint8Array<ArrayBuffer>;
  }

  /**
   * Ack 数据
   * @param ext Frame im-internal_ext | Response internalExt
   * @param logId
   */
  private _ack(ext: string = '', logId?: string) {
    const getPayload = function (_ext: string) {
      let arr = [];
      for (let s of _ext) {
        let index = s.charCodeAt(0);
        index < 128
          ? arr.push(index)
          : index < 2048
            ? (arr.push(192 + (index >> 6)), arr.push(128 + (63 & index)))
            : index < 65536 &&
              (arr.push(224 + (index >> 12)), arr.push(128 + ((index >> 6) & 63)), arr.push(128 + (63 & index)));
      }
      return new Uint8Array(arr);
    };
    return encodePushFrame({
      payloadType: PayloadType.Ack,
      payload: getPayload(ext),
      logId
    }) as Uint8Array<ArrayBuffer>;
  }

  /** 关闭后 */
  private _afterClose() {
    this.state = !1;
    this.stopStatusPoll();
    this.statusPollEndCount = 0;
    if (this.pingTimer) {
      clearTimeout(this.pingTimer);
      this.pingTimer = void 0;
    }
    this.cursor = {
      cursor: '',
      firstCursor: '',
      internalExt: ''
    };
    this.wsRoomStatus = WSRoomStatus.CLOSED;
    this.closeEvent = { code: DyCastCloseCode.NO_STATUS, msg: '无状态关闭' };
    this.ws = void 0;
    this.isReconnecting = false;
    // 必须复位重连排队标记：重连建立的新连接若在握手阶段就失败（open 前收到 close），
    // handleClose 会再次进入 reconnect()，此时 reconnectPending 仍是 true 会被静默拦截，
    // 且该路径不再 emit close —— 此后永久停止重连、界面还停留在"已连接"（假死）。
    // 复位后 handleClose → reconnect() 正常重新置位，重连循环得以继续。
    this.reconnectPending = false;
  }

  /** 打开后 */
  private _afterOpen() {
    this.state = !0;
    this.wsRoomStatus = WSRoomStatus.CONNECTED;
    this.isReconnecting = false;
    // 连接已恢复：清除重连排队标记与计数
    this.reconnectPending = false;
    this.reconnectCount = 0;
    this.startStatusPoll();
  }

  /**
   * 获取完整的 wss 地址
   * @param opts
   * @returns
   */
  private async _getSocketUrl(opts: DyCastOptions) {
    const fullOpt = Object.assign({}, defaultOpts, opts);
    const base = await resolveBaseUrl();
    const url = `${base}?${this._mergeOptions(fullOpt)}`;
    console.info('[DyCast] socket url =>', url);
    return url;
  }

  /**
   * 将配置转换为 url 参数字符串
   *  - 如：item1=value1&item2=value2&...
   * @param opts
   * @returns
   */
  private _mergeOptions(opts: any): string {
    return Object.keys(opts).reduce((t, n) => {
      let r;
      return `${t}${t ? '&' : ''}${n}=${null != (r = opts[n]) ? r : ''}`;
    }, '');
  }

  /**
   * 获取连接信息
   * @param roomNum
   * @returns
   */
  private async fetchConnectInfo(roomNum: string) {
    try {
      console.info('[DyCast] fetchConnectInfo start for', roomNum);
      const info = await getLiveInfo(roomNum);
      this.info = info;
      this.status = info.status;
      console.info('[DyCast] live info => roomId=' + info.roomId + ' uniqueId=' + info.uniqueId + ' status=' + info.status + ' nickname=' + info.nickname);
      await fetchUser();
      console.info('[DyCast] fetchUser done');
      const res = await getImInfo(info.roomId, info.uniqueId);
      this.imInfo = res;
      console.info('[DyCast] im info => cursor=' + res.cursor + ' pushServer=' + res.pushServer + ' fetchType=' + res.fetchType);
    } catch (err) {
      console.error('[DyCast] fetchConnectInfo error =>', err);
      return Promise.reject(err);
    }
  }

  /**
   * 整理连接参数对象
   */
  private getWssParam(): DyCastOptions {
    const { roomId, uniqueId } = this.info;
    const sign = getSignature(roomId, uniqueId);
    console.info('[DyCast] signature =>', sign);
    return {
      room_id: roomId,
      user_unique_id: uniqueId,
      cursor: this.imInfo.cursor || '',
      internal_ext: this.imInfo.internalExt || '',
      signature: sign
    };
  }

  /**
   * 是否已经直播
   */
  private isLiving() {
    return this.status === RoomStatus.LIVING;
  }

  /**
   * 是否已确认下播
   *  - 方法形式：避免 TS 对 this.status 做过度类型收窄导致比较报错
   */
  private isLiveEnded(): boolean {
    return this.status === RoomStatus.END;
  }

  /**
   * 判断 CONTROL 消息是否表示下播
   *  - action 3/4/6 均为直播结束（主播下播 / 管理员关闭 / 切换节点结束）
   *  - 兜底：describe 文本包含"下播/结束"
   */
  private isControlLiveEnd(action?: number | string | bigint, describe?: string): boolean {
    const act = Number(action);
    if (
      act === ControlAction.FINISH ||
      act === ControlAction.FINISH_BY_ADMIN ||
      act === ControlAction.ROOM_FINISH_BY_SWITCH
    ) {
      return true;
    }
    return /下播|结束/.test(describe || '');
  }

  /** 获取直播状态 */
  private getLiveStatus() {
    let type = '未知';
    let code = 0;
    let msg = '未知状态';
    switch (this.status) {
      case RoomStatus.PREPARE:
        type = '准备中';
        code = RoomStatus.PREPARE;
        msg = '主播正在准备中';
        break;
      case RoomStatus.LIVING:
        type = '直播中';
        code = RoomStatus.LIVING;
        msg = '主播正在直播中';
        break;
      case RoomStatus.PAUSE:
        type = '暂停';
        code = RoomStatus.PAUSE;
        msg = '主播暂时离开了';
        break;
      case RoomStatus.END:
        type = '已结束';
        code = RoomStatus.END;
        msg = '主播已下播';
        break;
    }
    return {
      type,
      code,
      msg
    };
  }

  /**
   * 获取直播间信息
   */
  public getLiveInfo(): DyLiveInfo {
    return {
      ...this.info,
      roomNum: this.roomNum
    };
  }
}
