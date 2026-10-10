# DyCast Windows - AI 维护手册

本文档汇总 DyCast Windows 桌面版的功能实现、工程约定与问题排查，供 AI 接手与维护使用。

---

## 1. 项目概述

- **中文名**：抖音弹幕姬 / 抖音直播弹幕助手
- **定位**：DyCast 的 Windows 桌面版，与 Android 版共用项目根目录的 [app-icon.png](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/app-icon.png)。
- **技术栈**：
  - 前端：Vue 3 + Vite + TypeScript + SCSS
  - 后端：Rust + Tauri 2.x
  - 代理：Rust Axum + Reqwest + Tokio-Tungstenite
  - 构建：`npm run tauri:build`
  - 调试：WebView2 / Tauri CLI
- **核心功能**：输入抖音直播间房间号，实时获取并展示弹幕、礼物、关注、点赞、进入等信息；支持将解析后的弹幕通过 WebSocket 转发到自定义后端。
- **当前版本**：v1.1.11（与 [package.json](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/package.json) 一致）
- **2026-09-12 重要变更**：Windows 端前端改为直接复用 **Android 端源码**（横竖屏模式），桌面窗口宽度自适应切换布局——窗口窄（竖屏比例）显示移动端单列布局，窗口宽（横屏比例）显示三栏布局（左直播信息/中弹幕/右操作区），与 Android 手机版 UI 完全一致。Rust 后端同步升级为 Android 同款（登录/代理/短链解析/更新模块）
- **2026-09-15 同步（v1.1.11）**：桌面图标回退（删除模板自适应图标引用，恢复 PNG 图标）、保活引导仅首次弹窗、首页移除「搜索主播」入口；版本号同步 1.1.11。
- **2026-09-16 同步（v1.1.12）**：前端与 Android 完全同步（Android/src → Windows/src）——① 修复直播结束切换直播间误报"主播已下播"（降级页解析防误判 + confirm 同步 roomNum + 连接前清理残留状态 + CONNECTING_ERROR 独立提示）；② 保活引导弹窗可关闭（首次引导新增「完成，开始使用」按钮，引导+提醒两种模式完善）；③ 自动回复未登录禁用开关 + 首页/直播间顶栏设置按钮左边快捷入口（AppHeader 新增 #extra 插槽）；④ 弹幕发送修复（sendMessage.ts 补 form body `content` 参数）+ 输入框 @ 用户候选列表；⑤ 直播间「在线观众|粉丝」下方新增贡献榜（送礼榜 ROOM_RANK + 在线榜 ROOM_USER_SEQ 双 tab）；⑥ 设置菜单：删除「工具-切换房间号」、「账号-退出登录」改为「退出房间」；⑦ 自动回复按房间隔离；⑧ 直播结束/断线/连接失败弹窗区分；⑨ 自动清理消息（通知设置可配秒数）。Rust 端 notification.rs/lib.rs 已同步。
- **2026-09-20 Android-only 调整**：本次不生成 Windows 版本；Android 竖屏贡献榜删除“送礼/在线”切换，仅保留送礼贡献榜；横屏将贡献榜放入“房间号 & 贡献榜”区域，并与“进入 & 关注 & 粉丝团”区域上下各占一半；弹幕发送继续复用已获取 token 的网页发送链路。Windows 保持现有版本与源码不变。Windows 手册仅记录该边界，不同步 Android 源码。
- **2026-09-20 安装边界**：Android 修改完成后自动递增版本、构建并上传飞书云盘（不使用 Android CLI 测试安装）；Windows 不参与本次发版。
- **2026-09-20 Android-only 调整（续，v1.1.17 / v1.1.19）**：Android ① 更新弹窗改为应用内下载进度条，下载完成提示安装，选「稍后」下次直接用已下载包安装不重复下载；② 有历史登录记录后不再提示「登录抖音账号后才可显示礼物信息」；③ 贡献榜条目改三列（名次 | 头像 | 名字）。以上均仅 Android 端，Windows 不参与发版、不同步源码（长期约定见第 2 节第 11 条）。
- **2026-09-17 同步（v1.1.13）**：全栈问题修复同步（Android/src → Windows/src，Rust `proxy.rs`/`notification.rs`/`lib.rs` 同步）——① 幽灵连接修复（主动断开不再自动重连，`manualClosed` 标记 + 关闭码判定）；② 重连竞态修复（连接代次 `connSeq` 过滤过期 socket 事件、`reconnectPending` 防并发、退避重试）；③ 切换房间后旧实例事件不再污染新连接状态（`isCurrent()` 判定）；④ 代理转发补传 `Content-Type`；⑤ `getImInfo` 不再伪造 cursor（改抛错）；⑥ CONTROL 下播判定补全 action 3/4/6 且不再被 `disconnectLive` 覆盖弹窗；⑦ 消息列表/去重集合加上限；⑧ 点赞通知文案、SOCIAL 关注/取关/分享文案、本场关注数统计修正；⑨ 前后台判定 fail-open + 1s 缓存；⑩ 更新检查节流时机；⑪ 保活弹窗电池状态即时读取；⑫ CORS 收紧为仅本机来源且不暴露 Set-Cookie（**若真机出现接口全被跨域拦截，需回退为 `Any`**）。版本号同步 1.1.13。

