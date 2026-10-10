//! 前端热更新：小功能 / bug 修复免装 APK。
//!
//! 流程：清单(manifest.json) → 逐文件下载到 `app_data/hotupdate/{version}/` → 写 CURRENT →
//! 前端写启动标记并刷新 → 内置引导脚本（index.html）通过 `hotres://` 自定义协议加载新资源。
//!
//! 版本规则：热更版本必须以当前应用版本为前缀（app 1.3.6 → 热更 1.3.6.1 / 1.3.6.2）；
//! APK 升级后旧热更自动失配（available=false + incompatible=true），引导脚本回退内置资源。
//!
//! 清单格式（前端把 URL 传给命令，托管地址可随时更换）：
//! ```json
//! { "version": "1.3.6.1", "notes": "修复xxx",
//!   "files": [ { "path": "assets/index-xxx.js", "url": "https://.../index-xxx.js" }, ... ] }
//! ```

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Manager;

const DESKTOP_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

/// 单文件大小上限（整包前端资源约 3.5MB，留足余量）
const MAX_FILE_BYTES: usize = 32 * 1024 * 1024;
/// 文件数上限
const MAX_FILES: usize = 200;

#[derive(Deserialize)]
struct HotManifest {
    version: String,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    files: Vec<HotFile>,
}

#[derive(Deserialize)]
struct HotFile {
    path: String,
    url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotCheckInfo {
    pub available: bool,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub current_hot: Option<String>,
    pub current_app: String,
    /// true = 热更版本与当前应用版本不匹配（APK 已升级，旧热更作废）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub incompatible: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotApplyInfo {
    pub version: String,
    pub entry_js: String,
    pub entry_css: Option<String>,
}

fn hotupdate_root<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?
        .join("hotupdate"))
}

