//! Android-specific commands for foreground service keep-alive and local notifications.

#[cfg(target_os = "android")]
use crate::login::{
    JVM, foreground_service_class, main_activity_class, notification_helper_class,
    power_utils_class,
};

#[cfg(target_os = "android")]
pub(crate) fn with_attached_env<F, T>(f: F) -> Result<T, String>
where
    F: FnOnce(&mut jni::JNIEnv<'_>) -> Result<T, String>,
{
    let vm = JVM.get().ok_or("JavaVM 未初始化")?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("附加线程失败: {e}"))?;
    f(&mut env)
}

#[cfg(target_os = "android")]
pub(crate) fn local_class_from_global<'a>(
    env: &mut jni::JNIEnv<'a>,
    global: &'static jni::objects::GlobalRef,
) -> Result<jni::objects::JClass<'a>, String> {
    let local = env
        .new_local_ref(global.as_obj())
        .map_err(|e| format!("创建本地引用失败: {e}"))?;
    Ok(jni::objects::JClass::from(local))
}

/// Start the Android foreground service that keeps the process alive in the background.
#[tauri::command]
pub async fn start_foreground_service() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        with_attached_env(|env| {
            let activity_class = local_class_from_global(env, main_activity_class()?)?;
            env.call_static_method(&activity_class, "startForegroundService", "()V", &[])
                .map_err(|e| format!("启动前台服务失败: {e}"))?;
            Ok(())
        })?;
    }
    Ok(())
}

/// Stop the Android foreground service.
#[tauri::command]
pub async fn stop_foreground_service() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        with_attached_env(|env| {
            let activity_class = local_class_from_global(env, main_activity_class()?)?;
            env.call_static_method(&activity_class, "stopForegroundService", "()V", &[])
                .map_err(|e| format!("停止前台服务失败: {e}"))?;
            Ok(())
        })?;
    }
    Ok(())
}

/// Whether the keep-alive foreground service is currently running.
#[tauri::command]
pub async fn is_foreground_service_running() -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        return with_attached_env(|env| {
            let service_class = local_class_from_global(env, foreground_service_class()?)?;
            let result = env
                .call_static_method(&service_class, "isRunning", "()Z", &[])
                .map_err(|e| format!("检查前台服务状态失败: {e}"))?;
            result.z().map_err(|e| format!("返回类型错误: {e}"))
        });
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(false)
    }
}

/// Post a local notification on Android.
/// `payload` is a JSON string with fields: category, title, body, group(optional), id(optional).
#[tauri::command]
pub async fn post_notification(payload: String) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        return with_attached_env(|env| {
            let helper = local_class_from_global(env, notification_helper_class()?)?;
            let j_payload = env
                .new_string(&payload)
                .map_err(|e| format!("创建字符串失败: {e}"))?;
            let result = env
                .call_static_method(
                    &helper,
                    "postNotification",
                    "(Ljava/lang/String;)Z",
                    &[jni::objects::JValue::Object(&j_payload)],
                )
                .map_err(|e| format!("发送通知失败: {e}"))?;
            result.z().map_err(|e| format!("返回类型错误: {e}"))
        });
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = payload;
        Ok(false)
    }
}

/// Clear DyCast message notifications from the Android notification shade.
/// Invoked by the frontend on the "自动清理消息" interval so the shade never overflows.
#[tauri::command]
pub async fn clear_notifications() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        with_attached_env(|env| {
            let helper = local_class_from_global(env, notification_helper_class()?)?;
            env.call_static_method(&helper, "clearAllNotifications", "()V", &[])
                .map_err(|e| format!("清空通知失败: {e}"))?;
            Ok(())
        })?;
    }
    Ok(())
}