---

## 2. 关键约定与硬性要求

1. **图标**：使用项目根目录下的 [app-icon.png](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/app-icon.png)。
2. **登录方式**：通过 WebView2 打开 `https://live.douyin.com`，利用 `ICoreWebView2_2.CookieManager` 提取 `sessionid`，仅支持 Windows。
3. **本地代理**：Rust 后端在随机端口启动 HTTP + WebSocket 代理，前端通过 `get_proxy_port` 获取端口后访问 `/dylive/*` 与 `/socket/*`。
4. **sessionid 同步**：前端获取/设置/清除 sessionid 后必须调用 `set_sessionid(sid)`，确保 Rust 代理在 HTTP 和 WebSocket 请求中注入该 cookie。
5. **User-Agent 一致性**：代理使用固定 PC UA，前端 `navigator.userAgent` 需与代理一致，否则 `a_bogus` / `signature` 计算会失败。
6. **Cookie 透传**：HTTP 代理需重写 `Set-Cookie`（移除 Domain / SameSite / Secure），否则 WebView 在 `127.0.0.1` 下无法写入 cookie。
7. **NSIS / MSI 安装包**：界面使用简体中文，并嵌入 WebView2 Runtime。
8. **所有更新内容统一存放飞书云盘（2026-09-13 起，用户要求）**：一切对外交付的更新产物（Windows 安装包、Android APK、更新说明等）必须上传飞书云盘发布文件夹（folder-token `KUWzf6phnlApZSdAwBActyUrnke`）并把链接发给用户；Gitee 仅作为 Android 应用内自动更新的版本源。
9. **agent.md 必须持续更新（2026-09-13 起，用户要求）**：每次会话完成功能新增 / Bug 修复 / 版本发布 / 流程变更后，必须同步更新对应 `agent.md`（根 / Android / Windows）——新增功能与 Bug 记入对应章节、版本号与发布状态同步刷新、文档末尾"文档版本 + 更新时间"递增。严禁"改了代码但手册不更新"。
10. **Android 发版统一走一键构建程序（2026-09-17 起，用户要求）**：Android 出包固定执行 `cd Android && node scripts/build-apk.cjs [--bump] [--notes "…"]`（含构建 → 签名 → Gitee → 飞书上传全流程与防呆校验），不要再临时拼命令。用法见 [Android/agent.md](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Android/agent.md) 第 17.3 节。Windows 端复用 Android 前端源码，改动后仍需按本手册 6.4 节同步。
11. **不再生成 Windows 版本（2026-09-20 起，用户要求，长期有效）**：后续所有功能更新 / Bug 修复 / 发版**仅在 Android 端进行**，不再构建、发布或交付 Windows 安装包。本手册的构建/发版/同步章节（如 6.4 节源码同步、NSIS/MSI 打包）**保持归档可查但不再执行**；如需恢复 Windows 交付，须先由用户明确确认。`Windows/src` 与 `Android/src` 的同源关系仅作历史参考。

