//! Local proxy server that replaces the nginx / vite dev proxy.
//!
//! Replicates `vite.config.ts`:
//!   - `/dylive/*` -> https://live.douyin.com/*        (HTTP, rewrite cookies/UA)
//!   - `/socket/*` -> wss://webcast100-ws-web-lq.douyin.com/*  (WebSocket)
//!
//! A shared `reqwest` client with a persistent cookie jar keeps Douyin-set cookies
//! (`__ac_nonce`, `ttwid`, `msToken`, ...) flowing across requests, like a browser.

use axum::{
    body::Body,
    extract::{OriginalUri, State, WebSocketUpgrade},
    response::{IntoResponse, Response},
    routing::any,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use http::{HeaderMap, HeaderValue, Method};
use reqwest::{cookie::CookieStore, Client};
use std::{sync::Arc, sync::Mutex, time::Duration};
use tokio::net::TcpListener;
use tokio::sync::Mutex as TokioMutex;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};

const DY_HTTP_ORIGIN: &str = "https://live.douyin.com";
const DY_WS_ORIGIN: &str = "wss://webcast100-ws-web-lq.douyin.com";

/// PC UA, mirrors the nginx/vite config.
const PC_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0";

#[derive(Clone)]
pub struct ProxyState {
    client: Client,
    jar: Arc<reqwest::cookie::Jar>,
    /// Manually configured Douyin `sessionid` cookie, shared with the frontend.
    sessionid: Arc<Mutex<Option<String>>>,
}

impl ProxyState {
    /// Set the Douyin `sessionid` cookie that will be sent with every request.
    pub fn set_sessionid(&self, value: Option<String>) {
        if let Ok(mut sid) = self.sessionid.lock() {
            *sid = value;
        }
    }

    pub(crate) fn sessionid_cookie(&self) -> Option<String> {
        self.sessionid.lock().ok().and_then(|s| s.clone())
    }

    /// Warm up the cookie jar by visiting Douyin with the given sessionid so the
    /// server can set companion cookies (ttwid, msToken, ...) that are required
    /// alongside sessionid for authenticated APIs.
    pub async fn warmup_sessionid(&self, sessionid: &str) {
        let origin: url::Url = DY_HTTP_ORIGIN.parse().expect("有效的 HTTP 来源地址");
        let cookie = format!(
            "sessionid={sessionid}; Path=/; Domain=live.douyin.com; Secure; SameSite=None"
        );
        self.jar.add_cookie_str(&cookie, &origin);
        log::info!("代理 cookie jar 已使用 sessionid 预热");

        let urls = [
            DY_HTTP_ORIGIN.to_string(),
            format!("{}/webcast/user/", DY_HTTP_ORIGIN),
        ];
        for url in urls {
            match self
                .client
                .get(&url)
                .header(reqwest::header::USER_AGENT, PC_UA)
                .header(reqwest::header::REFERER, "https://live.douyin.com/")
                .header("Origin", "https://live.douyin.com")
                .send()
                .await
            {
                Ok(res) => log::info!("代理预热 {url} => {}", res.status()),
                Err(e) => log::warn!("代理预热 {url} 失败: {e}"),
            }
        }
    }
}

fn build_http_client() -> (Client, Arc<reqwest::cookie::Jar>) {
    let jar = Arc::new(reqwest::cookie::Jar::default());
    let client = Client::builder()
        .cookie_provider(Arc::clone(&jar))
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(Duration::from_secs(30))
        .user_agent(PC_UA)
        .build()
        .expect("构建 reqwest 客户端失败");
    (client, jar)
}

