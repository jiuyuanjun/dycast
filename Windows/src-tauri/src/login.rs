//! Douyin web login helper.
//!
//! - Windows: opens a Tauri WebView pointing at `https://live.douyin.com` and extracts
//!   cookies (including HttpOnly) via the WebView2 CookieManager.
//! - Android: shows a full-screen native WebView dialog backed by the global
//!   android.webkit.CookieManager. Rust calls into a Kotlin helper
//!   (`LoginWebViewHelper`) via JNI to show/hide the dialog and read cookies.
//! - Other platforms: not supported.

use tauri::{AppHandle, Emitter};
#[cfg(desktop)]
use tauri::Manager;

#[cfg(desktop)]
const LOGIN_WINDOW_LABEL: &str = "douyin-login";
#[cfg(not(target_os = "android"))]
const LOGIN_URL: &str = "https://live.douyin.com";

/// Screen bounds where the login WebView should be embedded.
#[derive(serde::Deserialize, Debug, Clone, Copy)]
#[allow(dead_code)] // Android 端使用 bounds 定位 WebView；桌面端暂不读取
pub struct WebViewBounds {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// Close the Douyin login WebView / dialog.
#[cfg(desktop)]
pub fn close_login_window(app: &AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(LOGIN_WINDOW_LABEL) {
        let _ = win.close();
    }
    Ok(())
}

#[cfg(target_os = "android")]
pub fn close_login_window(_app: &AppHandle) -> Result<(), String> {
    dismiss_login_webview_android()
}

#[cfg(all(mobile, not(target_os = "android")))]
pub fn close_login_window(_app: &AppHandle) -> Result<(), String> {
    Ok(())
}

/// Open the Douyin login WebView.
#[cfg(desktop)]
pub fn open_login_window(app: &AppHandle, _bounds: Option<WebViewBounds>) -> Result<(), String> {
    // Close any existing login window first.
    if let Some(win) = app.get_webview_window(LOGIN_WINDOW_LABEL) {
        let _ = win.close();
    }

    let login_url = tauri::WebviewUrl::External(
        LOGIN_URL
            .parse::<url::Url>()
            .map_err(|e| format!("登录地址无效: {e}"))?,
    );

    let win = tauri::WebviewWindowBuilder::new(app, LOGIN_WINDOW_LABEL, login_url)
        .title("抖音登录")
        .inner_size(900.0, 700.0)
        .center()
        .resizable(true)
        .build()
        .map_err(|e| format!("创建登录窗口失败: {e}"))?;

    // Mute the WebView audio on Windows via WebView2 APIs.
    #[cfg(windows)]
    let _ = mute_webview(&win);

    Ok(())
}

/// On Android embed the native login WebView at the requested screen bounds.
#[cfg(target_os = "android")]
pub fn open_login_window(_app: &AppHandle, bounds: Option<WebViewBounds>) -> Result<(), String> {
    show_login_webview_android(bounds)
}

/// On other mobile platforms emit an event so the frontend can handle login itself.
#[cfg(all(mobile, not(target_os = "android")))]
pub fn open_login_window(app: &AppHandle, _bounds: Option<WebViewBounds>) -> Result<(), String> {
    let _ = app.emit("douyin:open-login", LOGIN_URL);
    Ok(())
}

/// Open a WebView window for Douyin live room search.
#[tauri::command]
pub async fn open_douyin_room_search(
    app: tauri::AppHandle,
    url: Option<String>,
    bounds: Option<WebViewBounds>,
) -> Result<(), String> {
    open_room_search_window(&app, url, bounds)
}

/// Close the Douyin room search WebView / dialog.
#[tauri::command]
pub async fn close_douyin_room_search(app: tauri::AppHandle) -> Result<(), String> {
    close_room_search_window(&app)
}

/// Get the current URL of the Douyin room search WebView.
#[tauri::command]
pub async fn extract_douyin_room_url() -> Result<Option<String>, String> {
    extract_room_url_impl().await
}

/// Extract `sessionid` from the login window's WebView2 cookie store and close the window.
#[tauri::command]
pub async fn extract_douyin_sessionid(app: AppHandle) -> Result<Option<String>, String> {
    extract_sessionid_impl(&app).await
}

#[cfg(windows)]
async fn extract_sessionid_impl(app: &AppHandle) -> Result<Option<String>, String> {
    use std::sync::mpsc;
    use webview2_com::{
        take_pwstr,
        GetCookiesCompletedHandler,
        Microsoft::Web::WebView2::Win32::{ICoreWebView2_2, ICoreWebView2Cookie},
    };
    use windows::core::{HSTRING, Interface, PWSTR};

    let (tx, rx) = mpsc::channel::<Option<String>>();

    let Some(win) = app.get_webview_window(LOGIN_WINDOW_LABEL) else {
        return Ok(None);
    };

    let tx_for_error = tx.clone();
    let _ = win.with_webview(move |webview| {
        unsafe {
            let core = match webview.controller().CoreWebView2() {
                Ok(c) => c,
                Err(e) => {
                    log::warn!("获取 CoreWebView2 失败: {e}");
                    let _ = tx_for_error.send(None);
                    return;
                }
            };
            let core2 = match core.cast::<ICoreWebView2_2>() {
                Ok(c) => c,
                Err(e) => {
                    log::warn!("转换到 ICoreWebView2_2 失败: {e}");
                    let _ = tx_for_error.send(None);
                    return;
                }
            };
            let manager = match core2.CookieManager() {
                Ok(m) => m,
                Err(e) => {
                    log::warn!("获取 CookieManager 失败: {e}");
                    let _ = tx_for_error.send(None);
                    return;
                }
            };
            let uri = HSTRING::from(LOGIN_URL);

            let tx_for_callback = tx_for_error.clone();
            let result = GetCookiesCompletedHandler::wait_for_async_operation(
                Box::new(move |handler| {
                    manager.GetCookies(&uri, &handler)?;
                    Ok(())
                }),
                Box::new(move |hresult, list| {
                    hresult?;
                    let mut sid = None;
                    if let Some(list) = list {
                        let mut count: u32 = 0;
                        list.Count(&mut count)?;
                        for i in 0..count {
                            let cookie: ICoreWebView2Cookie = list.GetValueAtIndex(i)?;
                            let mut name = PWSTR::null();
                            cookie.Name(&mut name)?;
                            let name_str = take_pwstr(name);
                            if name_str == "sessionid" {
                                let mut value = PWSTR::null();
                                cookie.Value(&mut value)?;
                                sid = Some(take_pwstr(value));
                                break;
                            }
                        }
                    }
                    let _ = tx_for_callback.send(sid);
                    Ok(())
                }),
            );

            if let Err(e) = result {
                log::warn!("GetCookies 异步操作失败: {e}");
                let _ = tx_for_error.send(None);
            }
        }
    });

    // Run the blocking cookie retrieval on a separate thread so the async command can await.
    let sid = tokio::task::spawn_blocking(move || rx.recv().unwrap_or(None))
        .await
        .map_err(|e| format!("阻塞任务错误: {e}"))?;

    // Only close the login window and emit the event when we actually got a sessionid.
    // If the user hasn't logged in yet, the frontend will poll again.
    if let Some(ref value) = sid {
        if let Some(win) = app.get_webview_window(LOGIN_WINDOW_LABEL) {
            let _ = win.close();
        }
        let _ = app.emit("douyin:sessionid", value.clone());
    }

    Ok(sid)
}

#[cfg(target_os = "android")]
async fn extract_sessionid_impl(app: &AppHandle) -> Result<Option<String>, String> {
    let sid = tokio::task::spawn_blocking(get_sessionid_android)
        .await
        .map_err(|e| format!("阻塞任务错误: {e}"))??;

    if let Some(ref value) = sid {
        let _ = dismiss_login_webview_android();
        let _ = app.emit("douyin:sessionid", value.clone());
    }

    Ok(sid)
}

#[cfg(not(any(windows, target_os = "android")))]
async fn extract_sessionid_impl(_app: &AppHandle) -> Result<Option<String>, String> {
    Err("仅在 Windows 和 Android 平台支持提取 sessionid".to_string())
}

// ---------------------------------------------------------------------------
// Room search window helpers (cross-platform stubs + Android JNI)
// ---------------------------------------------------------------------------

#[cfg(desktop)]
pub fn open_room_search_window(app: &AppHandle, url: Option<String>, _bounds: Option<WebViewBounds>) -> Result<(), String> {
    // Desktop: reuse the login window but point at the Douyin live homepage.
    if let Some(win) = app.get_webview_window(LOGIN_WINDOW_LABEL) {
        let _ = win.close();
    }
    let target_url = url.unwrap_or_else(|| LOGIN_URL.to_string());
    let login_url = tauri::WebviewUrl::External(
        target_url
            .parse::<url::Url>()
            .map_err(|e| format!("搜索地址无效: {e}"))?,
    );
    let _ = tauri::WebviewWindowBuilder::new(app, LOGIN_WINDOW_LABEL, login_url)
        .title("抖音直播搜索")
        .inner_size(900.0, 700.0)
        .center()
        .resizable(true)
        .build()
        .map_err(|e| format!("创建搜索窗口失败: {e}"))?;
    Ok(())
}

#[cfg(target_os = "android")]
pub fn open_room_search_window(_app: &AppHandle, url: Option<String>, bounds: Option<WebViewBounds>) -> Result<(), String> {
    show_room_search_webview_android(url, bounds)
}

#[cfg(all(mobile, not(target_os = "android")))]
pub fn open_room_search_window(_app: &AppHandle, _url: Option<String>, _bounds: Option<WebViewBounds>) -> Result<(), String> {
    Ok(())
}

#[cfg(desktop)]
pub fn close_room_search_window(app: &AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(LOGIN_WINDOW_LABEL) {
        let _ = win.close();
    }
    Ok(())
}

#[cfg(target_os = "android")]
pub fn close_room_search_window(_app: &AppHandle) -> Result<(), String> {
    dismiss_login_webview_android()
}

#[cfg(all(mobile, not(target_os = "android")))]
pub fn close_room_search_window(_app: &AppHandle) -> Result<(), String> {
    Ok(())
}

async fn extract_room_url_impl() -> Result<Option<String>, String> {
    extract_room_url_platform().await
}

#[cfg(windows)]
async fn extract_room_url_platform() -> Result<Option<String>, String> {
    // On Windows the frontend can read the URL directly via its own WebView if needed.
    // For now return an error so the frontend falls back to non-Tauri behavior.
    Err("Windows 平台暂不支持提取搜索 URL".to_string())
}

#[cfg(target_os = "android")]
async fn extract_room_url_platform() -> Result<Option<String>, String> {
    let url = tokio::task::spawn_blocking(get_room_url_android)
        .await
        .map_err(|e| format!("阻塞任务错误: {e}"))??;
    Ok(url)
}

#[cfg(not(any(windows, target_os = "android")))]
async fn extract_room_url_platform() -> Result<Option<String>, String> {
    Err("仅在 Android 平台支持提取搜索 URL".to_string())
}

/// Try to mute a WebView2 window.
#[cfg(windows)]
fn mute_webview(win: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_22;
    use windows::core::Interface;

    let _ = win.with_webview(|webview| {
        unsafe {
            let core = match webview.controller().CoreWebView2() {
                Ok(c) => c,
                Err(e) => {
                    log::warn!("获取 CoreWebView2 以静音失败: {e}");
                    return;
                }
            };
            let core22 = match core.cast::<ICoreWebView2_22>() {
                Ok(c) => c,
                Err(e) => {
                    log::warn!("转换到 ICoreWebView2_22 以静音失败: {e}");
                    return;
                }
            };
            if let Err(e) = core22.SetIsMuted(true) {
                log::warn!("静音 WebView 失败: {e}");
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Android JNI bridge to LoginWebViewHelper.kt
// ---------------------------------------------------------------------------

#[cfg(target_os = "android")]
use std::ffi::c_void;
#[cfg(target_os = "android")]
use std::sync::OnceLock;

#[cfg(target_os = "android")]
use jni::objects::JClass;

#[cfg(target_os = "android")]
pub static JVM: OnceLock<jni::JavaVM> = OnceLock::new();
#[cfg(target_os = "android")]
static LOGIN_HELPER_CLASS: OnceLock<jni::objects::GlobalRef> = OnceLock::new();
#[cfg(target_os = "android")]
static MAIN_ACTIVITY_CLASS: OnceLock<jni::objects::GlobalRef> = OnceLock::new();
#[cfg(target_os = "android")]
static NOTIFICATION_HELPER_CLASS: OnceLock<jni::objects::GlobalRef> = OnceLock::new();
#[cfg(target_os = "android")]
static POWER_UTILS_CLASS: OnceLock<jni::objects::GlobalRef> = OnceLock::new();
#[cfg(target_os = "android")]
static FOREGROUND_SERVICE_CLASS: OnceLock<jni::objects::GlobalRef> = OnceLock::new();
#[cfg(target_os = "android")]
static UPDATER_HELPER_CLASS: OnceLock<jni::objects::GlobalRef> = OnceLock::new();

/// Capture the JavaVM and cache app classes when the native library is loaded.
/// Caching the class via a global reference keeps it accessible from threads attached later,
/// avoiding ClassNotFoundException caused by the system class loader not seeing app classes.
#[no_mangle]
#[cfg(target_os = "android")]
pub extern "C" fn JNI_OnLoad(vm: jni::JavaVM, _reserved: *mut c_void) -> jni::sys::jint {
    {
        let mut env = vm
            .attach_current_thread()
            .expect("JNI_OnLoad 中附加线程失败");

        let mut cache_class = |name: &str| -> jni::objects::GlobalRef {
            let class = env
                .find_class(name)
                .expect(&format!("JNI_OnLoad 中找不到类 {name}"));
            env.new_global_ref(&class)
                .expect(&format!("JNI_OnLoad 中为类 {name} 创建全局引用失败"))
        };

        let _ = LOGIN_HELPER_CLASS.set(cache_class("com/dycast/app/LoginWebViewHelper"));
        let _ = MAIN_ACTIVITY_CLASS.set(cache_class("com/dycast/app/MainActivity"));
        let _ = NOTIFICATION_HELPER_CLASS.set(cache_class("com/dycast/app/NotificationHelper"));
        let _ = POWER_UTILS_CLASS.set(cache_class("com/dycast/app/PowerUtils"));
        let _ = FOREGROUND_SERVICE_CLASS.set(cache_class("com/dycast/app/DyCastForegroundService"));
        let _ = UPDATER_HELPER_CLASS.set(cache_class("com/dycast/app/UpdaterHelper"));
    }
    let _ = JVM.set(vm);

    jni::sys::JNI_VERSION_1_6
}

#[cfg(target_os = "android")]
pub fn helper_class() -> Result<&'static jni::objects::GlobalRef, String> {
    LOGIN_HELPER_CLASS
        .get()
        .ok_or_else(|| "LoginWebViewHelper 类未缓存".to_string())
}

#[cfg(target_os = "android")]
pub fn main_activity_class() -> Result<&'static jni::objects::GlobalRef, String> {
    MAIN_ACTIVITY_CLASS
        .get()
        .ok_or_else(|| "MainActivity 类未缓存".to_string())
}

#[cfg(target_os = "android")]
pub fn notification_helper_class() -> Result<&'static jni::objects::GlobalRef, String> {
    NOTIFICATION_HELPER_CLASS
        .get()
        .ok_or_else(|| "NotificationHelper 类未缓存".to_string())
}

#[cfg(target_os = "android")]
pub fn power_utils_class() -> Result<&'static jni::objects::GlobalRef, String> {
    POWER_UTILS_CLASS
        .get()
        .ok_or_else(|| "PowerUtils 类未缓存".to_string())
}

#[cfg(target_os = "android")]
pub fn foreground_service_class() -> Result<&'static jni::objects::GlobalRef, String> {
    FOREGROUND_SERVICE_CLASS
        .get()
        .ok_or_else(|| "DyCastForegroundService 类未缓存".to_string())
}

#[cfg(target_os = "android")]
pub fn updater_helper_class() -> Result<&'static jni::objects::GlobalRef, String> {
    UPDATER_HELPER_CLASS
        .get()
        .ok_or_else(|| "UpdaterHelper 类未缓存".to_string())
}