/// Remove DyCast message notifications older than `max_age_seconds`.
///
/// Frontend calls this on the "消息保留时长" interval so the shade self-cleans **by age**
/// instead of being wiped all at once (which used to delete freshly arrived messages too).
#[tauri::command]
pub async fn clear_expired_notifications(max_age_seconds: i64) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        with_attached_env(|env| {
            let helper = local_class_from_global(env, notification_helper_class()?)?;
            env.call_static_method(
                &helper,
                "clearExpired",
                "(J)V",
                &[jni::objects::JValue::Long(max_age_seconds)],
            )
            .map_err(|e| format!("清理超时通知失败: {e}"))?;
            Ok(())
        })?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = max_age_seconds;
    }
    Ok(())
}

/// Open the Android system settings to add the app to the battery whitelist.
#[tauri::command]
pub async fn request_battery_optimization_whitelist() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        with_attached_env(|env| {
            let utils = local_class_from_global(env, power_utils_class()?)?;
            env.call_static_method(
                &utils,
                "requestIgnoreBatteryOptimizations",
                "()V",
                &[],
            )
            .map_err(|e| format!("请求忽略电池优化失败: {e}"))?;
            Ok(())
        })?;
    }
    Ok(())
}

/// Open the manufacturer-specific auto-start / background settings page.
#[tauri::command]
pub async fn request_autostart_settings() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        with_attached_env(|env| {
            let utils = local_class_from_global(env, power_utils_class()?)?;
            env.call_static_method(&utils, "requestAutoStart", "()V", &[])
                .map_err(|e| format!("请求自启动设置失败: {e}"))?;
            Ok(())
        })?;
    }
    Ok(())
}

/// Show a dialog guiding the user through keep-alive settings.
#[tauri::command]
pub async fn show_keep_alive_guide() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        with_attached_env(|env| {
            let utils = local_class_from_global(env, power_utils_class()?)?;
            env.call_static_method(&utils, "showKeepAliveGuide", "()V", &[])
                .map_err(|e| format!("显示后台保活引导失败: {e}"))?;
            Ok(())
        })?;
    }
    Ok(())
}

/// Check whether the app is currently in the foreground.
#[tauri::command]
pub async fn is_app_foreground() -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        return with_attached_env(|env| {
            let utils = local_class_from_global(env, power_utils_class()?)?;
            let result = env
                .call_static_method(&utils, "isAppForeground", "()Z", &[])
                .map_err(|e| format!("检查应用前台状态失败: {e}"))?;
            result.z().map_err(|e| format!("返回类型错误: {e}"))
        });
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(true)
    }
}

/// Check whether the app is ignoring battery optimizations.
#[tauri::command]
pub async fn is_ignoring_battery_optimizations() -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        return with_attached_env(|env| {
            let utils = local_class_from_global(env, power_utils_class()?)?;
            let result = env
                .call_static_method(&utils, "isIgnoringBatteryOptimizations", "()Z", &[])
                .map_err(|e| format!("检查电池优化白名单状态失败: {e}"))?;
            result.z().map_err(|e| format!("返回类型错误: {e}"))
        });
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(false)
    }
}

/// 前端在 `updateSettings` 后同步调用：把通知设置镜像到原生侧
/// （内存 + SharedPreferences），供后台时 `notify_backend` 独立判定发送。
#[tauri::command]
pub async fn sync_native_settings(settings_json: String) -> Result<(), String> {
    crate::notify_backend::set_settings(&settings_json);
    #[cfg(target_os = "android")]
    {
        with_attached_env(|env| {
            let store = local_class_from_global(env, crate::login::settings_store_class()?)?;
            let j = env
                .new_string(&settings_json)
                .map_err(|e| format!("创建字符串失败: {e}"))?;
            env.call_static_method(
                &store,
                "saveSettings",
                "(Ljava/lang/String;)V",
                &[jni::objects::JValue::Object(&j)],
            )
            .map_err(|e| format!("保存镜像设置失败: {e}"))?;
            let helper = local_class_from_global(env, crate::login::notification_helper_class()?)?;
            env.call_static_method(
                &helper,
                "configureCleanupSettings",
                "(Ljava/lang/String;)V",
                &[jni::objects::JValue::Object(&j)],
            )
            .map_err(|e| format!("同步清理设置失败: {e}"))?;
            Ok(())
        })?;
    }
    Ok(())
}
