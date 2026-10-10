//! 原生侧弹幕通知后端（v1.3.0 新增，v1.3.4 重构）
//!
//! 目标：把「收弹幕 → 发通知」下沉到 Rust 原生侧，使 App 退到后台（WebView 被冻结）时
//! 仍能持续推送弹幕 / 礼物等通知，不再依赖前端 JS 存活。
//!
//! 数据源：`proxy.rs` 用 [`crate::webcast_message::decode_frame`] 统一解包上游二进制帧，
//! 生成标准 [`crate::webcast_message::UnifiedEvent`]。本模块只接收*统一标准消息*，
//! 不再维护自己的 protobuf Reader / 字段号 / 每种消息的解析分支（那些都集中在 `webcast_message.rs`）。
//! 本模块仅负责：
//!   1. 前后台判定与设置镜像（哪些类要推、展示方式、重要性、锁屏可见性）；
//!   2. 仅当 App 在**后台**时，把统一消息按镜像设置通过
//!      `NotificationHelper.postNotification` 发系统通知（前台由前端 JS 负责，两路互斥，天然去重）；
//!   3. ACK 不再由本模块负责——`proxy.rs` 统一回 ack（前台/后台一致），避免双路径 ACK 不一致。
//!
//! 协议字段号统一见 `webcast_message.rs` 头注释（与 `Android/src/core/model.ts` 对应）。

#[cfg(not(target_os = "android"))]
pub fn on_event(_event: &crate::webcast_message::UnifiedEvent) {}

#[cfg(not(target_os = "android"))]
pub fn set_settings(_json: &str) {}

#[cfg(target_os = "android")]
pub use impls::*;

#[cfg(target_os = "android")]
mod impls {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    use crate::login::{notification_helper_class, power_utils_class, settings_store_class};
    use crate::webcast_message::{
        gift_body, user_display_name, UnifiedEvent, UnifiedMessage, CAT_CHAT, CAT_ENTER,
        CAT_FANSCLUB, CAT_FOLLOW, CAT_GIFT, CAT_LIKE,
    };

    /// 与前端 `notificationManager.CATEGORY_NOTIFY_ID` 一致的固定通知 id
    const CATEGORY_NOTIFY_ID: [i64; 6] = [2001, 2002, 2003, 2004, 2005, 2006];
    const CATEGORY_KEYS: [&str; 6] = ["chat", "gift", "enter", "follow", "fansclub", "like"];

    // ---------- 设置镜像 ----------

    /// 每类展示方式编码：0=merge 合并 / 1=independent 每条独立 / 2=perUser 按用户合并
    const MODE_MERGE: u8 = 0;
    const MODE_INDEPENDENT: u8 = 1;
    const MODE_PER_USER: u8 = 2;
    /// 每类重要性编码：0=min 静默 / 1=low 低 / 2=default 中 / 3=high 高
    const IMP_MIN: u8 = 0;
    const IMP_LOW: u8 = 1;
    const IMP_DEFAULT: u8 = 2;
    const IMP_HIGH: u8 = 3;
    /// 锁屏可见性编码：0=public / 1=private / 2=secret
    const VIS_PUBLIC: u8 = 0;
    const VIS_PRIVATE: u8 = 1;
    const VIS_SECRET: u8 = 2;

    /// 各分类展示方式默认：chat=独立、gift=按用户、enter/follow/fansclub=合并、like=按用户
    const DEFAULT_MODES: [u8; 6] = [
        MODE_INDEPENDENT,
        MODE_PER_USER,
        MODE_MERGE,
        MODE_MERGE,
        MODE_MERGE,
        MODE_PER_USER,
    ];
    /// 各分类重要性默认：礼物=高、点赞=低、其余=中
    const DEFAULT_IMPORTANCES: [u8; 6] = [
        IMP_DEFAULT,
        IMP_HIGH,
        IMP_DEFAULT,
        IMP_DEFAULT,
        IMP_DEFAULT,
        IMP_LOW,
    ];
    const DEFAULT_LOCK_VISIBILITY: u8 = VIS_PRIVATE;

    #[derive(Clone)]
    struct NativeSettings {
        enabled: bool,
        background_enabled: bool,
        categories: [bool; 6],
        modes: [u8; 6],
        importances: [u8; 6],
        lock_visibility: u8,
    }

    impl Default for NativeSettings {
        fn default() -> Self {
            Self {
                enabled: true,
                background_enabled: true,
                categories: [true; 6],
                modes: DEFAULT_MODES,
                importances: DEFAULT_IMPORTANCES,
                lock_visibility: DEFAULT_LOCK_VISIBILITY,
            }
        }
    }

    static SETTINGS: Mutex<NativeSettings> = Mutex::new(NativeSettings {
        enabled: true,
        background_enabled: true,
        categories: [true; 6],
        modes: DEFAULT_MODES,
        importances: DEFAULT_IMPORTANCES,
        lock_visibility: DEFAULT_LOCK_VISIBILITY,
    });
    static SETTINGS_LOADED: AtomicBool = AtomicBool::new(false);

