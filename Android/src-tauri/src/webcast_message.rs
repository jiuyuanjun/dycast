//! 统一抖音 webcast 消息解码与标准消息模型（架构重构 v1.3.4）
//!
//! 目标：把「收上游二进制帧 → 标准消息」的下沉成一条 Rust 数据链路，
//! 前台页面（经 proxy 发 JSON）与后台原生通知（notify_backend）消费同一份标准消息，
//! 不再各自解析原始抖音 protobuf（此前两边存在重复字段号、重复 payloadType 判断、
//! 重复 ACK/cursor 处理，已出现过 `msg`/`Msg`、internal_ext 字段误读导致后台消息推不动）。
//!
//! 本模块只依赖标准库 + `flate2`/`serde_json`，不依赖 JNI / Android，可在桌面与 Android
//! 两侧共用。
//!
//! # 协议字段号（与 `Android/src/core/model.ts`（protobuf 生成代码）一一对应）
//!
//! - `PushFrame`：2.logId(varint) / 5.headersList(map) / 7.payloadType(str) / 8.payload(bytes)
//! - `Response`：1.messages[](Message bytes) / 2.cursor(str) / 5.internalExt(str) / 9.needAck(bool)
//! - `Message`：1.method(str) / 2.payload(bytes) / 3.msgId(uint64)
//! - `User`：3.nickname / 4.gender / 9.avatarThumb(Image) / 46.secUid
//! - `Image`：1.urlList[](str)
//!
//! `payloadType` 一律按协议实际小写值处理（`msg` / `hb` / `ack` / `close`），
//! 不再写死大写 `Msg`/`Ack`（大写与上游可用路径不一致）。

use std::io::Read;

use flate2::read::GzDecoder;

// ---------- 协议常量（只保留一份，前台/后台一律引用，禁止重复判断大小写） ----------

pub const PAYLOAD_TYPE_MSG: &str = "msg";
// hb / ack / close 为保留常量（供参考：Rust 只处理 msg 帧；其余由 proxy 透传前端旧逻辑处理）
#[allow(dead_code)]
pub const PAYLOAD_TYPE_HB: &str = "hb";
#[allow(dead_code)]
pub const PAYLOAD_TYPE_ACK: &str = "ack";
#[allow(dead_code)]
pub const PAYLOAD_TYPE_CLOSE: &str = "close";

// method 常量
pub const METHOD_CHAT: &str = "WebcastChatMessage";
pub const METHOD_TEXT: &str = "WebcastTextMessage";
pub const METHOD_EMOJI_CHAT: &str = "WebcastEmojiChatMessage";
pub const METHOD_GIFT: &str = "WebcastGiftMessage";
pub const METHOD_LIKE: &str = "WebcastLikeMessage";
pub const METHOD_MEMBER: &str = "WebcastMemberMessage";
pub const METHOD_SOCIAL: &str = "WebcastSocialMessage";
pub const METHOD_FANSCLUB: &str = "WebcastFansclubMessage";
pub const METHOD_ROOM_USER_SEQ: &str = "WebcastRoomUserSeqMessage";
pub const METHOD_ROOM_RANK: &str = "WebcastRoomRankMessage";
pub const METHOD_ROOM_STATS: &str = "WebcastRoomStatsMessage";
pub const METHOD_CONTROL: &str = "WebcastControlMessage";

// category 常量
pub const CAT_CHAT: &str = "chat";
pub const CAT_GIFT: &str = "gift";
pub const CAT_ENTER: &str = "enter";
pub const CAT_FOLLOW: &str = "follow";
pub const CAT_FANSCLUB: &str = "fansclub";
pub const CAT_LIKE: &str = "like";

pub const CONTROL_ACTION_FINISH: i64 = 3;
pub const CONTROL_ACTION_FINISH_BY_ADMIN: i64 = 4;
pub const CONTROL_ACTION_ROOM_FINISH_BY_SWITCH: i64 = 6;

// ---------- 标准消息模型 ----------

#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedUser {
    pub id: Option<String>,
    pub name: Option<String>,
    pub avatar: Option<String>,
    pub gender: Option<i64>,
}

#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedGift {
    pub id: Option<String>,
    pub name: Option<String>,
    pub price: Option<i64>,
    // 序列化后字段名即 `type`（type 为关键字需加原始标识符/重命名）
    #[serde(rename = "type")]
    pub rtype: Option<i64>,
    pub desc: Option<String>,
    pub icon: Option<String>,
    pub count: Option<i64>,
    pub repeat_end: Option<i64>,
}

#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedRoomStats {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audience_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub like_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub follow_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_user_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<i64>,
}

#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedRankItem {
    pub nickname: String,
    pub avatar: Option<String>,
    pub rank: i64,
    pub score: Option<i64>,
}

#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedSocial {
    pub action: Option<i64>,
    pub target: Option<String>,
    #[serde(rename = "type")]
    pub rtype: Option<i64>,
}

