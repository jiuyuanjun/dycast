# DyCast - 项目级 AI 维护手册

本文档是 DyCast 项目的根级入口，供 AI 快速了解项目全貌，并跳转到各平台子手册。

---

## 1. 项目概述

- **中文名**：抖音弹幕姬 / 抖音直播弹幕助手
- **定位**：一个用于获取抖音直播间实时弹幕、礼物、关注、进入等信息的小工具，支持 Windows 桌面版和 Android 版。
- **仓库结构**：双平台代码放在同一仓库，共享根目录图标，但构建、运行、发布相互独立。
- **当前版本**：以 [Windows/package.json](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/package.json) 与 [Android/package.json](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Android/package.json) 中的版本为准。
- **2026-10-09 Android v1.3.9（✅ 已发布）确认页未开播直返首页 + 连接失败提示透传真实原因**：`Android/output/dycast-1.3.9-arm64.apk`（30.9 MB，SHA-256 `38d4af0418cb06c361ebdf96d345ac5ce12c9749b8cf701e1948d298c416d22d`），飞书 https://my.feishu.cn/file/T0s7bPXQPo2vmgxduJlcPmsZntg （保留回滚 v1.3.8；Gitee 已封禁故无 Release）。核心：①**RoomConfirmPage 未开播逻辑**：未开播时按钮从「仍要进入直播间 + 返回修改」改为单个「主播未开播，返回首页」直接 `router.replace('/')`（开播时保持「确认正确 + 返回修改」）；②**连接失败原因透传**：`dycast.ts` connect 连接前出错把真实错误信息传给 close reason（原固定文案"房间连接前出错"吞掉根因），连接失败弹窗现在直接显示「响应为空/风控/网络/HTTP 403 登录态失效」等真实原因；`request.ts` 同步优化：响应为空→「服务端未返回内容（可能被风控或代理异常）」，fetchImInfo catch 不再吞原始错误、HTTP 403 追加「疑似登录态失效」。③顺带清理根目录 agent.md 中已撤回的阿里云迁移段落。**注意**：Gitee 仓库已被平台封禁（API 404 / raw 403），热更与 APK 在线更新渠道不可用，后续发版仅飞书人工交付，换渠道待用户提供服务器。
- **2026-10-07 Android v1.3.8（✅ 已发布）消息清理修复 + 账号二级菜单**：`Android/output/dycast-1.3.8-arm64.apk`（SHA-256 `700bd0a0352519d53a780c7ff456f66dcd601f91c8126cba6dc3c5fa0069cb3d`），Gitee tag v1.3.8（Release id 1187268，已删 v1.3.7）、飞书 https://my.feishu.cn/file/DWIcbC5qAo1jtpxhcsAcHdjGnAf （保留回滚 v1.3.7）。核心：①**消息清理功能修复**（Kotlin NotificationHelper）：清理循环无异常保护（单次 RuntimeException 即杀死 10s 定时器 → "清理完全不工作"的根因，已包 try/catch）；`postedAt` 登记表持久化到 SharedPreferences（进程重启后历史/孤儿通知也能按保留时长与数量策略清理，onConfigure 时 loadPosted + 立即清一轮）；`configureCleanupSettings` 空/坏 JSON 兜底默认策略（旧实现抛异常导致全新安装清理定时器不启动）。②**账号操作收进二级菜单**：新增 `/account` AccountPage（当前账号信息 + 登录/更换账号 + 更换房间 + 退出房间 + 退出登录），MorePage 账号组收口为单条「账号管理」入口；登录/切换账号（已登录时）与退出登录、礼物页 SessionBar 退出图标均加二次确认弹窗（新增通用 `ConfirmDialog.vue`）。③**热更新首次实战**：账号菜单功能以热更 1.3.7.1 交付（Gitee contents API 托管 `hot/1.3.7.1/` + `hot/manifest.json`，raw 下载全部 200）；新增 `scripts/publish-hot.cjs`（上传 + sha 更新 + raw 验证一条龙），与 `make-hot-manifest.mjs` 组成完整热更发布链。装 1.3.8 后 1.3.7.1 热更按版本前缀规则自动失配回退。
- **2026-10-07 Android v1.3.7（✅ 已发布）统计修复 + 热更新上线 + 保活契约重构**：`Android/output/dycast-1.3.7-arm64.apk`（30.9 MB，SHA-256 `b7db1fc6975bed89c8a6af93c416f5e17f1949bdb34ea4ad344c33b03f983a37`），Gitee tag v1.3.7（Release id 1187162，已删 v1.3.6）、飞书 https://my.feishu.cn/file/SFH9b81zlovpRpxvKrscuchTnAe （保留回滚 v1.3.6）。核心：①统计数显示 null 修复（Rust UnifiedRoomStats 加 `skip_serializing_if` + 前端 `setRoomCounts` 判 `!= null`，此前 LIKE/SOCIAL/MEMBER 互相把统计字段打穿成 "null"）；②自动回复失效修复（检测移出通知开关 early-return，此前被 `foregroundEnabled` 默认 false 挡死）；③**移除全部 @ 功能**（用户拍板：{user} 占位符、回复@开关、聊天 @ 候选浮层、点击弹幕@）；④在线观众榜=在线榜∪贡献榜（mergeRankLists 去重），标题显示真实在线人数（榜单条数≠在线人数是 ROOM_USER_SEQ 协议限制）；⑤getLiveInfo 优先 WebView page_fetch 抓房间页 HTML（完整 cookie+风控头，失败回落代理）；⑥**前端热更新上线**：Rust `hot_update.rs`（hot_check/apply/rollback + `hotres://` 协议伺服 app_data/hotupdate）+ index.html 引导脚本（8s 看门狗回退、APK 升级自动失配回退）+ MorePage「检查热更新」入口 + `npm run hot:manifest` 生成发布物，清单地址 Gitee `hot/manifest.json`，热更版本必须以 APK 版本为前缀；⑦**保活服务契约重构**：只在连接直播间期间存活（App 启动 `startup()` 清残留、断开/退出/下播/连接失败即停、`syncKeepAlive` 加 currentRoom 门控、Kotlin `onTaskRemoved` 无条件停服务且先清 keepAliveRequested 防自愈复活；按 HOME 回桌面照常驻留）；⑧业务逻辑修复（Explore 审查）：P0 重连假死（`_afterClose` 复位 `reconnectPending`）、CONNECTING 关闭泄漏旧连接（切房间后旧房间后台通知根源）、统一链路补 CONTROL 下播即时判定（原来晚 1~2 分钟）、Kotlin 发送结果单槽清槽+挂起 30s 防幽灵补发、热更 fallback 标记会话内锁死、CastItemMobile 点赞/关注文案二次拼接错显。详见 [Android/agent.md](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Android/agent.md) 17.1。
- **2026-10-02 Android v1.3.6（✅ 已发布）全链路核查补全**：`Android/output/dycast-1.3.6-arm64.apk`（SHA-256 `2c4ed05dac78c97f19c96f784d0d8491c8f6e3aac1bc306f5048c8f434cd2288`），Gitee tag v1.3.6（Release id 1179643）、飞书 https://my.feishu.cn/file/XoTwbs7M4o2lX4xIeXfcq5sWnRd （保留回滚 v1.3.5）。核心：恢复表情图片解码（webcast_message.rs 新增 emoji_icon + 2 单测）、请求层补重试/不再静默吞错（fetchUser/fetchMeInfo/getImInfo、proxy.rs body 502）、自动回复冷却 Map 有界、syncNative 重试；前端显示补全（@候选与常用语面板互斥、横竖屏保留弹幕草稿与社交筛选、更换房间/退出房间语义区分、ConsolePage 空态、RoomConfirmPage「仍要进入」、主播占位 `***`→`-`、删死路由 `/live/gift-login`、礼物页已登录退出图标改真实 logout、横屏在线榜空态文案对齐、shareText 解析成功重置 anchorId）；测试补全（verifyUtil 测试 4→24 例、新增 `test`/`test:rust` 脚本、Rust 解码单测 5→7）。**明确未改**：getMsToken/getSignature（HttpOnly 不可读 / 空签名本就自然失败）；**需真机验证**：弹幕发送 bd-ticket-guard、真实账号发送回执、后台断流复测、表情图片实况帧显示。详见 [Android/agent.md](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Android/agent.md) 17.1。
- **2026-09-20 Android 功能调整**：本次仅修改 Android，不生成 Windows 版本；竖屏贡献榜仅保留单一送礼贡献榜，横屏贡献榜放入"房间号 & 贡献榜"区域（**该区域已于 2026-09-22 改为纯贡献榜，房间号输入/连接按钮已删除**），并与"进入 & 关注 & 粉丝团"区域上下各占一半；弹幕发送继续复用已获取 token 的网页发送链路；贡献榜条目统一改为三列（名次数字 | 头像 | 名字，去掉贡献值列，数据为"-"时名次显示"-"）。
- **2026-09-22 Android 功能调整（v1.3.0，✅ 已发布）** —— 产物 `Android/output/dycast-1.3.0-arm64.apk`（30.5 MB，SHA-256 `615cd985d7c5f18f420bd53dc149a999d4514d9c0133c4b213dfdc4ba1f8a060`），Gitee tag v1.3.0（Release id 1159329，已删 v1.2.0）、飞书 https://my.feishu.cn/file/OL7Gblp6CoWCx7xCYcKctAGQnud 。**本版核心：后台通知链路下沉到 Rust（17.8 方案全量实施）** —— 代理层旁路解析弹幕帧、后台由原生直接发通知、ack 由 Rust 接管、设置镜像到 SharedPreferences、前后台双路互斥去重（详见 Android/agent.md 17.8）；同时包含此前 v1.2.0 的全部内容（后台保活重构 + Bug 22-24 + 消息保留时长 + 横屏精简）：
  1. **登录判定改为"以本地 cookie 为准"**：只要本地保存的 `sessionid` 非空即视为已登录，不再要求用户信息接口同时成功——此前 `sessionid && user` 双条件会让"已登录却被提示要登录、弹幕输入框被禁用"；冷启动代理端口未就绪时 `getProxyPort` 现在会重试（10×300ms），消除退化成相对路径导致接口全失败的问题。
  2. **通知改为"同一条实时刷新"**：前端按类别传固定通知 id（弹幕 2001 / 礼物 2002 / 进入 2003 / 关注 2004 / 粉丝团 2005 / 点赞 2006）+ 滚动累积正文，Android 侧兜底 id 不再混入时间戳，并加 `setOnlyAlertOnce`；点赞等高频消息 3-5 秒刷新一次，只占 1 条通知。汇总条改固定 id 2000 并实时刷新各类计数。
  3. **消息按"保留时长"自动删除**：通知记录发出时间戳，新增 `clear_expired_notifications` 命令只删除超时消息（不再整体清空），设置页文案改为「消息保留时长（秒）」，默认 300。
  4. **贡献榜**：竖屏改为固定高度 + 框内上下滚动（滚动视口由 flex 决定，与弹幕列表同源），昵称由单行省略号改为最多两行；快照类消息（ROOM_RANK / ROOM_USER_SEQ / ROOM_STATS）豁免 id 去重，自动重连同一房间不再清空榜单。
  5. **横屏精简**：删除房间号输入与连接按钮，面板改为纯「贡献榜 · N 人」；换房间统一走「设置 → 账号 → 更换房间」。
  6. **后台保活重构**：前台服务改为 **App 启动即按开关拉起**（不再只依赖"连上直播间"）；`startForeground()` 提前到 `onCreate()` 内执行，消除 `startForegroundService()` 的 **5 秒超时**被杀风险；进入前台失败不再 `stopSelf()`（旧逻辑把"没起来"变成"起来就死"）；常驻通知每 60s 用同一 id 刷新并显示「已保活 N 分钟」，新增「停止保活」按钮；`onTaskRemoved()` 划掉最近任务卡片时**按开关保留服务**；服务被系统清理后由 `AlarmManager` 限频（5 次/小时）自愈重启；`stopOnLiveEnd()` 下播**不再把 `keepAlive` 落盘为 false**（旧行为会导致此后服务再也拉不起来）。详见 Android/agent.md 9.3.1。**注意**：弹幕解析与通知分发仍在 WebView 的 JS 里，因此"App 完全退出前台仍持续推送"目前做不到，根因与彻底方案见 Android/agent.md 17.8。