    fn parse_mode(s: &str) -> u8 {
        match s {
            "independent" => MODE_INDEPENDENT,
            "perUser" => MODE_PER_USER,
            _ => MODE_MERGE,
        }
    }
    fn parse_importance(s: &str) -> u8 {
        match s {
            "min" => IMP_MIN,
            "low" => IMP_LOW,
            "high" => IMP_HIGH,
            _ => IMP_DEFAULT,
        }
    }
    fn parse_visibility(s: &str) -> u8 {
        match s {
            "public" => VIS_PUBLIC,
            "secret" => VIS_SECRET,
            _ => VIS_PRIVATE,
        }
    }
    fn importance_str(v: u8) -> &'static str {
        match v {
            IMP_MIN => "min",
            IMP_LOW => "low",
            IMP_HIGH => "high",
            _ => "default",
        }
    }
    fn visibility_str(v: u8) -> &'static str {
        match v {
            VIS_PUBLIC => "public",
            VIS_SECRET => "secret",
            _ => "private",
        }
    }

    /// 前端每次 `updateSettings` 后同步调用：更新内存镜像（持久化由命令层写 SharedPreferences）。
    pub fn set_settings(json: &str) {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(json) else { return };
        let mut s = match SETTINGS.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        s.enabled = v.get("enabled").and_then(|x| x.as_bool()).unwrap_or(true);
        s.background_enabled = v
            .get("backgroundEnabled")
            .and_then(|x| x.as_bool())
            .unwrap_or(true);
        if let Some(c) = v.get("categories").and_then(|x| x.as_object()) {
            for (i, k) in CATEGORY_KEYS.iter().enumerate() {
                if let Some(b) = c.get(*k).and_then(|x| x.as_bool()) {
                    s.categories[i] = b;
                }
            }
        }
        if let Some(m) = v.get("categoryModes").and_then(|x| x.as_object()) {
            for (i, k) in CATEGORY_KEYS.iter().enumerate() {
                if let Some(str) = m.get(*k).and_then(|x| x.as_str()) {
                    s.modes[i] = parse_mode(str);
                }
            }
        }
        if let Some(imp) = v.get("categoryImportance").and_then(|x| x.as_object()) {
            for (i, k) in CATEGORY_KEYS.iter().enumerate() {
                if let Some(str) = imp.get(*k).and_then(|x| x.as_str()) {
                    s.importances[i] = parse_importance(str);
                }
            }
        }
        if let Some(str) = v.get("lockVisibility").and_then(|x| x.as_str()) {
            s.lock_visibility = parse_visibility(str);
        }
        SETTINGS_LOADED.store(true, Ordering::SeqCst);
    }

    /// 首次使用前从 SharedPreferences 恢复镜像（进程被杀后冷启动仍能读到用户设置）。
    fn ensure_settings_loaded() {
        if SETTINGS_LOADED.swap(true, Ordering::SeqCst) {
            return;
        }
        if let Some(json) = load_settings_jni() {
            set_settings(&json);
        }
    }

    fn snapshot_settings() -> NativeSettings {
        match SETTINGS.lock() {
            Ok(g) => g.clone(),
            Err(_) => NativeSettings::default(),
        }
    }

    // ---------- 前后台判定（2s 缓存，避免每条弹幕都做 JNI） ----------

    struct FgCache {
        value: bool,
        at: Instant,
    }
    static FG: Mutex<Option<FgCache>> = Mutex::new(None);

    fn is_foreground() -> bool {
        let now = Instant::now();
        if let Ok(g) = FG.lock() {
            if let Some(c) = g.as_ref() {
                if now.duration_since(c.at) < Duration::from_secs(2) {
                    return c.value;
                }
            }
        }
        let v = check_foreground_jni();
        if let Ok(mut g) = FG.lock() {
            g.replace(FgCache { value: v, at: now });
        }
        v
    }

    // ---------- 通知构造与发送 ----------

    fn post_notification_jni(payload: &str) {
        let _ = crate::notification::with_attached_env(|env| {
            let helper =
                crate::notification::local_class_from_global(env, notification_helper_class()?)?;
            let j = env.new_string(payload).map_err(|e| e.to_string())?;
            env.call_static_method(
                &helper,
                "postNotification",
                "(Ljava/lang/String;)Z",
                &[jni::objects::JValue::Object(&j)],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        });
    }

    /// 按分类生成通知参数 (idx, category, title, body, per_user)；
    /// 未知/不可通知分类返回 None（跳过）。文案对齐前端 `notificationManager.toPending`。
    fn notify_params(
        msg: &UnifiedMessage,
    ) -> Option<(usize, &'static str, String, String, (String, String, i64))> {
        let nick = msg
            .user
            .as_ref()
            .map(user_display_name)
            .unwrap_or_else(|| "未知用户".to_string());
        match msg.category.as_deref() {
            Some(CAT_CHAT) => {
                let content = msg.content.clone().unwrap_or_default();
                Some((0, CAT_CHAT, nick.clone(), content, (nick, String::new(), 1)))
            }
            Some(CAT_GIFT) => {
                let g = msg.gift.as_ref()?;
                let name = g
                    .name
                    .clone()
                    .filter(|n| !n.is_empty())
                    .unwrap_or_else(|| "礼物".to_string());
                let count = g.count.unwrap_or(1);
                Some((
                    1,
                    CAT_GIFT,
                    nick.clone(),
                    gift_body(g),
                    (format!("{}|{}", nick, name), format!("送出了 {}", name), count),
                ))
            }
            Some(CAT_ENTER) => Some((
                2,
                CAT_ENTER,
                nick.clone(),
                "进入了直播间".to_string(),
                (nick, String::new(), 1),
            )),
            Some(CAT_FOLLOW) => Some((
                3,
                CAT_FOLLOW,
                nick.clone(),
                msg.content.clone().unwrap_or_else(|| "关注了直播间".to_string()),
                (nick, String::new(), 1),
            )),
            Some(CAT_FANSCLUB) => Some((
                4,
                CAT_FANSCLUB,
                nick.clone(),
                msg.content.clone().unwrap_or_else(|| "加入了粉丝团".to_string()),
                (nick, String::new(), 1),
            )),
            Some(CAT_LIKE) => {
                let count = msg.like_count.max(1);
                let body = if count > 1 {
                    format!("点赞了直播间 ×{}", count)
                } else {
                    "点赞了直播间".to_string()
                };
                Some((5, CAT_LIKE, nick.clone(), body, (nick, "点赞了直播间".to_string(), count)))
            }
            _ => None,
        }
    }

    /// 按镜像设置决定是否发送通知；消费统一的 [`UnifiedMessage`]，不自带 protobuf 解析。
    fn handle_message(msg: &UnifiedMessage) {
        let s = snapshot_settings();
        if !s.enabled || !s.background_enabled {
            return;
        }
        let Some((idx, category, title, body, per_user)) = notify_params(msg) else {
            return;
        };
        if !s.categories[idx] {
            return;
        }

        let mode = s.modes[idx];
        let importance = importance_str(s.importances[idx]);
        let visibility = visibility_str(s.lock_visibility);

        let json = if mode == MODE_PER_USER {
            // 按用户合并：交原生侧按 actionKey 派生固定 id 并累计 xN
            let (ak, at, cnt) = per_user;
            serde_json::json!({
                "category": category,
                "title": title,
                "body": body,
                "actionKey": ak,
                "actionText": at,
                "count": cnt,
                "importance": importance,
                "visibility": visibility,
            })
        } else if mode == MODE_INDEPENDENT {
            // 每条独立：不传固定 id，原生侧分配唯一 id，可被单独清理
            serde_json::json!({
                "category": category,
                "title": title,
                "body": body,
                "independent": true,
                "importance": importance,
                "visibility": visibility,
            })
        } else {
            // 合并刷新：固定 id 覆盖同一条通知
            serde_json::json!({
                "category": category,
                "title": title,
                "body": body,
                "id": CATEGORY_NOTIFY_ID[idx],
                "count": 1,
                "importance": importance,
                "visibility": visibility,
            })
        }
        .to_string();
        post_notification_jni(&json);
    }

    // ---------- 对外入口 ----------

    /// 后台模式消费统一事件：前台由 WebView（经 JSON 事件）负责，后台直接发系统通知。
    /// ACK 不由本模块处理——`proxy.rs` 统一回上游（前台/后台一致，避免双路径 ACK 不一致）。
    pub fn on_event(event: &UnifiedEvent) {
        if is_foreground() {
            return;
        }
        ensure_settings_loaded();
        for m in &event.messages {
            handle_message(m);
        }
    }

    // ---------- JNI 桥 ----------

    fn check_foreground_jni() -> bool {
        crate::notification::with_attached_env(|env| {
            let utils = crate::notification::local_class_from_global(env, power_utils_class()?)?;
            let r = env
                .call_static_method(&utils, "isAppForeground", "()Z", &[])
                .map_err(|e| e.to_string())?;
            Ok(r.z().map_err(|e| e.to_string())?)
        })
        .unwrap_or(false)
    }

    fn load_settings_jni() -> Option<String> {
        crate::notification::with_attached_env(|env| {
            let store = crate::notification::local_class_from_global(env, settings_store_class()?)?;
            let s = env
                .call_static_method(&store, "loadSettings", "()Ljava/lang/String;", &[])
                .map_err(|e| e.to_string())?;
            let obj = s.l().map_err(|e| e.to_string())?;
            let jstring = jni::objects::JString::from(obj);
            let str = env.get_string(&jstring).map_err(|e| e.to_string())?;
            Ok(str.into())
        })
        .ok()
    }
}