#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedMessage {
    pub id: String,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<UnifiedUser>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_user: Option<UnifiedUser>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gift: Option<UnifiedGift>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub room: Option<UnifiedRoomStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rank: Option<Vec<UnifiedRankItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub social: Option<UnifiedSocial>,
    /// 表情消息（WebcastEmojiChatMessage）的图片 URL。取 `emojiContent`(field 4) 的内层图片
    /// `Text.pieces[0].imageValue.image.urlList[0]`；`content` 字段仍保留 `defaultContent`(field 5) 文本，
    /// 供后台通知体使用。前端 EMOJI_CHAT 渲染用本字段作为 `<img src>`。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub emoji_icon: Option<String>,
    /// 点赞单次次数（单条 Like 事件，非累计）——仅供后台通知体使用，不进入前端 JSON。
    #[serde(skip)]
    pub like_count: i64,
}

/// 一批消息所属的事件类别（前台 store 据此判断"快照覆盖" vs "普通按 id 去重"）。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnifiedEventKind {
    /// 普通弹幕 / 礼物 / 进入 / 关注 / 粉丝团 / 点赞
    Messages,
    /// 贡献榜快照（ROOM_RANK）
    RoomRank,
    /// 在线观众榜快照（ROOM_USER_SEQ）
    RoomUserSeq,
    /// 房间统计快照（ROOM_STATS）
    RoomStats,
    /// 控制/下播（CONTROL）
    Control,
}

impl UnifiedEventKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            UnifiedEventKind::Messages => "messages",
            UnifiedEventKind::RoomRank => "roomRank",
            UnifiedEventKind::RoomUserSeq => "roomUserSeq",
            UnifiedEventKind::RoomStats => "roomStats",
            UnifiedEventKind::Control => "control",
        }
    }
}

/// 一个上游二进制帧解码后的统一标准事件。
#[derive(Clone)]
pub struct UnifiedEvent {
    pub log_id: u64,
    pub cursor: String,
    pub internal_ext: String,
    pub need_ack: bool,
    pub messages: Vec<UnifiedMessage>,
    pub kind: UnifiedEventKind,
}

/// 事件类别（前台 store 供参考；前端不依赖它，仅日志）。
impl UnifiedEvent {
    pub fn kind_str(&self) -> &'static str {
        self.kind.as_str()
    }
}

// ---------- 最小 protobuf reader（只提取需要的字段） ----------

/// protobuf 流式读取器。未知字段一律跳过（wire type 兼容），不影响后续字段。
pub struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    pub fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0 }
    }

    pub fn eof(&self) -> bool {
        self.pos >= self.buf.len()
    }

    pub fn read_varint(&mut self) -> Option<u64> {
        let mut result: u64 = 0;
        let mut shift = 0;
        loop {
            let b = *self.buf.get(self.pos)?;
            self.pos += 1;
            result |= u64::from(b & 0x7f) << shift;
            if b & 0x80 == 0 {
                return Some(result);
            }
            shift += 7;
            if shift >= 64 {
                return None;
            }
        }
    }

    pub fn read_tag(&mut self) -> Option<(u32, u32)> {
        let tag = self.read_varint()?;
        Some(((tag >> 3) as u32, (tag & 7) as u32))
    }

    pub fn read_bytes(&mut self) -> Option<&'a [u8]> {
        let len = self.read_varint()? as usize;
        if self.pos + len > self.buf.len() {
            return None;
        }
        let s = &self.buf[self.pos..self.pos + len];
        self.pos += len;
        Some(s)
    }

    pub fn read_string(&mut self) -> Option<String> {
        self.read_bytes().map(|b| String::from_utf8_lossy(b).into_owned())
    }

    pub fn skip(&mut self, wire: u32) -> Option<()> {
        match wire {
            0 => {
                self.read_varint()?;
            }
            1 => {
                self.pos = self.pos.checked_add(8)?;
            }
            2 => {
                self.read_bytes()?;
            }
            5 => {
                self.pos = self.pos.checked_add(4)?;
            }
            _ => return None,
        }
        Some(())
    }
}

/// 在 `data` 中抽取 wire type=2 且字段号为 `target` 的 bytes 字段。
pub fn field_bytes<'a>(data: &'a [u8], target: u32) -> Option<&'a [u8]> {
    let mut r = Reader::new(data);
    while !r.eof() {
        let (f, w) = r.read_tag()?;
        if f == target && w == 2 {
            return r.read_bytes();
        }
        r.skip(w)?;
    }
    None
}

pub fn field_varint(data: &[u8], target: u32) -> Option<u64> {
    let mut r = Reader::new(data);
    while !r.eof() {
        let (f, w) = r.read_tag()?;
        if f == target && w == 0 {
            return r.read_varint();
        }
        r.skip(w)?;
    }
    None
}

pub fn field_string(data: &[u8], target: u32) -> Option<String> {
    field_bytes(data, target).map(|b| String::from_utf8_lossy(b).into_owned())
}