---

## 3. 目录结构

| 目录 | 用途 | 当前存放 |
|------|------|----------|
| [src/](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/src) | 前端 Vue 源码 | 视图、组件、工具、核心逻辑 |
| [src-tauri/](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/src-tauri) | Tauri / Rust 后端 | Rust 源码、图标、Tauri 配置 |
| [dist/](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/dist) | 前端构建产物 | index.html、CSS/JS、字体、mssdk.js |
| [public/](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/public) | 静态资源 | favicon.ico、mssdk.js |
| [skills/](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/skills) | Lark Skills 相关 | 飞书各能力 Skill 定义与参考文档 |
| [.agents/skills/](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/.agents/skills) | Lark Skills 副本 | 与 skills/ 内容基本一致 |
| [prototypes/](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/prototypes) | UI 布局原型 | 竖屏/横屏/自适应 HTML 原型 |

**必须保留在根目录的文件**：
- [package.json](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/package.json)
- [package-lock.json](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/package-lock.json)
- [pnpm-lock.yaml](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/pnpm-lock.yaml)
- [index.html](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/index.html)
- [mssdk.js](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/mssdk.js)（根目录引用入口）
- [README.md](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/README.md)
- [app-icon.png](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/app-icon.png)
- [agent.md](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/agent.md)（本文档）

---

## 4. 前端结构

- [App.vue](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/src/App.vue)：入口组件，挂载路由视图 + `<UpdateDialog auto />` + `<LiveEndDialog />`（自动更新弹窗 + 直播结束/断线提醒弹窗）。
- [src/views/](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/src/views)：页面视图（与 Android 完全一致）：
  - [HomePage.vue](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/src/views/HomePage.vue)：首页，房间号/直播链接/短链/主播名输入与实时识别。
  - [LivePage.vue](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/src/views/LivePage.vue)：竖屏直播页（弹幕/礼物/进入关注/主播数据 Tab）。
  - [LandscapePage.vue](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/src/views/LandscapePage.vue)：横屏三栏直播页。
  - [MorePage.vue](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/src/views/MorePage.vue)：设置页（工具/通知/账号/关于），其中"检查更新"可正常工作。
  - 其余：RoomConfirmPage / LoginWebviewPage / RoomSearchWebviewPage / ConsolePage / SwitchRoomPage / NotificationSettingsPage 等。
- [src/router/index.ts](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/src/router/index.ts)：`vue-router` 路由表（hash 模式）。
- [src/composables/useOrientation.ts](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/src/composables/useOrientation.ts)：横竖屏检测（全局共享 ref + 防抖）。**Windows 端窗口宽度>高度时自动切横屏三栏，窄窗口显示竖屏单列**——与 Android 屏幕旋转逻辑等价。
- [src/store/index.ts](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/src/store/index.ts)：全局状态（房间连接、消息、登录、下播/断线弹窗状态）。
- [src/core/](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/src/core)：核心逻辑（dycast.ts 连接解析、model.ts protobuf 模型、util.ts、abogus.js 签名、request.ts、signature.ts）。

**界面布局**：
- **横屏（窗口宽）**：三栏——左侧直播信息面板与用户卡片，中间弹幕列表，右侧房间号输入与操作区（与 Android LandscapePage 相同）。
- **竖屏（窗口窄）**：移动端单列——首页/直播 Tab/设置等（与 Android LivePage 相同）。
- 弹幕类型图标按钮控制各类消息的显隐。

## 5. Rust 后端结构

