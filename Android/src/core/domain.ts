/**
 * 统一数据领域模型（架构重构 v1.4.0）
 *
 * 全软件所有数据源（WS 流式 / HTML 快照 / HTTP 轮询 / 账号信息）统一收口到本模块定义的类型，
 * store 只消费这一份标准模型，不再散落多套结构（此前 HTML 的 DyLiveInfo、榜单的 LiveRankItem、
 * 账号的 DyUser 各自独立，字段互相漂移）。
 *
 * 字段命名对齐既有代码惯例：camelCase、可空字段用可选。
 */

/** 用户榜条目（由 LiveRankItem 更名：语义从"送礼贡献榜"改为"在线用户榜"） */
export interface UserRankItem {
  nickname: string;
  avatar: string;
  /** 名次；'-' 表示数据源未给出名次（由 UI 按数组下标显示） */
  rank: number | string;
  /** 贡献值（ranklist/audience 完整榜返回，普通快照无） */
  score?: number;
}

/** 房间动态统计（WS 实时覆盖；HTML 只提供连接初值） */
export interface RoomStats {
  audienceCount?: number | string;
  likeCount?: number | string;
  followCount?: number | string;
  totalUserCount?: number | string;
  status?: number;
}

/**
 * 房间信息：HTML 静态字段 + WS 动态统计的合并视图。
 * 静态字段（title/nickname/avatar/cover/roomId/uniqueId）仅 HTML 提供，抓取一次；
 * 动态字段（audienceCount/... /status）WS 优先实时覆盖、HTML 只填充初值与兜底。
 */
export interface RoomInfo {
  /** web_rid（输入的房间号形态） */
  roomNum?: string;
  /** 19 位数字 room_id（im/fetch 与发弹幕需要；HTML 解析得到） */
  roomId: string;
  /** user_unique_id（im/fetch 握手参数；HTML 解析得到） */
  uniqueId: string;
  /** 主播昵称 */
  nickname: string;
  /** 主播头像 */
  avatar: string;
  /** 直播间封面 */
  cover: string;
  /** 直播标题 */
  title: string;
  /** 直播状态（1 准备 / 2 直播中 / 3 暂停 / 4 已结束） */
  status: number;
  audienceCount?: number | string;
  likeCount?: number | string;
  followCount?: number | string;
  totalUserCount?: number | string;
}

/** 账号数据：登录会话与用户信息统一保存（与房间数据同处一个 store，不独立） */
export interface UserAccount {
  /** 抖音登录态 sessionid（本地持久化的唯一登录判据） */
  sessionid: string | null;
  /** sec_uid（发弹幕接口必需） */
  secUid?: string;
  /** display_id：抖音号 */
  did?: string;
  /** 昵称 */
  nickname: string;
  /** 头像 */
  avatar: string;
  /** 关注数 */
  following: number;
  /** 粉丝数 */
  follower: number;
  /** 个性签名 */
  sign?: string;
}

/**
 * 统一事件类型：所有数据源进入 store 时都携带 kind，单一入口按 kind 分发。
 * 与 Rust `webcast_message.rs` 的 UnifiedEventKind 一一对应（messages/roomRank/roomUserSeq/roomStats/control），
 * 另加 roomInfo（HTML 快照）、rankFull（用户榜完整轮询）、account（账号信息）三个前端侧事件。
 */
export type DomainEventKind =
  | 'messages'
  | 'roomRank'
  | 'roomUserSeq'
  | 'roomStats'
  | 'control'
  | 'roomInfo'
  | 'rankFull'
  | 'account';

/**
 * 统一领域事件（store 唯一处理入口的入参）。
 * 只携带本事件相关的字段，避免把不同类型数据塞进一个巨型结构。
 */
export interface DomainEvent {
  kind: DomainEventKind;
  /** 消息事件：WS 解码后的标准消息（内容遵循 Rust UnifiedMessage 序列化） */
  messages?: import('./dycast').DyMessage[];
  /** roomInfo / roomStats 事件：房间信息（部分字段，null 不覆盖已存在值） */
  room?: Partial<RoomInfo>;
  /** roomRank / roomUserSeq / rankFull 事件：榜单条目 */
  rank?: UserRankItem[];
  /** account 事件：账号信息 */
  account?: UserAccount;
}