/// 抽取 `Image.urlList`（repeated string field 1）的首个元素。
fn image_first_url(image: &[u8]) -> Option<String> {
    let mut r = Reader::new(image);
    let mut first: Option<String> = None;
    while !r.eof() {
        let (f, w) = r.read_tag()?;
        match (f, w) {
            (1, 2) => {
                let s = r.read_string()?;
                if first.is_none() {
                    first = Some(s);
                }
            }
            _ => {
                r.skip(w)?;
            }
        }
    }
    first
}

/// 从 `EmojiChatMessage.emojiContent`(Text, field 4) 提取表情图片 URL。
/// 嵌套：Text.pieces[0](field 4) -> TextPiece.imageValue(25) -> TextPieceImage.image(1) -> Image.urlList[0](field 1)。
/// 返回 None 表示没有可用表情图（此时调用方应以 `defaultContent` 文本兜底）。
fn emoji_image_url(text: &[u8]) -> Option<String> {
    let piece0 = field_bytes(text, 4)?;
    let image_value = field_bytes(piece0, 25)?;
    let image = field_bytes(image_value, 1)?;
    image_first_url(image)
}

// ---------- 帧与消息解码 ----------

pub struct PushFrame {
    pub payload_type: Option<String>,
    pub payload: Option<Vec<u8>>,
    pub compressed: bool,
    pub log_id: u64,
    pub headers: std::collections::HashMap<String, String>,
}

/// PushFrame: 2.logId(varint) / 5.headersList(map) / 7.payloadType(str) / 8.payload(bytes)
pub fn decode_push_frame(data: &[u8]) -> Option<PushFrame> {
    let mut r = Reader::new(data);
    let mut f = PushFrame {
        payload_type: None,
        payload: None,
        compressed: false,
        log_id: 0,
        headers: std::collections::HashMap::new(),
    };
    while !r.eof() {
        let (num, wire) = r.read_tag()?;
        match (num, wire) {
            (2, 0) => f.log_id = r.read_varint()?,
            (5, 2) => {
                let entry = r.read_bytes()?;
                let mut er = Reader::new(entry);
                let mut key = String::new();
                let mut value = String::new();
                while !er.eof() {
                    let (en, ew) = er.read_tag()?;
                    match (en, ew) {
                        (1, 2) => key = er.read_string()?,
                        (2, 2) => value = er.read_string()?,
                        _ => {
                            er.skip(ew)?;
                        }
                    }
                }
                if key == "compress_type" && value == "gzip" {
                    f.compressed = true;
                    // 同时保留原 map，供下面提取 im-cursor / im-internal_ext
                }
                if !key.is_empty() {
                    f.headers.insert(key, value);
                }
            }
            (7, 2) => f.payload_type = Some(r.read_string()?),
            (8, 2) => f.payload = Some(r.read_bytes()?.to_vec()),
            _ => {
                r.skip(wire)?;
            }
        }
    }
    f.payload.as_ref()?;
    Some(f)
}

/// Response: 1.messages[](Message bytes) / 2.cursor(str) / 5.internalExt(str) / 9.needAck(bool)
///
/// 注意字段 5 才是 `internalExt`（string），字段 6 是 `fetchType`（int32）；
/// 之前误读字段 6 会导致后台 ack 的 internal_ext 恒空、push 游标可能不回推。
pub fn decode_response(payload: &[u8]) -> Option<(Vec<Vec<u8>>, String, String, bool)> {
    let mut r = Reader::new(payload);
    let mut messages = Vec::new();
    let mut cursor = String::new();
    let mut internal_ext = String::new();
    let mut need_ack = false;
    while !r.eof() {
        let (num, wire) = r.read_tag()?;
        match (num, wire) {
            (1, 2) => messages.push(r.read_bytes()?.to_vec()),
            (2, 2) => cursor = r.read_string()?,
            (5, 2) => internal_ext = r.read_string()?,
            (9, 0) => need_ack = r.read_varint()? != 0,
            _ => {
                r.skip(wire)?;
            }
        }
    }
    Some((messages, cursor, internal_ext, need_ack))
}

/// Message: 1.method / 2.payload / 3.msgId(uint64)。任一条解析失败返回 None，
/// 调用方应跳过该条继续处理后续消息，不能因一条坏消息中断整批。
pub fn decode_message(m: &[u8]) -> Option<(String, Vec<u8>, String)> {
    let method = field_string(m, 1)?;
    let payload = field_bytes(m, 2)?.to_vec();
    let msg_id = field_varint(m, 3).map(|v| v.to_string()).unwrap_or_default();
    Some((method, payload, msg_id))
}

// ---------- 各消息 → UnifiedMessage 解析（字段号同 model.ts） ----------

fn parse_user(user: &[u8]) -> UnifiedUser {
    UnifiedUser {
        id: field_string(user, 46),
        name: field_string(user, 3),
        gender: field_varint(user, 4).map(|v| v as i64),
        avatar: field_bytes(user, 9).and_then(image_first_url),
    }
}