/// Convert the cached global class reference into a local `JClass` valid for this JNIEnv.
#[cfg(target_os = "android")]
pub fn local_helper_class<'a>(env: &mut jni::JNIEnv<'a>) -> Result<JClass<'a>, String> {
    let global = helper_class()?;
    let local = env
        .new_local_ref(global.as_obj())
        .map_err(|e| format!("创建本地引用失败: {e}"))?;
    Ok(JClass::from(local))
}

#[cfg(target_os = "android")]
fn show_login_webview_android(bounds: Option<WebViewBounds>) -> Result<(), String> {
    let vm = JVM.get().ok_or("JavaVM 未初始化")?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("附加线程失败: {e}"))?;
    let class = local_helper_class(&mut env)?;

    let (x, y, w, h) = match bounds {
        Some(b) => (b.x, b.y, b.width, b.height),
        None => (0, 0, 0, 0),
    };

    env.call_static_method(
        &class,
        "showLoginWebView",
        "(IIII)V",
        &[
            jni::objects::JValue::Int(x),
            jni::objects::JValue::Int(y),
            jni::objects::JValue::Int(w),
            jni::objects::JValue::Int(h),
        ],
    )
    .map_err(|e| format!("显示登录 WebView 失败: {e}"))?;
    Ok(())
}