| 文件 | 职责 |
|------|------|
| [lib.rs](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/src-tauri/src/lib.rs) | Tauri 应用入口，注册插件、启动代理、暴露命令（与 Android 同款，含 short_link/updater/notification） |
| [proxy.rs](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/src-tauri/src/proxy.rs) | HTTP `/dylive/*` 与 WebSocket `/socket/*` 代理转发 |
| [login.rs](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/src-tauri/src/login.rs) | Windows WebView2 登录窗口与 sessionid 提取（含桌面/移动双分支） |
| [short_link.rs](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/src-tauri/src/short_link.rs) | v.douyin.com 短链解析（resolve_short_url 命令） |
| [updater.rs](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/src-tauri/src/updater.rs) | fetch_text（抓取 Gitee 更新清单）/ start_apk_download（桌面端为空操作） |
| [notification.rs](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/src-tauri/src/notification.rs) | 通知/保活命令（Android 原生实现；桌面端返回 false 占位） |
| [main.rs](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/src-tauri/src/main.rs) | 程序入口，调用 dycast_lib::run |

### 5.1 Tauri 命令

- `get_proxy_port`：返回本地代理监听端口。
- `open_douyin_login`：打开抖音登录 WebView 窗口（桌面 WebView2；移动端原生 WebView）。
- `extract_douyin_sessionid`：从登录窗口 CookieManager 提取 `sessionid`。
- `set_sessionid`：将 sessionid 注入 Rust 代理状态。
- `open_douyin_room_search` / `close_douyin_room_search` / `extract_douyin_room_url`：直播间搜索 WebView（桌面复用登录窗口）。
- `resolve_short_url`：短链解析（桌面 UA + 重定向跟随）。
- `fetch_text`：抓取任意 URL 文本（更新检查用）。
- 通知/保活命令（start_foreground_service 等）：桌面上为空操作/返回 false，前端按非 Android 环境降级。

### 5.2 代理转发规则

- `/dylive/*` → `https://live.douyin.com/*`（HTTP）
- `/socket/*` → `wss://webcast100-ws-web-lq.douyin.com/*`（WebSocket）

代理会：
- 使用持久 cookie jar 保存 `ttwid`、`msToken` 等伴随 cookie；
- 注入用户提供的 `sessionid`；
- 转发并重写 `Set-Cookie`；
- WebSocket 握手时合并 HTTP 阶段的 cookie。

---

## 6. 构建与运行

### 6.1 开发环境

```powershell
cd Windows
npm install
npm run dev
```

### 6.2 构建桌面应用

```powershell
cd Windows
npm run tauri:build
```

产物位于 `src-tauri/target/release/`。

### 6.3 仅构建前端

```powershell
cd Windows
npm run build
```

产物位于 [dist/](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/dist)。

### 6.4 注意事项（2026-09-12 起）

- 前端源码直接复用 Android 端，**修改 UI 前请先读 [Android/agent.md](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Android/agent.md) 对应章节**；两端使用同一套 `src/*`，保持同步。
- `tauri.conf.json` 窗口 `minWidth: 420 / minHeight: 700`，可通过拖拽窗口宽度在竖屏/横屏布局间切换。
- 【成功经验】从 Android 同步源码到 Windows 的流程：
  1. `Android/src` 整体复制覆盖 `Windows/src`（含 views/components/utils/core/store/router/composables/assets）
  2. `Android/src-tauri/src/*.rs` 复制到 `Windows/src-tauri/src/`（lib.rs 需检查；main.rs 引用名 `dycast_android_lib` → `dycast_lib`）
  3. `Android/mssdk.js` 复制到 `Windows/`（index.html 引用 `./mssdk.js`）
  4. `package.json` 对齐依赖（vue-router / protobufjs / sass 等）
  5. `tsconfig.json` 简化为 Android 同款单配置（删除 references / tsconfig.app.json / tsconfig.node.json 保留为 .bak）
  6. 删除 `src/hooks/` 旧残留（useResizeObserver / useTimeCounter）
  7. `Cargo.toml` 补 `regex`（short_link.rs 依赖）
  8. 旧桌面 UI 备份在仓库根 `Windows_legacy_backup/`