fn short_name(option: Option<String>) -> Option<String> {
    option.map(|s| if s.trim().is_empty() { "未知用户".to_string() } else { s })
}

/// ChatMessage / TextMessage: 2.user / 3.content
fn parse_chat(payload: &[u8], method: &str, id: String) -> Option<UnifiedMessage> {
    let user = field_bytes(payload, 2).map(parse_user);
    let content = field_string(payload, 3).unwrap_or_default();
    Some(UnifiedMessage {
        id,
        method: method.to_string(),
        category: Some(CAT_CHAT.to_string()),
        user,
        content: Some(content),
        ..Default::default()
    })
}

/// EmojiChatMessage: 2.user / 4.emojiContent(Text) / 5.defaultContent
/// content 取 defaultContent(文本，供通知体)；emojiIcon 取 emojiContent 内层图片 URL(供前端 <img src>)。
fn parse_emoji(payload: &[u8], id: String) -> Option<UnifiedMessage> {
    let user = field_bytes(payload, 2).map(parse_user);
    let icon = field_bytes(payload, 4).and_then(emoji_image_url);
    let content = field_string(payload, 5).unwrap_or_else(|| "[表情]".to_string());
    Some(UnifiedMessage {
        id,
        method: METHOD_EMOJI_CHAT.to_string(),
        category: Some(CAT_CHAT.to_string()),
        user,
        content: Some(content),
        emoji_icon: icon,
        ..Default::default()
    })
}

/// GiftMessage: 7.user / 8.toUser / 15.gift(GiftStruct) / repeatEnd(9)
/// 数量 = repeatCount(5) || comboCount(6)。
/// GiftStruct: 16.name / 1.image / 5.id / 11.type / 12.diamondCount / 2.describe
fn parse_gift(payload: &[u8], id: String) -> Option<UnifiedMessage> {
    let user = field_bytes(payload, 7).map(parse_user);
    let to_user = field_bytes(payload, 8).map(parse_user);
    let gift_bytes = field_bytes(payload, 15);
    let count = {
        let repeat = field_varint(payload, 5).unwrap_or(0);
        let combo = field_varint(payload, 6).unwrap_or(0);
        if repeat > 0 {
            repeat
        } else if combo > 0 {
            combo
        } else {
            1
        }
    };
    let gift = gift_bytes.map(|g| UnifiedGift {
        id: field_varint(g, 5).map(|v| v.to_string()),
        name: field_string(g, 16),
        price: field_varint(g, 12).map(|v| v as i64),
        rtype: field_varint(g, 11).map(|v| v as i64),
        desc: field_string(g, 2),
        icon: field_bytes(g, 1).and_then(image_first_url),
        count: Some(count as i64),
        repeat_end: field_varint(payload, 9).map(|v| v as i64),
    });
    Some(UnifiedMessage {
        id,
        method: METHOD_GIFT.to_string(),
        category: Some(CAT_GIFT.to_string()),
        user,
        to_user,
        gift,
        ..Default::default()
    })
}

/// MemberMessage: 2.user / 3.memberCount
fn parse_member(payload: &[u8], id: String) -> Option<UnifiedMessage> {
    let user = field_bytes(payload, 2).map(parse_user);
    let member_count = field_varint(payload, 3).map(|v| v as i64);
    Some(UnifiedMessage {
        id,
        method: METHOD_MEMBER.to_string(),
        category: Some(CAT_ENTER.to_string()),
        user,
        content: Some("进入了直播间".to_string()),
        room: Some(UnifiedRoomStats {
            audience_count: member_count,
            ..Default::default()
        }),
        ..Default::default()
    })
}

/// SocialMessage: 2.user / 3.shareType / 4.action / 5.shareTarget / 6.followCount
fn parse_social(payload: &[u8], id: String) -> Option<UnifiedMessage> {
    let user = field_bytes(payload, 2).map(parse_user);
    let action = field_varint(payload, 4).map(|v| v as i64);
    let share_type = field_varint(payload, 3).map(|v| v as i64);
    let share_target = field_string(payload, 5);
    let follow_count = field_varint(payload, 6).map(|v| v as i64);
    Some(UnifiedMessage {
        id,
        method: METHOD_SOCIAL.to_string(),
        category: Some(CAT_FOLLOW.to_string()),
        user,
        content: Some(match action {
            Some(2) => "取消了关注".to_string(),
            Some(3) => "分享了直播间".to_string(),
            _ => "关注了主播".to_string(),
        }),
        social: Some(UnifiedSocial {
            action,
            target: share_target,
            rtype: share_type,
        }),
        room: Some(UnifiedRoomStats {
            follow_count,
            ..Default::default()
        }),
        ..Default::default()
    })
}

/// FansclubMessage: 3.content / 4.user
fn parse_fansclub(payload: &[u8], id: String) -> Option<UnifiedMessage> {
    let user = field_bytes(payload, 4).map(parse_user);
    let content = field_string(payload, 3).unwrap_or_else(|| "加入了粉丝团".to_string());
    Some(UnifiedMessage {
        id,
        method: METHOD_FANSCLUB.to_string(),
        category: Some(CAT_FANSCLUB.to_string()),
        user,
        content: Some(content),
        ..Default::default()
    })
}