#[cfg(target_os = "android")]
fn get_sessionid_android() -> Result<Option<String>, String> {
    use jni::objects::JString;

    let vm = JVM.get().ok_or("JavaVM 未初始化")?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("附加线程失败: {e}"))?;
    let class = local_helper_class(&mut env)?;
    let result = env
        .call_static_method(&class, "getSessionid", "()Ljava/lang/String;", &[])
        .map_err(|e| format!("获取 sessionid 失败: {e}"))?;

    let obj = result.l().map_err(|e| format!("返回类型错误: {e}"))?;
    if obj.is_null() {
        return Ok(None);
    }

    let jstring = JString::from(obj);
    let s: String = env
        .get_string(&jstring)
        .map_err(|e| format!("读取字符串失败: {e}"))?
        .into();

    if s.is_empty() {
        Ok(None)
    } else {
        Ok(Some(s))
    }
}

#[cfg(target_os = "android")]
pub fn dismiss_login_webview_android() -> Result<(), String> {
    let vm = JVM.get().ok_or("JavaVM 未初始化")?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("附加线程失败: {e}"))?;
    let class = local_helper_class(&mut env)?;
    env.call_static_method(&class, "dismissDialog", "()V", &[])
        .map_err(|e| format!("关闭登录对话框失败: {e}"))?;
    Ok(())
}