/// Start the local proxy on a free port. Returns the join handle, the port, and the shared state.
pub fn start_proxy_server() -> anyhow::Result<(tokio::task::JoinHandle<()>, u16, ProxyState)> {
    let (client, jar) = build_http_client();
    let state = ProxyState {
        client,
        jar,
        sessionid: Arc::new(Mutex::new(None)),
    };
    let state_for_server = state.clone();
    // CORS: frontend runs on tauri.localhost, proxy on 127.0.0.1:PORT,
    // so the browser/WebView treats it as cross-origin and CORS is required.
    // 仅放行本机前端来源（Tauri WebView / 本地开发与预览），
    // 避免任意网页借随机端口访问本机代理、读取带登录态的接口数据。
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(
            |origin: &HeaderValue, _req: &http::request::Parts| {
                let Ok(origin) = origin.to_str() else {
                    return false;
                };
                let origin = origin.to_ascii_lowercase();
                origin.starts_with("http://tauri.localhost")
                    || origin.starts_with("https://tauri.localhost")
                    || origin.starts_with("http://localhost")
                    || origin.starts_with("https://localhost")
                    || origin.starts_with("http://127.0.0.1")
                    || origin.starts_with("https://127.0.0.1")
            },
        ))
        .allow_methods(Any)
        .allow_headers(Any)
        // 注意：不暴露 Set-Cookie（浏览器本就禁止 JS 读取，暴露只会扩大攻击面）
        .expose_headers([
            http::header::CONTENT_TYPE,
            "x-secsdk-csrf-token".parse().unwrap(),
        ]);
    let app = Router::new()
        .route("/dylive", any(proxy_http_handler))
        .route("/dylive/*rest", any(proxy_http_handler))
        .route("/socket/*rest", any(proxy_ws_handler))
        .layer(cors)
        .with_state(state_for_server);

    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    let listener = rt.block_on(TcpListener::bind("127.0.0.1:0"))?;
    let port = listener.local_addr()?.port();
    log::info!("代理服务监听 127.0.0.1:{}", port);

    let handle = rt.spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            log::error!("代理服务错误: {e}");
        }
    });
    std::mem::forget(rt);
    Ok((handle, port, state))
}

