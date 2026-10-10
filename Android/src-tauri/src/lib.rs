mod hot_update;
mod login;
mod notification;
mod notify_backend;
mod proxy;
mod short_link;
mod updater;
mod webcast_message;

use hot_update::{hot_apply, hot_check, hot_rollback};
use login::{
    close_douyin_room_search, close_login_window, extract_douyin_room_url,
    extract_douyin_sessionid, open_douyin_room_search, open_login_window, WebViewBounds,
};
use notification::{
    clear_expired_notifications, clear_notifications, is_app_foreground,
    is_foreground_service_running, is_ignoring_battery_optimizations, post_notification,
    request_autostart_settings, request_battery_optimization_whitelist, show_keep_alive_guide,
    start_foreground_service, stop_foreground_service, sync_native_settings,
};
use proxy::{start_proxy_server, ProxyState};
use short_link::resolve_short_url;
use updater::{
    apk_downloaded, download_apk, fetch_text, install_apk, open_unknown_source_settings,
    start_apk_download,
};
use std::sync::OnceLock;

/// Global proxy port assigned at startup. Frontend reads this via `get_proxy_port` command.
static PROXY_PORT: OnceLock<u16> = OnceLock::new();
/// Shared proxy state so commands can inject the user-provided sessionid.
static PROXY_STATE: OnceLock<ProxyState> = OnceLock::new();

#[tauri::command]
fn get_proxy_port() -> Option<u16> {
    PROXY_PORT.get().copied()
}

/// Open a WebView window for Douyin web login.
/// On Windows the backend can extract cookies from WebView2 directly.
/// On Android the frontend should navigate to the login WebView and capture
/// the sessionid (e.g. via `document.cookie` for non-HttpOnly cookies or a
/// platform plugin), then call `set_sessionid` to register it with the proxy.
#[tauri::command]
async fn open_douyin_login(
    app: tauri::AppHandle,
    bounds: Option<WebViewBounds>,
) -> Result<(), String> {
    open_login_window(&app, bounds)
}

/// Close the Douyin login WebView / dialog.
#[tauri::command]
async fn close_douyin_login(app: tauri::AppHandle) -> Result<(), String> {
    close_login_window(&app)
}

/// Send a chat message through the live.douyin.com page context on Android.
#[tauri::command]
async fn start_danmaku_send(room_id: String, request_url: String) -> Result<bool, String> {
    login::send_danmaku_android(&room_id, &request_url)
}

/// Preload the danmaku send WebView with the current room page (no request fired).
#[tauri::command]
async fn preload_danmaku_webview(room_id: String) -> Result<bool, String> {
    login::preload_danmaku_android(&room_id)
}

/// Read-only GET fetch inside the send WebView page context (full cookies + risk headers).
#[tauri::command]
async fn page_fetch(room_id: String, url: String) -> Result<bool, String> {
    login::page_fetch_android(&room_id, &url)
}

#[tauri::command]
async fn take_page_fetch() -> Result<Option<String>, String> {
    login::take_page_fetch_android()
}

/// Backup all live.douyin.com cookies from the WebView CookieManager.
#[tauri::command]
async fn backup_douyin_cookies() -> Result<Option<String>, String> {
    login::backup_cookies_android()
}

/// Restore cookies into the WebView CookieManager and flush to disk.
#[tauri::command]
async fn restore_douyin_cookies(cookie_header: String) -> Result<bool, String> {
    login::restore_cookies_android(&cookie_header)
}

#[tauri::command]
async fn extract_danmaku_result() -> Result<Option<String>, String> {
    login::take_danmaku_result_android()
}

#[tauri::command]
async fn destroy_danmaku_webview() -> Result<(), String> {
    login::destroy_danmaku_webview_android()
}

/// Set (or clear) the Douyin sessionid that the local proxy will inject into requests.
#[tauri::command]
async fn set_sessionid(sessionid: Option<String>) {
    if let Some(state) = PROXY_STATE.get() {
        let had = state.sessionid_cookie().is_some();
        state.set_sessionid(sessionid.clone());
        if let Some(ref sid) = sessionid {
            state.warmup_sessionid(sid).await;
        }
        log::info!(
            "proxy sessionid updated: {}",
            if state.sessionid_cookie().is_some() { "已设置" } else { "已清除" }
        );
        if sessionid.is_some() && !had {
            log::info!("代理 sessionid 已预热");
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        // 热更新资源协议：向前端伺服 app_data/hotupdate 内的文件（小功能免装 APK 更新）
        .register_uri_scheme_protocol("hotres", |ctx, request| {
            hot_update::handle_hotres_request(ctx.app_handle(), request)
        })
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .target(tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout))
                .target(tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                    file_name: Some("dycast".into()),
                }))
                .build(),
        )
        .setup(|_app| {
            // Spawn the local proxy server (HTTP + WS) that replaces nginx/vite proxy.
            // It listens on a random free port, which the frontend reads via get_proxy_port.
            let (handle, port, state) =
                start_proxy_server().expect("启动本地代理服务失败");
            log::info!("本地代理服务监听 http://127.0.0.1:{}", port);
            let _ = PROXY_PORT.set(port);
            let _ = PROXY_STATE.set(state);
            std::mem::forget(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_proxy_port,
            open_douyin_login,
            close_douyin_login,
            extract_douyin_sessionid,
            open_douyin_room_search,
            close_douyin_room_search,
            extract_douyin_room_url,
            set_sessionid,
            start_danmaku_send,
            preload_danmaku_webview,
            page_fetch,
            take_page_fetch,
            backup_douyin_cookies,
            restore_douyin_cookies,
            extract_danmaku_result,
            destroy_danmaku_webview,
            start_foreground_service,
            stop_foreground_service,
            post_notification,
            clear_notifications,
            clear_expired_notifications,
            request_battery_optimization_whitelist,
            request_autostart_settings,
            show_keep_alive_guide,
            is_app_foreground,
            is_ignoring_battery_optimizations,
            is_foreground_service_running,
            sync_native_settings,
            resolve_short_url,
            fetch_text,
            hot_check,
            hot_apply,
            hot_rollback,
            start_apk_download,
            download_apk,
            apk_downloaded,
            install_apk,
            open_unknown_source_settings
        ])
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用时出错");
}
