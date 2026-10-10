mod login;
mod notification;
mod proxy;
mod short_link;
mod updater;

use login::{
    close_douyin_room_search, close_login_window, extract_douyin_room_url,
    extract_douyin_sessionid, open_douyin_room_search, open_login_window, WebViewBounds,
};
use notification::{
    clear_notifications, is_app_foreground, is_foreground_service_running,
    is_ignoring_battery_optimizations, post_notification, request_autostart_settings,
    request_battery_optimization_whitelist, show_keep_alive_guide, start_foreground_service,
    stop_foreground_service,
};
use proxy::{start_proxy_server, ProxyState};
use short_link::resolve_short_url;
use updater::{fetch_text, open_unknown_source_settings, start_apk_download};
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
            start_foreground_service,
            stop_foreground_service,
            post_notification,
            clear_notifications,
            request_battery_optimization_whitelist,
            request_autostart_settings,
            show_keep_alive_guide,
            is_app_foreground,
            is_ignoring_battery_optimizations,
            is_foreground_service_running,
            resolve_short_url,
            fetch_text,
            start_apk_download,
            open_unknown_source_settings
        ])
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用时出错");
}