/// LikeMessage: 2.count / 3.total / 5.user
fn parse_like(payload: &[u8], id: String) -> Option<UnifiedMessage> {
    let user = field_bytes(payload, 5).map(parse_user);
    let count = field_varint(payload, 2).unwrap_or(1) as i64;
    let total = field_varint(payload, 3).map(|v| v as i64);
    Some(UnifiedMessage {
        id,
        method: METHOD_LIKE.to_string(),
        category: Some(CAT_LIKE.to_string()),
        user,
        content: Some(format!("为主播点赞了({})", count)),
        room: Some(UnifiedRoomStats {
            like_count: total,
            ..Default::default()
        }),
        like_count: count,
        ..Default::default()
    })
}

/// RoomUserSeqMessage: 2.ranks[](Contributor) / 3.total / 7.totalUser
/// Contributor: 1.score / 2.user / 3.rank
fn parse_room_user_seq(payload: &[u8], id: String) -> Option<UnifiedMessage> {
    let ranks = collect_repeated(payload, 2, |uc| UnifiedRankItem {
        nickname: field_bytes(uc, 2)
            .map(parse_user)
            .and_then(|u| u.name)
            .unwrap_or_else(|| "未知用户".to_string()),
        avatar: field_bytes(uc, 2).map(parse_user).and_then(|u| u.avatar),
        rank: field_varint(uc, 3).map(|v| v as i64).unwrap_or(0),
        score: field_varint(uc, 1).map(|v| v as i64),
    });
    let total = field_varint(payload, 3).map(|v| v as i64);
    let total_user = field_varint(payload, 7).map(|v| v as i64);
    Some(UnifiedMessage {
        id,
        method: METHOD_ROOM_USER_SEQ.to_string(),
        category: None,
        rank: Some(ranks),
        room: Some(UnifiedRoomStats {
            audience_count: total,
            total_user_count: total_user,
            ..Default::default()
        }),
        ..Default::default()
    })
}

/// RoomRankMessage: 2.ranks[](RoomRank)。RoomRank: 1.user / 2.scoreStr(str)。
/// 无显式名次字段，`rank` 置 0，由前端按榜单顺序（数组下标+1）显示。
fn parse_room_rank(payload: &[u8], id: String) -> Option<UnifiedMessage> {
    let mut ranks: Vec<UnifiedRankItem> = Vec::new();
    {
        let mut r = Reader::new(payload);
        while !r.eof() {
            let (num, wire) = match r.read_tag() {
                Some(v) => v,
                None => break,
            };
            if num == 2 && wire == 2 {
                match r.read_bytes() {
                    Some(rr) => {
                        let user = field_bytes(rr, 1).map(parse_user);
                        let score_str = field_string(rr, 2);
                        ranks.push(UnifiedRankItem {
                            nickname: user
                                .as_ref()
                                .and_then(|u| u.name.clone())
                                .unwrap_or_else(|| "未知用户".to_string()),
                            avatar: user.and_then(|u| u.avatar),
                            rank: ranks.len() as i64 + 1,
                            score: score_str.as_ref().and_then(|s| s.parse::<i64>().ok()),
                        });
                    }
                    None => break,
                }
            } else if r.skip(wire).is_none() {
                break;
            }
        }
    }
    Some(UnifiedMessage {
        id,
        method: METHOD_ROOM_RANK.to_string(),
        category: None,
        rank: Some(ranks),
        ..Default::default()
    })
}

/// RoomStatsMessage: 3.displayMiddle(str) / 2.displayShort(str)
fn parse_room_stats(payload: &[u8], id: String) -> Option<UnifiedMessage> {
    let mid = field_string(payload, 3).unwrap_or_default();
    Some(UnifiedMessage {
        id,
        method: METHOD_ROOM_STATS.to_string(),
        category: None,
        room: Some(UnifiedRoomStats {
            audience_count: mid.parse::<i64>().ok().or_else(|| None),
            ..Default::default()
        }),
        ..Default::default()
    })
}

/// ControlMessage: 2.action / 3.tips。action 3/4/6 表示直播结束 → room.status = 4
fn parse_control(payload: &[u8], id: String) -> Option<UnifiedMessage> {
    let action = field_varint(payload, 2).map(|v| v as i64);
    let tips = field_string(payload, 3).unwrap_or_default();
    let status = match action {
        Some(CONTROL_ACTION_FINISH)
        | Some(CONTROL_ACTION_FINISH_BY_ADMIN)
        | Some(CONTROL_ACTION_ROOM_FINISH_BY_SWITCH) => Some(4),
        _ => None,
    };
    Some(UnifiedMessage {
        id,
        method: METHOD_CONTROL.to_string(),
        category: None,
        content: Some(tips),
        room: Some(UnifiedRoomStats {
            status,
            ..Default::default()
        }),
        ..Default::default()
    })
}

