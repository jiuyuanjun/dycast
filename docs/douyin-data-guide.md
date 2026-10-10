# 抖音直播间数据调取手册

> 适用项目：DyCast（Android / Windows）
> 数据源：① WebSocket 实时弹幕流（webcast/im/push/v2）② 直播间网页 HTML（live.douyin.com/{room_id}）
> 更新：2026-09-15（实测涛涛📷苏州旅拍直播间 room_id=7685693791857838888）

---

## 一、WebSocket 能获取的数据（实时）

### 1.1 连接前：im/fetch 握手信息（`getImInfo` → `DyImInfo`）

| 字段 | 说明 |
|---|---|
| `cursor` | 消息游标，重连时回传 |
| `internalExt` | 内部扩展串，重连时回传 |
| `pushServer` | 推送服务器地址 |
| `fetchInterval` | 拉取间隔 |
| `fetchType` | 拉取方式 |
| `liveCursor` | 直播游标 |
| `now` | 服务端时间 |

### 1.2 实时消息（WS 推送，`DyCast.on('message')` → `DyMessage[]`）

当前项目已解码并整理为统一结构 `DyMessage`：

```ts
interface DyMessage {
  id: string;          // 消息 ID（msgId）
  method: CastMethod;  // 消息类型（见下表）
  user?: CastUser;     // 发送者（id=secUid, name, avatar, gender）
  toUser?: CastUser;   // 接收者（礼物）
  gift?: CastGift;     // 礼物（id, name, price, type, desc, icon, count, repeatEnd）
  content?: string;    // 文本内容
  rtfContent?: CastRtfContent[];  // 富文本（type: TEXT/EMOJI/USER）
  room?: LiveRoom;     // 房间统计（audienceCount/likeCount/followCount/totalUserCount/status）
  rank?: LiveRankItem[];  // 榜单项（nickname, avatar, rank）
}
```

#### 消息类型（CastMethod）与携带数据

| method | 含义 | 关键数据 |
|---|---|---|
| `WebcastChatMessage` | 弹幕 | user、content、rtfContent（@用户/表情图富文本）、eventTime、chatTags |
| `WebcastEmojiChatMessage` | 表情弹幕 | user、emojiId、emojiContent(图片URL) |
| `WebcastGiftMessage` | 礼物 | user、toUser、gift（名称/价格/图标/连击次数）、repeatEnd=0首连 |
| `WebcastLikeMessage` | 点赞 | user、count（本次次数）、total（累计点赞）|
| `WebcastMemberMessage` | 进入直播间 | user、memberCount（当前在线）|
| `WebcastSocialMessage` | 关注 | user、followCount（主播累计粉丝）|
| `WebcastFansclubMessage` | 加入粉丝团 | user、type、content |
| `WebcastRoomUserSeqMessage` | 在线榜/在线漏斗 | total（在线数）、totalUser（累计观看）、ranks[]（榜单：user+rank+score）|
| `WebcastRoomRankMessage` | 送礼榜 | ranks[]（user+scoreStr）|
| `WebcastRoomStatsMessage` | 房间统计 | displayMiddle（在线数）|
| `WebcastControlMessage` | 控制/下播 | action、describe、room.status=END |
| `WebcastRoomDataSyncMessage` | 房间数据同步 | roomID、syncKey、version、payload |
| `CustomMessage` | 自定义消息 | - |

#### 富文本 rtfContent（弹幕里的 @用户 / 表情图）

```ts
interface CastRtfContent {
  type: 1 | 2 | 3;   // TEXT=1 普通文本, EMOJI=2 表情图, USER=3 @用户
  text?: string;      // 文本或 @昵称 或表情名
  url?: string;       // 表情图片 URL
  user?: CastUser;    // 被 @ 的用户
}
```

#### 消息原字段（protobuf 解码后，未映射的原始字段）

`model.ts` 中每个解码器返回完整原始对象，可自行扩展。常用原字段：

**User（baseUser）**
```
id, shortId, nickname, gender(0未知/1男/2女), signature, level,
birthday, avatarThumb/Medium/Large(Image), verified, city,
followInfo(followerCount), payGrade, fansClub(粉丝团级别),
displayId, secUid, userRole, realTimeIcons, badgeImageList...
```