---

## 7. 常见坑与修复

| 问题 | 原因 | 修复 |
|------|------|------|
| 桌面版无法获取数据（Web 版正常） | 桌面环境缺少代理，或 cookie/UA 不一致 | 确保 Rust 代理已启动，sessionid 已同步，UA 与签名计算一致 |
| WebSocket 握手失败 | 未携带 HTTP 阶段 cookie | 代理在 WS 握手时合并 jar 中的 cookie 与 sessionid |
| `a_bogus` / signature 为空 | mssdk.js 未正确加载 | 检查 [public/mssdk.js](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/public/mssdk.js) 是否进入构建产物 |
| 登录窗口无法提取 sessionid | 非 Windows 平台或 WebView2 未安装 | 仅 Windows 支持；确保 WebView2 Runtime 已安装 |
| cookie 未生效 | `Set-Cookie` 带 Domain / SameSite / Secure | 代理重写 `Set-Cookie`，移除这些属性 |

---

## 8. 配置与联系方式

- **包名**：由 [src-tauri/tauri.conf.json](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/src-tauri/tauri.conf.json) 定义。
- **应用图标**：[app-icon.png](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Windows/app-icon.png)
- **Android 版对应文档**：[Android/agent.md](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Android/agent.md)
- **项目记忆**：[project_memory.md](file:///c:/Users/jiuyuanjun/.trae-cn/memory/projects/-c-Users-jiuyuanjun-Desktop-project/dycast/project_memory.md)

---

**文档版本**：v2.15  
**更新时间补记**：2026-09-23（Android **v1.3.1 已发布（「完整重新打包」）**：代码与 v1.3.0 完全一致，无任何源码改动；清理 Rust target（16.2 GiB）+ Gradle 缓存后全量重编，用于排除构建缓存导致的产物问题。产物 `Android/output/dycast-1.3.1-arm64.apk`，30.5 MB（32,014,663 字节），SHA-256 `2cbe0172eb9fa262955e5970d66c421f25c40f6ed736e303d67bad7e383d813e`，Gitee tag v1.3.1（Release id 1161390，已删 v1.3.0）、飞书 https://my.feishu.cn/file/Ks76bszXUo0Y7jxXDhYciuSOnLe 。本次同时摸清「干净重打」的四步清理清单（`cargo clean` + `gradlew clean` + 清 cargo registry 里 `tauri-plugin-*/android/.tauri` + 清非 arm64 的 jniLibs 断链），详见 Android/agent.md 17.9。Windows 端不同步、不构建、不交付——按长期约定，`Windows/src` 已不再跟随 Android 源码复制）  
**更新时间补记**：2026-09-22（Android **v1.3.0 已发布**：在 v1.2.0 全部内容（登录判定以本地 cookie 为准、通知同 ID 覆盖刷新、消息按保留时长删除、贡献榜滑动与数据加固、横屏面板精简、后台保活重构）之上，新增**原生通知后端**——弹幕通知链路下沉 Rust：代理层旁路解析 protobuf+gzip、后台由原生直接发系统通知、ack 由 Rust 接管防断连、通知设置镜像到 SharedPreferences、前后台双路互斥去重；产物 `Android/output/dycast-1.3.0-arm64.apk`，SHA-256 `615cd985d7c5f18f420bd53dc149a999d4514d9c0133c4b213dfdc4ba1f8a060`，Gitee tag v1.3.0（Release id 1159329）、飞书 https://my.feishu.cn/file/OL7Gblp6CoWCx7xCYcKctAGQnud 。Windows 端不同步、不构建、不交付——按长期约定，`Windows/src` 已不再跟随 Android 源码复制）
**更新时间**：2026-09-20（固化「不再生成 Windows 版本」长期约定；记录 Android-only v1.1.17 / v1.1.19 边界）