/// `/dylive/*` HTTP proxy.
async fn proxy_http_handler(
    State(state): State<ProxyState>,
    OriginalUri(original_uri): OriginalUri,
    method: Method,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    log::info!("代理 HTTP {} {}", method, original_uri);
    // Strip "/dylive" prefix to get the upstream path.
    let path_and_query = original_uri
        .path_and_query()
        .map(|s| s.as_str())
        .unwrap_or("/");
    let rest = path_and_query
        .strip_prefix("/dylive")
        .unwrap_or(path_and_query);
    let target = format!("{}{}", DY_HTTP_ORIGIN, rest);
    let target_url: url::Url = match target.parse() {
        Ok(u) => u,
        Err(e) => {
            log::warn!("目标地址无效 {target}: {e}");
            return (http::StatusCode::BAD_REQUEST, format!("请求地址无效: {e}")).into_response();
        }
    };

    // Forward the frontend UA so a_bogus/signature computed with navigator.userAgent matches.
    let ua = headers
        .get(reqwest::header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or(PC_UA);

    // Referer 指向具体直播间页 live.douyin.com/{room_id}（对齐网页版写接口实录，
    // 参考 cv-cat/Douyin_Spider sendMsgInRoom：referer = live_url/{web_rid or room_id}）。
    // 弹幕/评论等写接口会按 referer 的路径校验来源，固定为首页 / 反而可能是风控特征。
    let referer = original_uri
        .query()
        .and_then(|q| {
            q.split('&').find_map(|kv| {
                let mut it = kv.splitn(2, '=');
                match (it.next(), it.next()) {
                    (Some("room_id"), Some(v)) if !v.is_empty() => Some(v.to_string()),
                    _ => None,
                }
            })
        })
        .map(|rid| format!("https://live.douyin.com/{rid}"))
        .unwrap_or_else(|| "https://live.douyin.com/".to_string());

    let mut rq = state.client.request(method, &target).body(body);
    rq = rq
        .header(reqwest::header::USER_AGENT, ua)
        .header(reqwest::header::REFERER, referer)
        .header("Origin", "https://live.douyin.com")
        .header("Host", "live.douyin.com");

    // Inject the user-provided sessionid cookie, if any.
    if let Some(sid) = state.sessionid_cookie() {
        log::info!("代理 HTTP 注入 sessionid，目标: {target}");
        let cookie = format!("sessionid={sid}");
        // merge with existing cookies from reqwest jar
        let existing = state
            .jar
            .cookies(&target_url)
            .and_then(|c| c.to_str().ok().map(|s| s.to_string()))
            .unwrap_or_default();
        let merged = if existing.is_empty() {
            cookie
        } else {
            format!("{}; {}", existing, cookie)
        };
        rq = rq.header(reqwest::header::COOKIE, merged);
    }

    // 透传 Content-Type：POST /webcast/room/chat 依赖 application/x-www-form-urlencoded
    // 解析表单 body，缺失时上游可能识别不到 content 字段（表现为弹幕发不出去）。
    if let Some(ct) = headers.get(reqwest::header::CONTENT_TYPE) {
        rq = rq.header(reqwest::header::CONTENT_TYPE, ct);
    }
    if let Some(h) = headers.get("x-secsdk-csrf-request") {
        rq = rq.header("x-secsdk-csrf-request", h);
    }
    if let Some(h) = headers.get("x-secsdk-csrf-version") {
        rq = rq.header("x-secsdk-csrf-version", h);
    }

    let upstream = match rq.send().await {
        Ok(r) => {
            log::info!("代理 HTTP 上游状态 {}，目标: {}", r.status(), target);
            r
        }
        Err(e) => {
            log::warn!("代理 HTTP 上游请求失败，目标: {target}，错误: {e}");
            return (
                http::StatusCode::BAD_GATEWAY,
                format!("上游请求失败: {e}"),
            )
                .into_response();
        }
    };

    let status = upstream.status();
    let mut out_headers = HeaderMap::new();
    for (k, v) in upstream.headers().iter() {
        if k.as_str().eq_ignore_ascii_case("set-cookie") {
            if let Ok(s) = v.to_str() {
                let rewritten = rewrite_set_cookie(s);
                if let Ok(hv) = HeaderValue::from_str(&rewritten) {
                    out_headers.append(k.clone(), hv);
                }
            }
            continue;
        }
        if matches!(
            k.as_str(),
            "content-encoding" | "transfer-encoding" | "connection" | "content-length" | "host"
        ) {
            continue;
        }
        out_headers.append(k.clone(), v.clone());
    }

    // 读取上游响应体。失败时不要静默返回"空 body + 上游状态"，否则前端会把
    // 半截/损坏的响应当作成功解析（尤其 protobuf 接口）。改为明确 502 并记日志。
    let bytes = match upstream.bytes().await {
        Ok(b) => b,
        Err(e) => {
            log::warn!("代理 HTTP 读取上游响应体失败，目标: {target}，错误: {e}");
            return (
                http::StatusCode::BAD_GATEWAY,
                format!("读取上游响应失败: {e}"),
            )
                .into_response();
        }
    };
    let mut resp = Response::builder()
        .status(status)
        .body(Body::from(bytes))
        .unwrap();
    for (k, v) in out_headers.iter() {
        resp.headers_mut().append(k.clone(), v.clone());
    }
    resp
}

/// Drop Domain/SameSite/Secure on Set-Cookie so the WebView on 127.0.0.1 accepts it.
fn rewrite_set_cookie(raw: &str) -> String {
    raw.split(';')
        .map(|s| s.trim())
        .filter(|s| {
            let l = s.to_ascii_lowercase();
            !(l.starts_with("domain=") || l.starts_with("samesite=") || l.starts_with("secure"))
        })
        .collect::<Vec<_>>()
        .join("; ")
}

/// `/socket/*` WebSocket proxy.
async fn proxy_ws_handler(
    State(state): State<ProxyState>,
    OriginalUri(original_uri): OriginalUri,
    ws: WebSocketUpgrade,
) -> Response {
    let path_and_query = original_uri
        .path_and_query()
        .map(|s| s.as_str())
        .unwrap_or("/");
    let rest = path_and_query
        .strip_prefix("/socket")
        .unwrap_or(path_and_query);
    let target = format!("{}{}", DY_WS_ORIGIN, rest);
    log::info!("代理 WebSocket 升级，目标: {target}");

    ws.on_upgrade(move |client_ws| async move {
        if let Err(e) = forward_ws(state, target, client_ws).await {
            log::warn!("WebSocket 代理结束: {e}");
        }
    })
}

async fn forward_ws(
    state: ProxyState,
    target: String,
    client_ws: axum::extract::ws::WebSocket,
) -> anyhow::Result<()> {
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::handshake::client::generate_key;

    let target_url: url::Url = target.parse().map_err(|e| anyhow::anyhow!("WebSocket 目标地址无效: {e}"))?;
    // Gather cookies valid for the WS host AND for the HTTP origin. Some Douyin cookies
    // are scoped to live.douyin.com but are still expected on the WS handshake.
    let http_origin: url::Url = DY_HTTP_ORIGIN.parse().expect("有效的 HTTP 来源地址");
    let ws_cookies = state.jar.cookies(&target_url);
    let http_cookies = state.jar.cookies(&http_origin);
    let mut cookie_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for src in [ws_cookies, http_cookies].into_iter().flatten() {
        if let Ok(s) = src.to_str() {
            for part in s.split(';') {
                let part = part.trim();
                if let Some(eq) = part.find('=') {
                    let name = part[..eq].trim().to_string();
                    let value = part[eq + 1..].trim().to_string();
                    cookie_map.insert(name, value);
                }
            }
        }
    }
    // Inject user-provided sessionid if not already in the jar.
    if let Some(sid) = state.sessionid_cookie() {
        cookie_map.insert("sessionid".to_string(), sid);
    }
    let cookie_value = if cookie_map.is_empty() {
        None
    } else {
        Some(
            cookie_map
                .into_iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect::<Vec<_>>()
                .join("; "),
        )
    };

    let mut req = http::Request::builder()
        .uri(&target)
        .method("GET")
        .header("User-Agent", PC_UA)
        .header("Origin", "https://live.douyin.com")
        .header("Host", "webcast100-ws-web-lq.douyin.com")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket");

    if let Some(ref cookies) = cookie_value {
        log::info!("转发 WebSocket 添加 Cookie: {cookies}");
        req = req.header("Cookie", cookies);
    } else {
        log::warn!("转发 WebSocket 没有可用 Cookie，目标: {target}");
    }

    let req = req
        .body(())
        .map_err(|e| anyhow::anyhow!("构建 WebSocket 请求失败: {e}"))?;

    log::info!("转发 WebSocket 上游握手，目标: {target}");
    let (upstream, upstream_res) = match connect_async(req).await {
        Ok(v) => v,
        Err(e) => {
            log::warn!("WebSocket 上游连接失败，目标: {target}，错误: {e}");
            return Err(anyhow::anyhow!("上游连接失败: {e}"));
        }
    };
    log::info!(
        "转发 WebSocket 上游已连接，状态: {}",
        upstream_res.status()
    );

    let (up_write, mut up_read) = upstream.split();
    let (mut client_sender, mut client_receiver) = client_ws.split();
    // v1.3.0：up_write 需被 c2u（心跳 / 客户端转发）与 u2c（原生通知后端回 ack）共享，
    // 包一层 Arc<tokio::Mutex>。
    let up_write = Arc::new(TokioMutex::new(up_write));
    let up_write_c2u = Arc::clone(&up_write);

    // 上游心跳间隔：15s。抖音 WebSocket 若长时间无数据会被服务端判定失联并断开
    // （实测约 5 分钟空闲即断）。前端 JS 在后台可能被 WebView 冻结，无法发心跳，
    // 因此由 Rust 代理统一兜底发送 WS Ping 帧保持连接活跃。
    const WS_HEARTBEAT_INTERVAL: std::time::Duration = std::time::Duration::from_secs(15);

    let c2u = async {
        let mut heartbeat = tokio::time::interval(WS_HEARTBEAT_INTERVAL);
        heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut first = true;
        loop {
            tokio::select! {
                _ = heartbeat.tick() => {
                    if first { first = false; continue; }
                    // 向前端 WebView 也发 Ping（保持本地 WS 活跃），再向上游发 Ping
                    if up_write_c2u.lock().await.send(WsMessage::Ping(Vec::new())).await.is_err() {
                        break;
                    }
                }
                msg = client_receiver.next() => {
                    let msg = match msg {
                        Some(Ok(m)) => m,
                        _ => break,
                    };
                    let m = match msg {
                        axum::extract::ws::Message::Text(t) => WsMessage::Text(t.to_string()),
                        axum::extract::ws::Message::Binary(b) => WsMessage::Binary(b.to_vec()),
                        axum::extract::ws::Message::Ping(b) => WsMessage::Ping(b),
                        axum::extract::ws::Message::Pong(b) => WsMessage::Pong(b),
                        axum::extract::ws::Message::Close(c) => WsMessage::Close(c.map(|c| {
                            tokio_tungstenite::tungstenite::protocol::CloseFrame {
                                code: c.code.into(),
                                reason: c.reason.to_string().into(),
                            }
                        })),
                    };
                    if up_write_c2u.lock().await.send(m).await.is_err() {
                        break;
                    }
                }
            }
        }
    };

    // 转发给 WebView 与"原生通知/ack"解耦（否则后台 WebView 冻结不排空本地 WS 时，
    // `client_sender.send(...).await` 会被 TCP 背压无限阻塞，把同循环里的原生链路一起饿死，
    // 表现为"后台约 2 分钟收不到弹幕/通知"。改为有界队列 + 独立转发协程，队列满即丢帧，只保证原生不阻塞）。
    let (client_tx, mut client_rx) =
        tokio::sync::mpsc::channel::<axum::extract::ws::Message>(256);
    let forwarder = tokio::spawn(async move {
        while let Some(m) = client_rx.recv().await {
            if client_sender.send(m).await.is_err() {
                break;
            }
        }
    });

    let u2c = async {
        while let Some(Ok(msg)) = up_read.next().await {
            // v1.3.4：统一协议链路 —— proxy 统一解包 PushFrame/gzip/Response/Message，
            // 前台页面与后台通知都消费同一份标准消息，不再各自解析原始抖音 protobuf。
            if let WsMessage::Binary(ref b) = msg {
                if let Some(ev) = crate::webcast_message::decode_frame(b) {
                    // 1) 后台原生通知消费统一消息（前台由 WebView 经下方 JSON 事件消费）
                    crate::notify_backend::on_event(&ev);
                    // 2) ACK 统一由 Rust 回上游（前台/后台一致，避免后台冻结造成 ACK 不一致）
                    if ev.need_ack {
                        let ack =
                            crate::webcast_message::build_ack_frame(ev.log_id, &ev.internal_ext);
                        if up_write
                            .lock()
                            .await
                            .send(WsMessage::Binary(ack.into()))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                    // 3) 把统一消息序列化为 JSON 事件发给 WebView；不在转发原始二进制。
                    //    队列满时丢帧（WebView 未消费），原生通知/ack 已在上方完成。
                    let json = crate::webcast_message::event_to_json(&ev);
                    let _ = client_tx.try_send(axum::extract::ws::Message::Text(json));
                    continue;
                }
                // 非 msg 帧（hb/ack/close）或无法解码：走下方旧逻辑原样转发，
                // 由前端兼容层继续按旧路径处理（保持原始二进制兼容）。
            }
            if let WsMessage::Close(ref cf) = msg {
                if let Some(cf) = cf {
                    log::warn!(
                        "转发 WebSocket 上游关闭帧 => 代码: {}, 原因: {}",
                        cf.code,
                        cf.reason
                    );
                } else {
                    log::warn!("转发 WebSocket 上游关闭帧缺少代码");
                }
            }
            let m = match msg {
                WsMessage::Text(t) => axum::extract::ws::Message::Text(t.into()),
                WsMessage::Binary(b) => axum::extract::ws::Message::Binary(b.into()),
                WsMessage::Ping(b) => axum::extract::ws::Message::Ping(b),
                WsMessage::Pong(b) => axum::extract::ws::Message::Pong(b),
                WsMessage::Close(c) => axum::extract::ws::Message::Close(c.map(|cf| {
                    axum::extract::ws::CloseFrame {
                        code: cf.code.into(),
                        reason: cf.reason.to_string().into(),
                    }
                })),
                _ => continue,
            };
            // 非阻塞入队：WebView 未消费导致队列满时丢弃该帧转发。
            let _ = client_tx.try_send(m);
        }
    };

    tokio::select! {
        _ = c2u => {},
        _ = u2c => {},
    }
    forwarder.abort();
    Ok(())
}