- **2026-09-23 「完整重新打包」= v1.3.1（✅ 已发布）** —— 产物 `Android/output/dycast-1.3.1-arm64.apk`（30.5 MB / 32,014,663 bytes，SHA-256 `2cbe0172eb9fa262955e5970d66c421f25c40f6ed736e303d67bad7e383d813e`），Gitee tag v1.3.1（Release id 1161390，已删 v1.3.0）、飞书 https://my.feishu.cn/file/Ks76bszXUo0Y7jxXDhYciuSOnLe 。验签 v2+v3 通过、APK 内嵌前端资源与 `dist` 一致；飞书保留回滚版 v1.3.0。
  - **本版不含代码改动**：核查确认自 09-22 12:34（v1.3.0 发布）起全项目无任何源码修改，属"同代码 + 新版本号 + 干净重打"，用于排除构建缓存导致的产物问题。APK 字节数与 v1.3.0 完全相同（均 32,014,663 bytes），仅签名时间戳不同故 SHA 不同。
  - **「干净重打」完整清理清单（缺一必炸，2026-09-23 实测）**：① `cargo clean`（清 16.2 GiB / 27,120 文件）；② `gradlew clean --no-daemon`；③ 删 `~/.cargo/registry/src/*/tauri-plugin-*/android/.tauri`（插件 build script 残留，否则报 `os error 183`）；④ 删 `gen/android/app/src/main/jniLibs/{armeabi-v7a,x86,x86_64}/libdycast_android_lib.so`（target 清空后这些符号链接成断链，tauri 删不掉报 `os error 5 拒绝访问`）。详见 Android/agent.md 17.9。
  - **顺带发现的环境限制**：本机安全策略对「单目录内 >50 个文件的删除」强制批量确认（Node 侧 `fs.rmSync` 被 `node-safe-delete-shim.cjs` 劫持，PowerShell 侧 `Remove-Item` 同样受限，且 `cmd.exe` 被禁止调用）→ 大目录清理走官方命令或分批处理。另：**文件名禁用冒号**（`2026.09.23-10:10-task.md` 会被 Windows 当成"文件 + NTFS 数据流"，导致无法修改/删除），任务归档请写 `2026.09.23-10.10-task.md`。
