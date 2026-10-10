(() => {
  const runtime = window.DyCastPreviewRuntime;
  if (!runtime) return;
  const state = window.__previewState;
  if (!state) return;

  window.__previewRealMode = true;

  // 真实模式：彻底清空静态演示数据，避免把虚拟状态混入真实页面。
  state.logs = [];
  state.messages = { chat: [], gift: [], social: [] };
  state.recentRooms = [];

  let client;
  let timer;

  const addLog = (tag, cls, text) => {
    state.logs.push({ t: new Date().toTimeString().slice(0, 8), tag, cls, text });
    if (state.logs.length > 200) state.logs.shift();
    if (typeof window.render === 'function') window.render();
  };

  const resetMessages = () => {
    state.messages.chat = [];
    state.messages.gift = [];
    state.messages.social = [];
  };

  const updateInfo = info => {
    if (!info) return;
    state.liveData.anchor = info.nickname || '-';
    state.liveData.title = info.title || '直播间';
    state.liveData.cover = info.cover || '';
    state.isLiving = info.status === runtime.RoomStatus.LIVING;
  };

  const messageUser = msg => msg.user?.name || '未知用户';

  const pushMessage = msg => {
    const user = messageUser(msg);
    // 主播/观众/粉丝等数据随真实消息实时更新
    if (msg.room) {
      const r = msg.room;
      if (r.audienceCount !== undefined) state.liveData.audience = String(r.audienceCount);
      if (r.followCount !== undefined) state.liveData.fans = String(r.followCount);
      if (r.likeCount !== undefined) state.liveData.likes = String(r.likeCount);
      if (r.totalUserCount !== undefined) state.liveData.totalViews = String(r.totalUserCount);
    }
    if (msg.method === runtime.CastMethod.CHAT || msg.method === runtime.CastMethod.EMOJI_CHAT) {
      state.messages.chat.push({ user, msg: msg.content || '' });
    } else if (msg.method === runtime.CastMethod.GIFT) {
      state.messages.gift.push({ user, name: msg.gift?.name || '礼物', icon: msg.gift?.icon || '', amount: msg.gift?.count || 1 });
    } else if (msg.method === runtime.CastMethod.MEMBER) {
      state.messages.social.push({ user, type: 'enter', text: '进入直播间' });
    } else if (msg.method === runtime.CastMethod.SOCIAL) {
      state.messages.social.push({ user, type: 'follow', text: '关注了主播' });
    } else if (msg.method === runtime.CastMethod.FANSCLUB) {
      state.messages.social.push({ user, type: 'fans', text: '加入了粉丝团' });
    } else if (msg.method === runtime.CastMethod.LIKE) {
      const content = String(msg.content || '1');
      const likeText = content.includes('点赞') ? content : `为主播点赞了(${content})`;
      state.messages.social.push({ user, type: 'like', text: likeText });
    }
    for (const key of ['chat', 'gift', 'social']) if (state.messages[key].length > 200) state.messages[key].shift();
  };

  const parseRoom = async raw => {
    let room = runtime.extractRoomNum(raw);
    if (room) return room;
    const clean = runtime.extractDouyinUrlFromText(raw);
    if (/v\.douyin\.com\//i.test(clean)) {
      addLog('解析', 'info', `正在解析短链接: ${clean}`);
      try {
        const resolved = await runtime.resolveShortUrl(clean);
        addLog('解析', 'success', `短链接落地: ${resolved}`);
        room = runtime.extractRoomNum(resolved);
      } catch (err) {
        addLog('解析', 'error', `短链接解析失败: ${err?.message || err}`);
      }
    }
    return room;
  };

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    if (client) client.close(1000, '用户断开');
    client = undefined;
    state.connected = false;
  };

  // 搜索：真实抖音搜索页（新标签页可操控；抖音页面禁止 iframe 内嵌，故用新标签打开）
  window.openRealSearch = () => {
    const q = state.roomInput.trim();
    const url = `https://www.douyin.com/search/${encodeURIComponent(q)}`;
    addLog('搜索', 'info', `打开真实抖音搜索: ${url}`);
    window.open(url, '_blank');
  };

  // 登录：真实抖音登录页（新标签页可操控）
  window.openRealLogin = () => {
    const url = 'https://www.douyin.com/';
    addLog('登录', 'info', `打开真实抖音登录: ${url}`);
    window.open(url, '_blank');
  };

  window.disconnectReal = () => { stop(); addLog('连接', 'info', '已断开连接'); state.page = 'home'; window.render(); };
  window.leaveLive = window.disconnectReal;

  window.goNext = async () => {
    const raw = state.roomInput.trim();
    if (!raw) return;
    stop();
    state.page = 'home';
    window.render();
    try {
      addLog('解析', 'info', `正在解析输入: ${raw}`);
      const room = await parseRoom(raw);
      if (!room) {
        state.page = 'search';
        addLog('解析', 'error', '无法识别房间号，请检查输入（支持房间号、直播链接或分享文案短链）');
        window.render();
        return;
      }
      state.roomNum = room;
      state.roomInput = room;
      addLog('房间信息', 'info', `正在获取房间信息: ${room}`);
      const info = await runtime.getLiveInfo(room);
      updateInfo(info);
      addLog('房间信息', 'success', `主播 ${state.liveData.anchor} · ${state.isLiving ? '直播中' : '未开播'}`);
      state.page = 'confirm';
      window.render();
    } catch (err) {
      state.page = 'home';
      addLog('连接', 'error', `获取房间信息失败: ${err?.message || err}`);
      window.render();
    }
  };

  window.enterLive = () => {
    if (!state.roomNum) return;
    if (!state.isLiving) {
      addLog('连接', 'warning', '房间未开播，无法进入直播间');
      state.page = 'confirm';
      window.render();
      return;
    }
    state.page = 'live';
    state.connected = false;
    state.elapsed = 0;
    resetMessages();
    addLog('连接', 'info', `正在连接弹幕: ${state.roomNum}`);
    window.render();

    client = new runtime.DyCast(state.roomNum);
    client.on('open', (_event, info) => {
      updateInfo(info);
      state.connected = true;
      state.elapsed = 0;
      timer = setInterval(() => { state.elapsed++; if (typeof refreshLiveUI === 'function') refreshLiveUI(); }, 1000);
      addLog('WebSocket', 'success', '真实弹幕连接成功');
    });
    client.on('message', msgs => {
      msgs.forEach(pushMessage);
      addLog('消息', 'info', `收到真实消息 ${msgs.length} 条`);
    });
    client.on('reconnecting', count => addLog('重连', 'warning', `正在重连（第 ${count} 次）`));
    client.on('reconnect', () => addLog('重连', 'success', 'WebSocket 重连成功'));
    client.on('error', err => {
      state.connected = false;
      addLog('错误', 'error', `WebSocket 错误: ${err?.message || '连接异常'}`);
    });
    client.on('close', (code, reason) => {
      if (timer) { clearInterval(timer); timer = undefined; }
      state.connected = false;
      const reasonText =
        code === runtime.DyCastCloseCode.LIVE_END ? '直播未开播或已结束'
        : code === runtime.DyCastCloseCode.CONNECTING_ERROR ? '连接过程出错，请确认房间与网络'
        : `连接关闭: ${reason || code}`;
      addLog('连接', 'warning', reasonText);
    });
    client.connect().catch(err => addLog('连接', 'error', `连接失败: ${err?.message || err}`));
  };

  // 保活引导（可复用；首次打开自动展示一次，设置页“设置”入口可再次打开）
  window.showKeepAliveGuide = () => {
    const make = () => {
      const overlay = document.createElement('div');
      overlay.id = 'preview-onboarding';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;';
      overlay.innerHTML = `<div style="max-width:340px;width:90%;background:#fff;color:#1e2732;border-radius:12px;padding:22px;box-shadow:0 12px 40px rgba(0,0,0,.3);font-size:13px;line-height:1.6;">
        <h3 style="margin:0 0 10px;font-size:16px;">保持后台运行</h3>
        <p>为持续接收弹幕与礼物通知，请为「抖音直播弹幕助手」开启以下权限：</p>
        <ul style="margin:0 0 14px;padding-left:18px;">
          <li>加入电池优化白名单</li>
          <li>开启自启动 / 后台运行权限</li>
          <li>允许通知权限</li>
        </ul>
        <button id="preview-onboard-enter" style="width:100%;padding:10px;border:0;border-radius:7px;background:#68be8d;color:#fff;font-size:14px;font-weight:700;cursor:pointer;">进入</button>
      </div>`;
      overlay.querySelector('#preview-onboard-enter').addEventListener('click', () => {
        overlay.remove();
        try { localStorage.setItem('dycast_preview_onboarded', '1'); } catch {}
      });
      document.body.appendChild(overlay);
    };
    if (document.body) make();
    else window.addEventListener('DOMContentLoaded', make, { once: true });
  };

  // 首次打开：先走一遍保活引导，再进入。
  (function onboarding() {
    try { if (localStorage.getItem('dycast_preview_onboarded')) return; } catch { return; }
    window.showKeepAliveGuide();
  })();

  // 每秒刷新统计数据与计时（不整体重绘，避免打断滚动）
  const fmtElapsed = s => {
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor(s % 3600 / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    return `${h}:${m}:${sec}`;
  };
  const refreshLiveUI = () => {
    document.querySelectorAll('[data-elapsed]').forEach(el => { el.textContent = fmtElapsed(state.elapsed); });
    const statMap = {
      'data-audience': state.liveData.audience,
      'data-fans': state.liveData.fans,
      'data-likes': state.liveData.likes,
      'data-totalviews': state.liveData.totalViews
    };
    document.querySelectorAll('[data-stat]').forEach(el => {
      const key = el.getAttribute('data-stat');
      if (key in statMap) el.textContent = statMap[key] == null || statMap[key] === '' ? '-' : statMap[key];
    });
  };

  // 自动滚动到最新：手动上滑后保留位置
  const scrollPos = {};
  const LIVE_LIST_IDS = ['psn-live-list', 'ls-chat-list', 'ls-gift-list', 'ls-social-enter', 'ls-social-follow', 'ls-social-fans', 'real-connection-log-list'];
  document.addEventListener('scroll', e => {
    const el = e.target;
    if (!el || !LIVE_LIST_IDS.includes(el.id)) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    scrollPos[el.id] = { top: el.scrollTop, userAtBottom: nearBottom };
  }, true);

  const afterRenderScroll = () => {
    LIVE_LIST_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const prev = scrollPos[id];
      if (prev && !prev.userAtBottom) el.scrollTop = prev.top;
      else el.scrollTop = el.scrollHeight;
    });
  };

  // 包装 render：每次重绘后按滚动策略归位
  const origRender = window.render;
  window.render = function () {
    if (typeof origRender === 'function') origRender();
    requestAnimationFrame(afterRenderScroll);
  };

  if (typeof window.render === 'function') window.render();
})();
