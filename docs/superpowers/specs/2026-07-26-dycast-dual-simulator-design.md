# DyCast Android UI Preview - 双视图实时同步模拟器设计文档

**版本**：v1.0  
**日期**：2026-07-26  
**目标文件**：[Android/pages/android-ui-preview.html](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Android/pages/android-ui-preview.html)

---

## 1. 背景与目标

现有 [android-ui-preview.html](file:///c:/Users/jiuyuanjun/Desktop/project/dycast/Android/pages/android-ui-preview.html) 已包含所有竖屏页面卡片和部分横屏卡片，但缺乏一个能够同时演示竖屏与横屏交互的实时同步模拟器。

本设计要求在页面最顶部新增一个**左右实时同步的双视图模拟器**：

- 左侧：纯竖屏手机样式
- 右侧：纯横屏电脑版式三栏样式
- 任意一侧的操作都会实时同步到另一侧
- 下方保留所有现有页面卡片，并为每个页面追加横屏版本

---

## 2. 共享状态模型

使用单一 JS 对象作为两个模拟器的唯一状态源。

```javascript
state = {
  page: 'home',          // home | confirm | login | webview | live | more | settings | console | save | switch
  roomInput: '',
  roomNum: '560402456867',
  isLiving: true,
  isLoggedIn: false,
  liveTab: 'chat',       // chat | gift | social | data
  showLoginModal: false,
  recentRooms: [
    { name: '涛涛', roomNum: '397624714394' }
  ],
  messages: {
    chat: [...],
    gift: [...],
    social: [...]
  },
  liveData: { ... }
}
```

所有 DOM 事件只修改 `state`，修改后统一调用 `render(state)` 重绘两侧模拟器。

---

## 3. 渲染策略

### 3.1 竖屏模拟器

根据 `state.page` 显示对应页面：

- `home`：连接直播间输入框 + 下一步 + 最近进入列表
- `confirm`：确认主播页（直播中显示“确认正确”，未开播隐藏）
- `login`：登录抖音账号页
- `webview`：抖音网页登录 WebView
- `live`：直播功能页 + 底部导航，根据 `state.liveTab` 显示弹幕/礼物/进入&关注/主播数据
- `more`：设置入口页
- `settings / console / save / switch`：对应全屏子页

### 3.2 横屏模拟器

始终显示三栏布局，内容随 `state` 变化：

- 左栏：直播信息 + 用户卡片 + 工具图标 + 计时器 + 连接状态
- 中栏：上弹幕 / 下礼物
- 右栏：房间号输入 + 连接按钮 + 最近进入列表 + 进入&关注&粉丝团信息

当 `state.page` 为 `settings / console / save / switch / login` 时，横屏中央弹出对应面板或覆盖层；当 `state.page` 为 `live` 时，根据 `state.liveTab` 高亮/滚动对应区域。

---

## 4. 交互同步规则

| 操作 | 竖屏行为 | 横屏同步 |
|---|---|---|
| 点击“下一步” | 进入 confirm | 右栏显示房间号，左栏刷新直播信息 |
| 点击 confirm 的“确认正确” | 进入 login | 中栏礼物区显示登录引导 |
| 点击 login 的“跳过” | 进入 live | 礼物区保持登录引导 |
| 点击“抖音扫码 / 网页登录” | 进入 webview | 横屏弹出 90% 登录弹窗 |
| 点击 live 底部导航 | 切换 `liveTab` | 中栏/右栏对应面板高亮 |
| 点击“设置”图标 | 进入 more | 右栏展开设置入口 |
| 点击 more 中“通知设置/控制台/保存弹幕/切换房间号” | 进入对应子页 | 横屏中央显示对应面板 |
| 点击“最近进入”卡片 | 只把房间号填入输入框 | 右栏输入框同步更新 |
| 点击横屏“连接” | 同步 roomInput | 竖屏进入 confirm |

---

## 5. 页面卡片区

保留现有全部竖屏预览卡片，并为以下页面各新增一个横屏版本卡片：

- 首页
- 确认主播（直播中 / 未开播）
- 登录抖音账号
- 抖音网页登录
- 直播功能页（弹幕 / 礼物未登录 / 礼物已登录 / 进入&关注 / 主播数据）
- 设置页
- 通知设置
- 控制台
- 保存弹幕
- 切换房间号
- 横屏三栏（已登录 / 未登录 / 登录弹窗）

横屏卡片复用现有 `.device.landscape` 样式，确保与已有 Page 5 风格一致。

---

## 6. 样式与尺寸

- 竖屏模拟器容器：`width: 320px; min-width: 240px`
- 横屏模拟器容器：`width: 680px; min-width: 400px`
- 用户提到的“最小宽度 400dpi”按 **400px 最小宽度** 实现；如后续确认是屏幕密度单位，再改为 `@media (min-resolution: 400dpi)` 或 `device-pixel-ratio` 方案
- 两模拟器在同一行，父容器允许横向滚动，避免窗口窄时被压扁
- 颜色、圆角、字体、图标沿用现有 CSS 变量和 castfont 图标
- 字体大小保持现有预览页风格，但**模拟器内部字体整体缩小一档**（用户反馈不要那么大的字）

---

## 7. 代码组织

全部实现在单一 HTML 文件内，新增一段 `<script>`：

- `initState()`：初始化示例数据
- `renderPortrait(state)`：渲染竖屏模拟器
- `renderLandscape(state)`：渲染横屏模拟器
- `bindEvents()`：绑定所有点击事件
- 为可读性，模拟器 DOM 拆成模板字符串，避免单文件 HTML 过于冗长

---

## 8. 未完善内容

在页面底部保留并更新 Known Issues，新增：

- 首页“最近进入”空状态暂无引导
- 横屏设置/控制台等子页在模拟器里用覆盖层展示，实际 App 中可能为全屏页面
- 模拟器仅用于 UI 预览，不涉及真实网络连接与消息推送

---

## 9. 验收标准

- [ ] 顶部同时显示竖屏和横屏两个模拟器
- [ ] 任意一侧可点击操作，另一侧实时同步
- [ ] 模拟器包含首页、确认、登录、WebView、直播、设置、控制台、保存、切换房间号等全部功能
- [ ] 下方页面卡片区包含每个页面的竖屏和横屏版本
- [ ] 横屏模拟器最小宽度为 400px
- [ ] 模拟器内部字体不过大，保持与现有预览页协调