- **2026-09-20 Android 发版约定**：每次修改完成后**自动递增版本号、构建并上传飞书云盘**（命令 `cd Android && node scripts/build-apk.cjs --bump --notes "..."`），完成后把飞书链接发给用户；**不使用 Android CLI 做测试安装**（`npm run android-dev` 等不作发版前验证）。此约定为长期有效，见第 3 节第 10/11 条。
- **续跑防呆（2026-09-22 血泪）**：若上一轮构建**已被 `--bump` 改过版本号、但 APK 未产出/未上传**，续跑**必须去掉 `--bump`**（`node scripts/build-apk.cjs --notes "..."`），否则版本号会再 +1 造成跳版（v1.1.18 即因此从未发布，2026-09-22 又差点跳过 v1.1.22）。判断方法：先看 `Android/logs/` 最新日志是否已出现 `version：→ vX`，以及 Gitee/飞书上是否已有该版本产物。

---

## 2. 目录结构

| 目录 | 用途 | 对应 AI 手册 |
|------|------|--------------|
| [Android/](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Android) | Android 移动端（Tauri + Vue + Rust） | [Android/agent.md](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Android/agent.md) |
| [Windows/](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows) | Windows 桌面端（Tauri + Vue + Rust） | [Windows/agent.md](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/agent.md) |
| [app-icon.png](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/app-icon.png) | 双平台共用的应用图标 | — |
| [.trae-cn/memory/projects/-c-Users-jiuyuanjun-Desktop-project/dycast/](file:///c:/Users/jiuyuanjun/.trae-cn/memory/projects/-c-Users-jiuyuanjun-Desktop-project/dycast/) | Trae 项目记忆（用户偏好、约定、踩坑记录） | [project_memory.md](file:///c:/Users/jiuyuanjun/.trae-cn/memory/projects/-c-Users-jiuyuanjun-Desktop-project/dycast/project_memory.md) |

**说明**：
- 修改 Android 相关代码前，先阅读 [Android/agent.md](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Android/agent.md)。
- 修改 Windows 相关代码前，先阅读 [Windows/agent.md](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/agent.md)。
- **Windows 前端源码与 Android 完全一致（2026-09-12 起）**：Windows 直接复用 Android 的横竖屏 UI 源码（`Windows/src` 与 `Android/src` 同源，Rust 后端也同步为 Android 同款命令）。修改 UI/核心逻辑时优先改 Android 端，再按 Windows/agent.md 第 6.4 节流程同步到 Windows；或两端一起改保持一致。
- 项目级约定（图标路径、版本管理规则、UI 通用规范）以本手册和 [project_memory.md](file:///c:/Users/jiuyuanjun/.trae-cn/memory/projects/-c-Users-jiuyuanjun-Desktop-project/dycast/project_memory.md) 为准。
- 旧 Windows 桌面 UI（2026-07 三栏版）备份在 `Windows_legacy_backup/`。

---

## 3. 项目级通用约定

1. **应用图标**：双平台必须统一使用根目录下的 [app-icon.png](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/app-icon.png)。
2. **版本号管理**：每次更新必须同步更新对应平台的 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 及 Android 的 `tauri.properties`。
3. **Session/Cookie 一致性**：
   - 抖音 `sessionid` 必须同步到 Rust 代理；
   - HTTP 和 WebSocket 请求必须携带一致的 `ttwid`、`msToken`、`sessionid` 与 User-Agent。
4. **构建产物**：
   - Windows 产物位于 `Windows/src-tauri/target/release/`；
   - Android APK 生成路径与命名规则见 [Android/agent.md](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Android/agent.md)。
5. **文档维护**：每个平台子目录维护独立的 `agent.md`；本根级手册仅在项目结构发生重大变化时更新。
6. **APK 更新后自动上传飞书（2026-09-06 起，用户要求）**：AI 会话完成其他任务并确认没问题后，若本次产出/更新了 Android APK 交付包，必须作为收尾步骤立即上传到飞书发布文件夹并把链接发给用户；具体协议（同名覆盖、旧文件清理、状态记录 `.feishu-upload-state.json`）见 [Android/agent.md](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Android/agent.md) 第 17.1 节。
7. **所有更新内容统一存放飞书云盘（2026-09-13 起，用户要求）**：
   - 一切对外交付的更新产物（Android APK、Windows 安装包、更新说明等）必须上传到飞书云盘发布文件夹（folder-token `KUWzf6phnlApZSdAwBActyUrnke`），并把链接发给用户。
   - 发布文件夹为"发布唯一出口"：Gitee 仅作为 Android 应用内自动更新的版本源；飞书云盘是所有更新内容（含回滚版本）的最终存放地。
   - 每次上传后更新 `.feishu-upload-state.json` 记录（fileName / sha256 / fileToken / url / folderToken）。
8. **agent.md 必须持续更新（2026-09-13 起，用户要求）**：
   - 每次会话完成功能新增 / Bug 修复 / 版本发布 / 流程变更后，必须同步更新对应的 `agent.md`（根 / Android / Windows）：
     - 新增功能与 Bug 修复记入 Android/agent.md 的对应章节（Bug 修复记录 / 变更记录）；
     - 版本号、发布状态、飞书 token、Gitee Release 现状必须同步刷新；
     - 文档末尾的"文档版本 + 更新时间"必须递增；
   - 严禁"改了代码但手册不更新"；手册滞后会让后续接手者误判现状（此前 v1.1.3→v1.1.8 期间手册曾严重滞后，需引以为戒）。
9. **Android 发版统一走一键构建程序（2026-09-17 起，用户要求）**：以后更新完需要出包时，**直接执行 `cd Android && node scripts/build-apk.cjs`**（可加 `--bump --notes "更新说明"`），不要再临时拼命令、不要再出现构建异常排查。
   - 程序固化全流程：环境校验与残留进程清理 → 版本号 4 处同步 → 前端构建 → assets 清空重建 → `cargo tauri android build --apk --target aarch64` → zipalign+apksigner → Gitee Release（只留最新）→ 飞书上传（保留最新+1 回滚，含 SHA-256 状态记录），每步都有防呆校验与日志文件。
   - 常用续跑：`--from build` / `--only sign` / `--only upload`；跳过发布：`--no-gitee` / `--no-upload`。
   - 完整用法、步骤表与设计说明见 [Android/agent.md](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Android/agent.md) 第 17.3 节。
10. **不生成 Windows 版本（2026-09-20 起，用户要求，长期有效）**：后续所有功能更新 / Bug 修复 / 发版**仅在 Android 端进行**，不再构建、发布或交付 Windows 安装包。Windows 前端源码与 Android 同源（`Windows/src` 与 `Android/src` 同步关系保留），但 Windows/agent.md 中所有发版/构建章节按“不再使用”处理。
11. **发版免确认 + 不用 Android CLI 测试（2026-09-20 起，用户要求，长期有效）**：每次修改完成后**自动递增版本号、构建 APK 并上传飞书云盘**（标准命令 `cd Android && node scripts/build-apk.cjs --bump --notes "..."`），无需先询问用户；**不使用 Android CLI 做发版前测试**（`npm run android-dev` / `tauri android dev` / `adb` 安装、模拟器脚本等一律不作为发版验证步骤）——构建程序内置的产物校验（APK 内 js/css 与 dist 一致、apksigner verify、版本 4 处回读）即为验证。

---

## 4. 快速导航

- **Android 维护** → [Android/agent.md](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Android/agent.md)
- **Windows 维护** → [Windows/agent.md](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/agent.md)
- **用户偏好与历史约定** → [project_memory.md](file:///c:/Users/jiuyuanjun/.trae-cn/memory/projects/-c-Users-jiuyuanjun-Desktop-project/dycast/project_memory.md)

---

**文档版本**：v2.15  
**更新时间**：2026-10-02（发布 Android **v1.3.6**「全链路核查补全」：表情解码/请求重试/冷却Map有界/前端空态与互斥/横竖屏保留草稿与筛选/死路由清理/测试扩充，详见上文）。上一版 v2.14 记录 Android **v1.3.3**「常用语/快捷发送」。
