//! 应用内更新：版本清单抓取（Gitee Releases）+ APK 下载安装（JNI 调 UpdaterHelper）。
//! 注：JNI 相关工具函数在下方通过完整路径 `crate::notification::*` 调用，
//! 不在文件顶部 use，避免在桌面/非 Android 目标下产生未使用导入警告。

/// 与本地代理一致的桌面版 UA。
const DESKTOP_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

/// 抓取任意 URL 的文本正文（用于免登录获取 Gitee releases/latest 等公开 API，绕开 WebView CORS）。
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