/// 解析一条 Message 为 UnifiedMessage；未知 method 或字段解析失败时返回 None（跳过，不中断）。
fn parse_unified(method: &str, payload: &[u8], id: String) -> Option<UnifiedMessage> {
    match method {
        METHOD_CHAT | METHOD_TEXT => parse_chat(payload, method, id),
        METHOD_EMOJI_CHAT => parse_emoji(payload, id),
        METHOD_GIFT => parse_gift(payload, id),
        METHOD_MEMBER => parse_member(payload, id),
        METHOD_SOCIAL => parse_social(payload, id),
        METHOD_FANSCLUB => parse_fansclub(payload, id),
        METHOD_LIKE => parse_like(payload, id),
        METHOD_ROOM_USER_SEQ => parse_room_user_seq(payload, id),
        METHOD_ROOM_RANK => parse_room_rank(payload, id),
        METHOD_ROOM_STATS => parse_room_stats(payload, id),
        METHOD_CONTROL => parse_control(payload, id),
        _ => None, // 未知 method：跳过该条，继续后续消息
    }
}

/// 抽取 `data` 中字段号 `target` 的所有 repeated bytes，并对每个 bytes 调用 `f`。
fn collect_repeated<T>(data: &[u8], target: u32, f: impl Fn(&[u8]) -> T) -> Vec<T> {
    let mut r = Reader::new(data);
    let mut out = Vec::new();
    while !r.eof() {
        let (num, wire) = match r.read_tag() {
            Some(v) => v,
            None => break,
        };
        if num == target && wire == 2 {
            match r.read_bytes() {
                Some(bytes) => out.push(f(bytes)),
                None => break,
            }
        } else if r.skip(wire).is_none() {
            break;
        }
    }
    out
}

// ---------- 对外统一入口 ----------

/// 解析一个上游二进制帧为统一事件。仅处理 `payloadType = "msg"`；其余类型（hb/ack/close）返回 None，
/// 由 proxy 按原样处理（前端旧逻辑兼容）。任一坏消息都会被跳过而不中断整批。
pub fn decode_frame(data: &[u8]) -> Option<UnifiedEvent> {
    let frame = decode_push_frame(data)?;
    if frame.payload_type.as_deref().map(str::to_ascii_lowercase).as_deref() != Some(PAYLOAD_TYPE_MSG) {
        return None;
    }
    let payload = frame.payload?;
    let raw = if frame.compressed {
        gunzip(&payload)?
    } else {
        payload
    };
    let (msg_bytes, resp_cursor, resp_ext, need_ack) = decode_response(&raw)?;

    // 游标/内部扩展：优先取 PushFrame headers，其次回退 Response（对齐前端 `_decodeFrame`）
    let cursor = frame
        .headers
        .get("im-cursor")
        .cloned()
        .filter(|s| !s.is_empty())
        .unwrap_or(resp_cursor);
    let internal_ext = frame
        .headers
        .get("im-internal_ext")
        .cloned()
        .filter(|s| !s.is_empty())
        .unwrap_or(resp_ext);

    let mut messages = Vec::new();
    for m in &msg_bytes {
        if let Some((method, mp, id)) = decode_message(m) {
            if let Some(um) = parse_unified(&method, &mp, id) {
                messages.push(um);
            }
        }
    }

    // 事件类别：由第一条有效消息决定（普通消息批默认 Messages）
    let kind = messages
        .first()
        .map(|m| match m.method.as_str() {
            METHOD_ROOM_RANK => UnifiedEventKind::RoomRank,
            METHOD_ROOM_USER_SEQ => UnifiedEventKind::RoomUserSeq,
            METHOD_ROOM_STATS => UnifiedEventKind::RoomStats,
            METHOD_CONTROL => UnifiedEventKind::Control,
            _ => UnifiedEventKind::Messages,
        })
        .unwrap_or(UnifiedEventKind::Messages);

    Some(UnifiedEvent {
        log_id: frame.log_id,
        cursor,
        internal_ext,
        need_ack,
        messages,
        kind,
    })
}

/// 将统一事件序列化为发送给前端 WebView 的 JSON 文本（字段名对齐前端 DyMessage，camelCase）。
pub fn event_to_json(event: &UnifiedEvent) -> String {
    serde_json::json!({
        "type": "dycast",
        "kind": event.kind_str(),
        "frame": {
            "logId": event.log_id.to_string(),
            "payloadType": PAYLOAD_TYPE_MSG,
        },
        "cursor": event.cursor,
        "internalExt": event.internal_ext,
        "needAck": event.need_ack,
        "messages": event.messages,
    })
    .to_string()
}