#[cfg(target_os = "android")]
fn show_room_search_webview_android(url: Option<String>, bounds: Option<WebViewBounds>) -> Result<(), String> {
    let vm = JVM.get().ok_or("JavaVM 未初始化")?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("附加线程失败: {e}"))?;
    let class = local_helper_class(&mut env)?;

    let (x, y, w, h) = match bounds {
        Some(b) => (b.x, b.y, b.width, b.height),
        None => (0, 0, 0, 0),
    };
    let target_url = url.unwrap_or_else(|| "https://live.douyin.com".to_string());
    let url_jstring = env
        .new_string(&target_url)
        .map_err(|e| format!("创建 URL 字符串失败: {e}"))?;

    env.call_static_method(
        &class,
        "showRoomSearchWebView",
        "(Ljava/lang/String;IIII)V",
        &[
            jni::objects::JValue::Object(&url_jstring),
            jni::objects::JValue::Int(x),
            jni::objects::JValue::Int(y),
            jni::objects::JValue::Int(w),
            jni::objects::JValue::Int(h),
        ],
    )
    .map_err(|e| format!("显示搜索 WebView 失败: {e}"))?;
    Ok(())
}

#[cfg(target_os = "android")]
fn get_room_url_android() -> Result<Option<String>, String> {
    use jni::objects::JString;

    let vm = JVM.get().ok_or("JavaVM 未初始化")?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("附加线程失败: {e}"))?;
    let class = local_helper_class(&mut env)?;
    let result = env
        .call_static_method(&class, "getCurrentUrl", "()Ljava/lang/String;", &[])
        .map_err(|e| format!("获取当前 URL 失败: {e}"))?;

    let obj = result.l().map_err(|e| format!("返回类型错误: {e}"))?;
    if obj.is_null() {
        return Ok(None);
    }

    let jstring = JString::from(obj);
    let s: String = env
        .get_string(&jstring)
        .map_err(|e| format!("读取字符串失败: {e}"))?
        .into();

    if s.is_empty() {
        Ok(None)
    } else {
        Ok(Some(s))
    }
}

#[cfg(target_os = "android")]
#[allow(dead_code)]
fn is_login_webview_showing_android() -> Result<bool, String> {
    let vm = JVM.get().ok_or("JavaVM 未初始化")?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("附加线程失败: {e}"))?;
    let class = local_helper_class(&mut env)?;
    let result = env
        .call_static_method(&class, "isDialogShowing", "()Z", &[])
        .map_err(|e| format!("检查登录对话框状态失败: {e}"))?;
    result
        .z()
        .map_err(|e| format!("返回类型错误: {e}"))
}
