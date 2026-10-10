//! 应用内更新：版本清单抓取（Gitee Releases）+ APK 下载（应用内进度条）+ 安装（JNI 调 UpdaterHelper）。
//! 注：JNI 相关工具函数在下方通过完整路径 `crate::notification::*` 调用，
//! 不在文件顶部 use，避免在桌面/非 Android 目标下产生未使用导入警告。

use futures_util::StreamExt;
use std::time::Duration;
use tauri::{Emitter, Manager};
use tokio::io::AsyncWriteExt;

/// 与本地代理一致的桌面版 UA。
const DESKTOP_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

/// APK 下载进度事件名（前端 `listen('update-progress')` 订阅）。
pub const EVENT_PROGRESS: &str = "update-progress";

/// 抓取任意 URL 的文本正文（用于免登录获取 Releases/latest 等公开 API，绕开 WebView CORS）。
/// 非 2xx 时返回带状态码的错误信息（前端可据此区分 404 更新源不存在 / 网络问题）。
#[tauri::command]
pub async fn fetch_text(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent(DESKTOP_UA)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;
    let resp = client
        .get(&url)
        .header("Accept", "application/json, text/plain, */*")
        .send()
        .await
        .map_err(|e| format!("请求失败: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("读取响应失败: {e}"))?;
    if !status.is_success() {
        // HTTP 404：更新源仓库/版本不存在（如仓库未创建或从未发布过 Release）
        if status.as_u16() == 404 {
            return Err("HTTP 404".to_string());
        }
        return Err(format!("HTTP {status}"));
    }
    Ok(text)
}

/// 启动 APK 下载（系统 DownloadManager，通知栏进度），完成后自动拉起安装器。
#[tauri::command]
pub async fn start_apk_download(url: String, name: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        crate::notification::with_attached_env(|env| {
            let helper = crate::notification::local_class_from_global(env, crate::login::updater_helper_class()?)?;
            let j_url = env.new_string(&url).map_err(|e| format!("创建字符串失败: {e}"))?;
            let j_name = env.new_string(&name).map_err(|e| format!("创建字符串失败: {e}"))?;
            env.call_static_method(
                &helper,
                "startApkDownload",
                "(Ljava/lang/String;Ljava/lang/String;)V",
                &[
                    jni::objects::JValue::Object(&j_url),
                    jni::objects::JValue::Object(&j_name),
                ],
            )
            .map_err(|e| format!("启动下载失败: {e}"))?;
            Ok(())
        })?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (url, name);
    }
    Ok(())
}

/// 跳转"允许安装未知应用"系统设置页。
#[tauri::command]
pub async fn open_unknown_source_settings() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        crate::notification::with_attached_env(|env| {
            let helper = crate::notification::local_class_from_global(env, crate::login::updater_helper_class()?)?;
            env.call_static_method(&helper, "openUnknownSourceSettings", "()V", &[])
                .map_err(|e| format!("打开设置失败: {e}"))?;
            Ok(())
        })?;
    }
    Ok(())
}

/// 下载进度负载（通过 `update-progress` 事件推送给前端）。
#[derive(Clone, serde::Serialize)]
pub struct ApkProgress {
    /// 已下载字节数
    pub downloaded: u64,
    /// 总字节数（服务端未返回 Content-Length 时为 0）
    pub total: u64,
    /// 百分比 0~100（total 为 0 时恒为 0，前端按"已下载 x MB"展示）
    pub percent: f64,
    /// 是否下载完成
    pub done: bool,
    /// 完成时的文件绝对路径
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// 失败原因（当前失败通过命令返回值传递，保留字段用于后续扩展）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn percent_of(downloaded: u64, total: u64) -> f64 {
    if total == 0 {
        0.0
    } else {
        (downloaded as f64) * 100.0 / (total as f64)
    }
}

