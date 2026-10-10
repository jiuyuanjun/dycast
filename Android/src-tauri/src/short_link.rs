//! 短链接解析：v.douyin.com 短链 → 真实直播间房间号。
//!
//! 抖音分享短链的重定向链为：
//!   v.douyin.com/xxx → webcast.amemv.com/douyin/webcast/reflow/{roomIdStr}
//! reflow 页面 HTML 中带转义 JSON：`\"webRid\":\"21262171127\"`（真实房间号），
//! 桌面浏览器是靠页面 JS 再跳到 live.douyin.com/{webRid}，纯 HTTP 跟随拿不到，
//! 因此这里直接从 reflow 页面提取 webRid 并拼回 live.douyin.com 链接。

/// 与本地代理一致的桌面版 UA（抖音 a_bogus/签名与重定向解析都依赖它）。
const DESKTOP_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

/// 从页面文本中提取真实房间号（webRid 或 live.douyin.com 链接）。
/// 注意：reflow 页面中的 JSON 常以转义形式嵌入 JS（\"webRid\":\"123\"），需兼容转义引号。
fn extract_web_rid(text: &str) -> Option<String> {
    for pattern in [
        r#"live\.douyin\.com/(\d{8,20})"#,
        r#"\\?"webRid\\?"\s*:\s*\\?"(\d{8,20})\\?""#,
        r#"\\?"web_rid\\?"\s*:\s*\\?"(\d{8,20})\\?""#,
    ] {
        if let Ok(re) = regex::Regex::new(pattern) {
            if let Some(caps) = re.captures(text) {
                if let Some(m) = caps.get(1) {
                    return Some(m.as_str().to_string());
                }
            }
        }
    }
    None
}

/// 解析 v.douyin.com 短链接，返回可提取房间号的最终链接。
///  - 重定向直接落到 live.douyin.com/{roomId} 时原样返回；
///  - 落到 reflow 页面时解析 webRid 并拼回 live.douyin.com/{roomId}。
#[tauri::command]
pub async fn resolve_short_url(url: String) -> Result<Option<String>, String> {
    let client = reqwest::Client::builder()
        .user_agent(DESKTOP_UA)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;
    let resp = client
        .get(&url)
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "zh-CN,zh;q=0.9")
        .send()
        .await
        .map_err(|e| format!("短链接解析失败: {e}"))?;
    let final_url = resp.url().to_string();

    // 直接落到直播间链接
    if final_url.contains("live.douyin.com/") {
        return Ok(Some(final_url));
    }

    // reflow 页面：从 HTML 中提取 webRid
    let body = resp.text().await.unwrap_or_default();
    if let Some(rid) = extract_web_rid(&body) {
        return Ok(Some(format!("https://live.douyin.com/{rid}")));
    }
    Ok(Some(final_url))
}