/// 构造 ACK 帧：PushFrame{ payloadType="ack", payload=internalExt, logId }（对齐前端 `_ack`）。
/// payloadType 使用小写 `ack`（大写 "Ack" 与可用路径不一致）。
pub fn build_ack_frame(log_id: u64, internal_ext: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(32 + internal_ext.len());
    out.push(0x3a); // field 7 (payloadType) wire 2
    out.push(3);
    out.extend_from_slice(b"ack");
    if !internal_ext.is_empty() {
        out.push(0x42); // field 8 (payload) wire 2
        write_varint(&mut out, internal_ext.len() as u64);
        out.extend_from_slice(internal_ext.as_bytes());
    }
    if log_id > 0 {
        out.push(0x10); // field 2 (logId) wire 0
        write_varint(&mut out, log_id);
    }
    out
}

fn write_varint(out: &mut Vec<u8>, mut v: u64) {
    loop {
        let b = (v & 0x7f) as u8;
        v >>= 7;
        if v == 0 {
            out.push(b);
            break;
        }
        out.push(b | 0x80);
    }
}

pub fn gunzip(data: &[u8]) -> Option<Vec<u8>> {
    let mut d = GzDecoder::new(data);
    let mut out = Vec::new();
    d.read_to_end(&mut out).ok()?;
    Some(out)
}

// ---------- 用户可读文案（供后台通知/前台展示） ----------

/// 昵称，缺省"未知用户"。
pub fn user_display_name(user: &UnifiedUser) -> String {
    short_name(user.name.clone()).unwrap_or_else(|| "未知用户".to_string())
}