**GiftStruct**
```
id, name, describe, diamondCount(抖音币价格), type, combo,
icon(Image), goldEffect, eventName, bountyIcon...
```

**Common（每条消息的公共头）**
```
msgId, roomId, createTime, describe, displayText, user, foldType,
priorityScore, logId, channelId...
```

**Text（富文本容器）** → `pieces[]`（TextPiece）
```
TextPiece: type=1 文本(stringValue) / type=11 @用户(userValue) / type=15 表情(imageValue)
```

---

## 二、网页能获取的数据（HTML → `parseLiveHtml` → `DyLiveInfo`）

连接前从 `live.douyin.com/{room_id}` 页面 `__pace_f` 内嵌 state 解析。

```ts
interface DyLiveInfo {
  roomId: string;        // 房间 ID
  web_rid?: string;      // 网页房间号（部分页面有）
  uniqueId: string;      // 用户唯一 ID（ws 签名用）
  avatar: string;        // 主播头像
  cover: string;         // 直播间封面
  nickname: string;      // 主播昵称
  title: string;         // 直播间标题
  status: number;        // 1准备 / 2直播中 / 3暂停 / 4已结束
  audienceCount?: string;   // 在线观众数
  totalUserCount?: string;  // 累计观看人数
  likeCount?: string;       // 本场点赞数
  followCount?: string;     // 主播粉丝数
}
```

> 注意：页面里 `roomStore.roomInfo` 还包含更多未解析的原始字段（见下），但**未登录/无 cookie 时页面会被风控降级**（roomInfo 只剩 web_rid+web_stream_url），完整数据需要 sessionid + cookie jar（项目 Rust 代理已处理）。

---

## 三、网页有、WebSocket 没有的数据（重点）

以下数据**只能**从网页/接口拿，WS 推不了：

| 数据 | 来源 | 说明 |
|---|---|---|
| 主播昵称/头像/粉丝数 | 页面 roomStore / data-anchor-info | 连接前即可展示 |
| 直播间标题/封面 | 页面 roomStore | 连接前即可展示 |
| 房间状态 status | 页面 roomStore | 是否开播，未开播直接提示 |
| 房间号 web_rid | 页面 | 展示"房间号" |
| 登录用户信息（昵称/头像/粉丝/关注数） | `/webcast/user/me` 接口（getMeInfo） | 需要 sessionid |

> 补充：`ROOM_USER_SEQ` 消息里的 `total/totalUser` 会实时覆盖网页的 audienceCount/totalUserCount，礼物/点赞/关注数也会随消息实时刷新。

---

## 四、WebSocket 有、网页没有的数据（重点）

| 数据 | 消息 |
|---|---|
| 每条弹幕的用户头像/性别/等级/签名 | ChatMessage.user |
| 礼物明细（名称/单价/连击） | GiftMessage |
| 点赞实时增长 | LikeMessage |
| 进入直播间某人 | MemberMessage |
| 关注主播某人 | SocialMessage |
| 粉丝团加入 | FansclubMessage |
| 在线榜 Top N（可展示"榜一榜二"） | RoomUserSeqMessage.ranks |
| 送礼榜 Top N（可展示"贡献榜"） | RoomRankMessage.ranks |
| 下播/控制事件 | ControlMessage |

---

## 五、调取路径速查（项目代码位置）

| 需求 | 调用 |
|---|---|
| 拿房间信息 | `store.fetchRoomInfo(roomNum)` / `getLiveInfo(roomNum)` |
| 监听实时消息 | `cast.on('message', msgs => ...)`（store 内已分拣 chatMessages/giftMessages/socialMessages）|
| 拿弹幕列表 | `store.state.chatMessages` |
| 拿礼物列表 | `store.state.giftMessages` |
| 拿进入/关注/粉丝团 | `store.state.socialMessages` |
| 拿在线观众/粉丝/点赞 | `store.state.liveInfo.audienceCount/followCount/likeCount` |
| 拿榜单 | 需扩展：`data.rank`（目前 GiftMessage/ROOM_RANK 等可携带）|
| 拿登录用户信息 | `store.state.user`（nickname/avatar/following/follower）|
| 拿直播时长 | `store.durationText.value` |
| 拿最高在线 | `store.state.maxAudienceCount` |
| 拿本场关注数 | `store.state.sessionFollowCount` |