/// 应用内下载更新 APK 到缓存目录 `cache/updates/`（FileProvider 已覆盖 cache-path），
/// 过程中通过 `update-progress` 事件推送进度，完成后返回文件绝对路径。
/// 用应用内下载替代系统 DownloadManager：可在更新弹窗内展示真实进度条。
#[tauri::command]
pub async fn download_apk(
    app: tauri::AppHandle,
    url: String,
    name: String,
) -> Result<String, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("获取缓存目录失败: {e}"))?
        .join("updates");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建缓存目录失败: {e}"))?;
    let file_name = if name.to_lowercase().ends_with(".apk") {
        name.clone()
    } else {
        format!("{name}.apk")
    };
    let dest = dir.join(&file_name);
    let _ = std::fs::remove_file(&dest);

    let client = reqwest::Client::builder()
        .user_agent(DESKTOP_UA)
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("下载请求失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("下载失败: HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut file = tokio::fs::File::create(&dest)
        .await
        .map_err(|e| format!("创建文件失败: {e}"))?;
    let mut downloaded: u64 = 0;
    let mut last_emit: u64 = 0;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                let _ = file.flush().await;
                let _ = std::fs::remove_file(&dest);
                return Err(format!("下载中断: {e}"));
            }
        };
        if let Err(e) = file.write_all(&chunk).await {
            let _ = std::fs::remove_file(&dest);
            return Err(format!("写入文件失败: {e}"));
        }
        downloaded += chunk.len() as u64;
        // 节流：每 256KB 推送一次，避免高频 IPC 影响 WebView
        if downloaded - last_emit >= 256 * 1024 || (total > 0 && downloaded >= total) {
            last_emit = downloaded;
            let _ = app.emit(
                EVENT_PROGRESS,
                ApkProgress {
                    downloaded,
                    total,
                    percent: percent_of(downloaded, total),
                    done: false,
                    path: None,
                    error: None,
                },
            );
        }
    }
    file.flush().await.map_err(|e| format!("写入文件失败: {e}"))?;
    drop(file);
    // 服务端/代理异常断开导致"已收到的字节数 < Content-Length"时，循环会正常退出且不报错；
    // 若不加校验，半个 APK 会被当成完整更新交给安装器。
    if downloaded == 0 || (total > 0 && downloaded != total) {
        let _ = std::fs::remove_file(&dest);
        return Err(if downloaded == 0 {
            "下载内容为空，请稍后重试".to_string()
        } else {
            format!("下载不完整（已下载 {downloaded}/{total} 字节），请检查网络后重试")
        });
    }
    let path = dest.to_string_lossy().to_string();
    let _ = app.emit(
        EVENT_PROGRESS,
        ApkProgress {
            downloaded,
            total: if total > 0 { total } else { downloaded },
            percent: 100.0,
            done: true,
            path: Some(path.clone()),
            error: None,
        },
    );
    Ok(path)
}

/// 判断此前下载的安装包是否仍然存在（缓存可能被系统清理）。
#[tauri::command]
pub async fn apk_downloaded(path: String) -> bool {
    matches!(std::fs::metadata(&path), Ok(m) if m.is_file() && m.len() > 0)
}

/// 直接安装已下载的 APK（不再重新下载）。未授予"安装未知应用"权限时由原生层跳转设置页。
#[tauri::command]
pub async fn install_apk(path: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        crate::notification::with_attached_env(|env| {
            let helper = crate::notification::local_class_from_global(env, crate::login::updater_helper_class()?)?;
            let j_path = env
                .new_string(&path)
                .map_err(|e| format!("创建字符串失败: {e}"))?;
            env.call_static_method(
                &helper,
                "installApkFromPath",
                "(Ljava/lang/String;)V",
                &[jni::objects::JValue::Object(&j_path)],
            )
            .map_err(|e| format!("调起安装失败: {e}"))?;
            Ok(())
        })?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = path;
        Err("当前平台不支持应用内安装".to_string())
    }
}