/// 礼物通知文案尾部，如 `foo ×3`。
pub fn gift_body(gift: &UnifiedGift) -> String {
    let name = gift
        .name
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "礼物".to_string());
    match gift.count {
        Some(n) if n > 1 => format!("送出了 {} ×{}", name, n),
        _ => format!("送出了 {}", name),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn push_frame_bytes(log_id: u64, payload: &[u8]) -> Vec<u8> {
        // payloadType=msg(7,2): 0x3a len "msg"; payload(8,2): 0x42 len bytes
        let mut out = Vec::new();
        out.push(0x10);
        let mut li = log_id;
        loop {
            let b = (li & 0x7f) as u8;
            li >>= 7;
            if li == 0 {
                out.push(b);
                break;
            }
            out.push(b | 0x80);
        }
        out.push(0x3a);
        out.push(3);
        out.extend_from_slice(b"msg");
        out.push(0x42);
        out.push(payload.len() as u8);
        out.extend_from_slice(payload);
        out
    }

    fn len_delimited(field: u32, bytes: &[u8]) -> Vec<u8> {
        let tag = (field << 3) | 2;
        let mut out = Vec::new();
        let mut t = tag as u64;
        loop {
            let b = (t & 0x7f) as u8;
            t >>= 7;
            if t == 0 {
                out.push(b);
                break;
            }
            out.push(b | 0x80);
        }
        let mut len = bytes.len() as u64;
        loop {
            let b = (len & 0x7f) as u8;
            len >>= 7;
            if len == 0 {
                out.push(b);
                break;
            }
            out.push(b | 0x80);
        }
        out.extend_from_slice(bytes);
        out
    }

    fn str_field(field: u32, s: &str) -> Vec<u8> {
        len_delimited(field, s.as_bytes())
    }

    fn user_bytes(nickname: &str, sec_uid: &str) -> Vec<u8> {
        let mut u = vec![];
        u.extend_from_slice(&str_field(3, nickname));
        u.extend_from_slice(&str_field(46, sec_uid));
        u
    }

    fn chat_payload(nick: &str, content: &str) -> Vec<u8> {
        let mut p = vec![];
        let sec = format!("sec{nick}");
        p.extend_from_slice(&len_delimited(2, &user_bytes(nick, &sec)));
        p.extend_from_slice(&str_field(3, content));
        p
    }

    /// EmojiChatMessage: 2.user / 4.emojiContent(Text) / 5.defaultContent
    /// Text: 4.pieces[] ; TextPiece: 25.imageValue ; TextPieceImage: 1.image ; Image: 1.urlList[]
    fn emoji_payload(nick: &str, image_url: &str, default_text: &str) -> Vec<u8> {
        let mut p = vec![];
        let sec = format!("sec{nick}");
        p.extend_from_slice(&len_delimited(2, &user_bytes(nick, &sec)));
        // emojiContent(Text, field 4)
        let text = len_delimited(4, &len_delimited(25, &len_delimited(1, &str_field(1, image_url))));
        p.extend_from_slice(&len_delimited(4, &text));
        // defaultContent(field 5)
        p.extend_from_slice(&str_field(5, default_text));
        p
    }

    fn response_with(msg: &[u8]) -> Vec<u8> {
        len_delimited(1, msg) // messages field 1
    }

    fn message_bytes(method: &str, payload: &[u8]) -> Vec<u8> {
        let mut m = vec![];
        m.extend_from_slice(&str_field(1, method));
        m.extend_from_slice(&len_delimited(2, payload));
        m
    }

    #[test]
    fn decode_lowercase_msg_chat() {
        let msg = message_bytes(METHOD_CHAT, &chat_payload("小明", "你好"));
        let resp = response_with(&msg);
        let frame = push_frame_bytes(42, &resp);
        let ev = decode_frame(&frame).expect("应该能解析 msg 帧");
        assert_eq!(ev.log_id, 42);
        assert_eq!(ev.messages.len(), 1);
        let m = &ev.messages[0];
        assert_eq!(m.method, METHOD_CHAT);
        assert_eq!(m.category.as_deref(), Some(CAT_CHAT));
        assert_eq!(m.user.as_ref().and_then(|u| u.name.as_deref()), Some("小明"));
        assert_eq!(m.content.as_deref(), Some("你好"));
    }

    #[test]
    fn decode_emoji_chat_extracts_image_url() {
        let url = "https://p3.douyinpic.com/emoji/1.png";
        let msg = message_bytes(METHOD_EMOJI_CHAT, &emoji_payload("阿强", url, "哈哈"));
        let resp = response_with(&msg);
        let frame = push_frame_bytes(3, &resp);
        let ev = decode_frame(&frame).expect("emoji 帧应可解析");
        assert_eq!(ev.messages.len(), 1);
        let m = &ev.messages[0];
        assert_eq!(m.method, METHOD_EMOJI_CHAT);
        assert_eq!(m.category.as_deref(), Some(CAT_CHAT));
        // content 保留 defaultContent 文本
        assert_eq!(m.content.as_deref(), Some("哈哈"));
        // emojiIcon 从 emojiContent 内层解析出图片 URL
        assert_eq!(m.emoji_icon.as_deref(), Some(url));
    }

    #[test]
    fn decode_emoji_chat_without_image_falls_back_to_text() {
        // emojiContent 为空（无 field4），只给 defaultContent
        let mut p = vec![];
        p.extend_from_slice(&len_delimited(2, &user_bytes("阿强", "sec阿强")));
        p.extend_from_slice(&str_field(5, "[表情]"));
        let msg = message_bytes(METHOD_EMOJI_CHAT, &p);
        let ev = decode_frame(&push_frame_bytes(4, &response_with(&msg))).expect("应可解析");
        assert_eq!(ev.messages[0].content.as_deref(), Some("[表情]"));
        assert_eq!(ev.messages[0].emoji_icon, None);
    }

    #[test]
    fn ack_uses_lowercase() {
        let ack = build_ack_frame(7, "abc");
        let pf = decode_push_frame(&ack).expect("ack 帧可解析");
        assert_eq!(pf.payload_type.as_deref(), Some(PAYLOAD_TYPE_ACK)); // "ack"
        assert_eq!(pf.log_id, 7);
        assert_eq!(pf.payload.as_deref(), Some(&b"abc"[..]));
    }

    #[test]
    fn non_msg_frame_is_none() {
        // payloadType=hb（带空 payload，使 PushFrame 可解析，但非 msg 不解码为标准事件）
        let mut f = vec![0x3a, 2];
        f.extend_from_slice(b"hb");
        f.push(0x42);
        f.push(1);
        f.push(0x00);
        assert!(decode_push_frame(&f).is_some());
        assert!(decode_frame(&f).is_none());
    }

    #[test]
    fn bad_message_skipped_keeps_batch() {
        // 一条坏 Message（只有 method 无 payload，decode_message 失败被跳过）+ 一条好 Chat
        let good = message_bytes(METHOD_CHAT, &chat_payload("小明", "你好"));
        let mut resp = vec![];
        resp.extend_from_slice(&len_delimited(1, &str_field(1, "WebcastNoPayload")));
        resp.extend_from_slice(&len_delimited(1, &good));
        let frame = push_frame_bytes(1, &resp);
        let ev = decode_frame(&frame).expect("整批不应因单条坏消息中断");
        assert_eq!(ev.messages.len(), 1);
        assert_eq!(ev.messages[0].method, METHOD_CHAT);
    }

    #[test]
    fn decode_gzip_compressed_frame() {
        use flate2::write::GzEncoder;
        use std::io::Write;

        let msg = message_bytes(METHOD_CHAT, &chat_payload("小明", "你好"));
        let resp = response_with(&msg);
        let mut enc = GzEncoder::new(Vec::new(), flate2::Compression::default());
        enc.write_all(&resp).unwrap();
        let gz = enc.finish().unwrap();

        // PushFrame: headersList(5,2){compress_type=gzip} + payloadType=msg(7,2) + payload(8,2)
        let mut entry = vec![];
        entry.extend_from_slice(&str_field(1, "compress_type"));
        entry.extend_from_slice(&str_field(2, "gzip"));
        let mut f = vec![];
        f.extend_from_slice(&len_delimited(5, &entry));
        f.push(0x3a);
        f.push(3);
        f.extend_from_slice(b"msg");
        f.extend_from_slice(&len_delimited(8, &gz));

        let ev = decode_frame(&f).expect("gzip 帧应可解析");
        assert_eq!(ev.messages.len(), 1);
        assert_eq!(ev.messages[0].content.as_deref(), Some("你好"));
    }
}