fn read_current_hot<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<String> {
    let root = hotupdate_root(app).ok()?;
    std::fs::read_to_string(root.join("CURRENT"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// 热更版本是否适用于当前应用版本（app 1.3.6 → 热更 1.3.6.x / 1.3.6）
fn version_compatible(app_version: &str, hot_version: &str) -> bool {
    hot_version == app_version || hot_version.starts_with(&format!("{app_version}."))
}

async fn fetch_manifest(manifest_url: &str) -> Result<HotManifest, String> {
    let client = reqwest::Client::builder()
        .user_agent(DESKTOP_UA)
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;
    let resp = client
        .get(manifest_url)
        .header("Accept", "application/json, text/plain, */*")
        .send()
        .await
        .map_err(|e| format!("请求清单失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("获取热更清单失败: HTTP {}", resp.status()));
    }
    let text = resp.text().await.map_err(|e| format!("读取清单失败: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("清单格式错误: {e}"))
}

/// 检查热更新是否可用。
#[tauri::command]
pub async fn hot_check(
    app: tauri::AppHandle,
    manifest_url: String,
) -> Result<HotCheckInfo, String> {
    let current_app = app.package_info().version.to_string();
    let current_hot = read_current_hot(&app);
    let manifest = match fetch_manifest(&manifest_url).await {
        Ok(m) => m,
        Err(e) => {
            return Ok(HotCheckInfo {
                available: false,
                version: None,
                notes: None,
                current_hot,
                current_app,
                incompatible: None,
                error: Some(e),
            })
        }
    };
    if !version_compatible(&current_app, &manifest.version) {
        return Ok(HotCheckInfo {
            available: false,
            version: Some(manifest.version),
            notes: Some(manifest.notes),
            current_hot,
            current_app,
            incompatible: Some(true),
            error: None,
        });
    }
    let available = current_hot.as_deref() != Some(manifest.version.as_str());
    Ok(HotCheckInfo {
        available,
        version: Some(manifest.version),
        notes: Some(manifest.notes),
        current_hot,
        current_app,
        incompatible: None,
        error: None,
    })
}

/// 清洗相对路径：仅允许 `a/b/c` 形式的包内相对路径，防目录穿越。
fn sanitize_rel_path(raw: &str) -> Result<String, String> {
    let norm = raw.replace('\\', "/");
    let norm = norm.trim_start_matches('/');
    if norm.is_empty() || norm.split('/').any(|seg| seg == ".." || seg.is_empty()) {
        return Err(format!("非法的文件路径: {raw}"));
    }
    Ok(norm.to_string())
}

async fn download_to(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
) -> Result<u64, String> {
    let resp = client
        .get(url)
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("下载 {url} 失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("下载 {url} 失败: HTTP {}", resp.status()));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取 {url} 失败: {e}"))?;
    if bytes.is_empty() {
        return Err(format!("下载 {url} 内容为空"));
    }
    if bytes.len() > MAX_FILE_BYTES {
        return Err(format!("{url} 超过单文件大小上限"));
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    std::fs::write(dest, &bytes).map_err(|e| format!("写入 {} 失败: {e}", dest.display()))?;
    Ok(bytes.len() as u64)
}

/// 从 index.html 提取打包入口（module script + stylesheet）。
fn parse_entry(index_html: &str) -> Result<(String, Option<String>), String> {
    let script_re = regex::Regex::new(r#"<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"[^>]*>"#)
        .map_err(|e| e.to_string())?;
    let script_re2 = regex::Regex::new(r#"<script\b[^>]*\bsrc="([^"]+\.js)"[^>]*\btype="module"[^>]*>"#)
        .map_err(|e| e.to_string())?;
    let css_re = regex::Regex::new(r#"<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>"#)
        .map_err(|e| e.to_string())?;
    let caps = script_re
        .captures(index_html)
        .or_else(|| script_re2.captures(index_html));
    let entry_js = caps
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim_start_matches('/').to_string())
        .ok_or("index.html 中未找到 module 入口脚本")?;
    let entry_css = css_re
        .captures(index_html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim_start_matches('/').to_string());
    Ok((entry_js, entry_css))
}

/// 应用热更新：下载清单中全部文件（先写临时目录，全部成功后整体生效）。
#[tauri::command]
pub async fn hot_apply(app: tauri::AppHandle, manifest_url: String) -> Result<HotApplyInfo, String> {
    let manifest = fetch_manifest(&manifest_url).await?;
    let current_app = app.package_info().version.to_string();
    if !version_compatible(&current_app, &manifest.version) {
        return Err(format!(
            "热更版本 {} 与应用版本 {} 不匹配，请先升级 APK",
            manifest.version, current_app
        ));
    }
    if manifest.files.is_empty() {
        return Err("清单中没有文件".to_string());
    }
    if manifest.files.len() > MAX_FILES {
        return Err(format!("清单文件数超过上限 {MAX_FILES}"));
    }
    let root = hotupdate_root(&app)?;
    let staging = root.join(".staging").join(&manifest.version);
    let final_dir = root.join(&manifest.version);
    if staging.exists() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    std::fs::create_dir_all(&staging).map_err(|e| format!("创建目录失败: {e}"))?;

    let client = reqwest::Client::builder()
        .user_agent(DESKTOP_UA)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;
    // 任一文件下载/校验失败：清掉临时目录再返回，不留半包
    let parsed = match download_and_parse(&client, &manifest, &staging).await {
        Ok(v) => v,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(e);
        }
    };
    // 整体生效：同一版本重装先删旧目录
    if final_dir.exists() {
        let _ = std::fs::remove_dir_all(&final_dir);
    }
    if let Err(e) = std::fs::rename(&staging, &final_dir) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(format!("生效热更失败: {e}"));
    }
    std::fs::create_dir_all(&root).map_err(|e| format!("创建目录失败: {e}"))?;
    std::fs::write(root.join("CURRENT"), &manifest.version)
        .map_err(|e| format!("写入版本标记失败: {e}"))?;
    cleanup_old_versions(&root, &manifest.version);
    Ok(HotApplyInfo {
        version: manifest.version,
        entry_js: parsed.0,
        entry_css: parsed.1,
    })
}

/// 下载清单中全部文件到 `staging` 并解析 index.html 入口。
async fn download_and_parse(
    client: &reqwest::Client,
    manifest: &HotManifest,
    staging: &Path,
) -> Result<(String, Option<String>), String> {
    let mut index_html: Option<String> = None;
    for file in &manifest.files {
        let rel = sanitize_rel_path(&file.path)?;
        let dest = staging.join(&rel);
        download_to(client, &file.url, &dest).await?;
        if rel == "index.html" {
            index_html = std::fs::read_to_string(&dest).ok();
        }
    }
    let index_html = index_html.ok_or("热更包缺少 index.html")?;
    let (entry_js, entry_css) = parse_entry(&index_html)?;
    // 校验入口文件确实下载成功
    if !staging.join(&entry_js).is_file() {
        return Err(format!("入口文件缺失: {entry_js}"));
    }
    if let Some(css) = &entry_css {
        if !staging.join(css).is_file() {
            return Err(format!("样式文件缺失: {css}"));
        }
    }
    Ok((entry_js, entry_css))
}

/// 删除除当前版本外的旧热更目录，控制磁盘占用。
fn cleanup_old_versions(root: &Path, keep: &str) {
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name == "CURRENT" || name == ".staging" || name == keep {
                continue;
            }
            if entry.path().is_dir() {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }
}

/// 回滚热更新：删除版本标记（文件保留无妨，下次安装会覆盖）。
#[tauri::command]
pub async fn hot_rollback(app: tauri::AppHandle) -> Result<(), String> {
    let root = hotupdate_root(&app)?;
    match std::fs::remove_file(root.join("CURRENT")) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("回滚失败: {e}")),
    }
}

// ---------- hotres 自定义协议：向前端 WebView 伺服热更文件 ----------

fn mime_of(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("js" | "mjs") => "text/javascript",
        Some("css") => "text/css",
        Some("html") => "text/html",
        Some("json") => "application/json",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("ico") => "image/x-icon",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("txt") => "text/plain",
        _ => "application/octet-stream",
    }
}

fn hotres_response(
    status: u16,
    mime: Option<&'static str>,
    body: Vec<u8>,
) -> tauri::http::Response<Vec<u8>> {
    let mut builder = tauri::http::Response::builder()
        .status(status)
        // 热更资源与应用主页面跨源（http://hotres.localhost），模块脚本/样式表需要 CORS 头
        .header("Access-Control-Allow-Origin", "*")
        .header("Cache-Control", "no-cache");
    if let Some(m) = mime {
        builder = builder.header("Content-Type", m);
    }
    builder.body(body).unwrap()
}

/// 处理 `hotres://` 请求。URL 路径是 encodeURIComponent 后的 hotupdate 内相对路径
/// （经 convertFileSrc 生成），如 `/1.3.6.1%2Fassets%2Findex-xxx.js`。
pub fn handle_hotres_request<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    use percent_encoding::percent_decode_str;

    let root = match hotupdate_root(app) {
        Ok(p) => p,
        Err(_) => return hotres_response(500, None, b"no data dir".to_vec()),
    };
    let raw = request.uri().path().trim_start_matches('/');
    let rel = match percent_decode_str(raw).decode_utf8() {
        Ok(s) => s.replace('\\', "/"),
        Err(_) => return hotres_response(400, None, b"bad path".to_vec()),
    };
    // 目录穿越防护：规范化后必须仍位于 hotupdate 根内
    let target = root.join(&rel);
    let Ok(canon_target) = target.canonicalize() else {
        return hotres_response(404, None, b"not found".to_vec());
    };
    let Ok(canon_root) = root.canonicalize() else {
        return hotres_response(404, None, b"not found".to_vec());
    };
    if !canon_target.starts_with(&canon_root) || !canon_target.is_file() {
        return hotres_response(404, None, b"not found".to_vec());
    }
    match std::fs::read(&canon_target) {
        Ok(data) => hotres_response(200, Some(mime_of(&canon_target)), data),
        Err(_) => hotres_response(500, None, b"read error".to_vec()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_parsing_vite_output() {
        let html = r#"<html><head><script type="module" crossorigin src="/assets/index-Uiq8gYuz.js"></script>
        <link rel="stylesheet" crossorigin href="/assets/index-BbEj_.css"></head><body></body></html>"#;
        let (js, css) = parse_entry(html).expect("应能解析 vite 构建产物入口");
        assert_eq!(js, "assets/index-Uiq8gYuz.js");
        assert_eq!(css.as_deref(), Some("assets/index-BbEj_.css"));
    }

    #[test]
    fn entry_parsing_attr_order_swapped() {
        let html = r#"<script src="/assets/a.js" type="module"></script>"#;
        let (js, css) = parse_entry(html).expect("属性顺序颠倒也应可解析");
        assert_eq!(js, "assets/a.js");
        assert_eq!(css, None);
    }

    #[test]
    fn entry_parsing_missing_returns_err() {
        assert!(parse_entry("<html><body>x</body></html>").is_err());
    }

    #[test]
    fn rel_path_sanitized() {
        assert_eq!(sanitize_rel_path("assets/index.js").unwrap(), "assets/index.js");
        assert_eq!(sanitize_rel_path("/assets/index.js").unwrap(), "assets/index.js");
        assert_eq!(sanitize_rel_path(r"assets\index.js").unwrap(), "assets/index.js");
        assert!(sanitize_rel_path("../secrets").is_err());
        assert!(sanitize_rel_path("a/../../b").is_err());
        assert!(sanitize_rel_path("").is_err());
    }

    #[test]
    fn version_compatibility_rule() {
        assert!(version_compatible("1.3.6", "1.3.6.1"));
        assert!(version_compatible("1.3.6", "1.3.6"));
        assert!(!version_compatible("1.3.7", "1.3.6.1"));
        assert!(!version_compatible("1.4.0", "1.3.6.2"));
    }
}
