<template>
  <div class="chat-input-bar">
    <div v-if="showCandidates" class="mention-dropdown">
      <div class="mention-title">@ 最近发言用户</div>
      <div
        v-for="c in filteredCandidates"
        :key="c.id || c.name"
        class="mention-item"
        @mousedown.prevent="pickMention(c)">
        <img v-if="c.avatar" class="mention-avatar" :src="c.avatar" alt="" />
        <span class="mention-name">{{ c.name }}</span>
      </div>
      <div v-if="!filteredCandidates.length" class="mention-empty">暂无匹配用户</div>
    </div>
    <input
      v-model="text"
      class="chat-input"
      :placeholder="placeholder"
      :disabled="sending || !loggedIn"
      maxlength="100"
      @keydown.enter.prevent="send"
      @focus="ingKey = true"
      @blur="blurInput"
    />
    <button class="chat-send" :disabled="!canSend" @click="send">
      {{ sending ? '...' : '发送' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useStore } from '@/store';
import { sendChatMessage } from '@/core/sendMessage';
import { CLog } from '@/utils/logUtil';
import type { CastUser } from '@/core/dycast';

const props = defineProps<{
  /** 直播间 room_id（number 形式） */
  roomId?: string;
  /** 提示文案 */
  placeholder?: string;
  /** 是否已登录 */
  loggedIn?: boolean;
}>();
const emit = defineEmits<{
  (e: 'tip', type: 'success' | 'error', msg: string): void;
  (e: 'sent'): void;
}>();

const store = useStore();
const text = ref('');
const sending = ref(false);
/** 输入框是否聚焦（用于控制 @ 候选显隐） */
const ingKey = ref(false);

const canSend = computed(() => !!text.value.trim() && !sending.value && !!props.loggedIn);

/** 从最近弹幕中收集发言用户（去重，保留头像），作为 @ 候选 */
const candidates = computed<CastUser[]>(() => {
  const map = new Map<string, CastUser>();
  const list = store.state.chatMessages;
  for (let i = list.length - 1; i >= 0 && map.size < 30; i--) {
    const u = list[i]?.user;
    if (!u?.name) continue;
    const key = u.id || u.name;
    if (!map.has(key)) map.set(key, { id: u.id, name: u.name, avatar: u.avatar, gender: u.gender });
  }
  return Array.from(map.values());
});

/** 是否显示候选：输入框聚焦且当前光标处于 "@关键词" 状态 */
const showCandidates = computed(() => ingKey.value && /(^|\s)@[\w\u4e00-\u9fa5]*$/.test(text.value));

/** 剔除候选列表中已输入的部分（@后已输入字符做前缀过滤） */
const filteredCandidates = computed(() => {
  const m = text.value.match(/(?:^|\s)@([\w\u4e00-\u9fa5]*)$/);
  const prefix = m?.[1] || '';
  if (!prefix) return candidates.value;
  return candidates.value.filter(c => (c.name || '').includes(prefix));
});

/** 点击候选项：用昵称替换 @ 前缀 */
function pickMention(c: CastUser) {
  const clean = (c.name || '').replace(/[【】\[\]]/g, '').trim();
  if (!clean) return;
  text.value = text.value.replace(/(^|\s)@[\w\u4e00-\u9fa5]*$/, `$1@${clean} `);
  // 保持焦点，方便继续输入
  ingKey.value = true;
}

function blurInput() {
  // 延迟隐藏候选，给点击预留时间（mousedown.prevent 已处理选择）
  setTimeout(() => {
    ingKey.value = false;
  }, 150);
}

/** 供父组件调用：@某用户（填入 "@昵称 "） */
function mention(nickname: string) {
  const clean = (nickname || '').replace(/[【】\[\]]/g, '').trim();
  if (!clean) return;
  if (text.value) {
    text.value = `${text.value.trim()} @${clean} `;
  } else {
    text.value = `@${clean} `;
  }
  ingKey.value = true;
}

async function send() {
  const content = text.value.trim();
  if (!content || sending.value) return;
  sending.value = true;
  const res = await sendChatMessage(
    props.roomId || store.state.liveInfo?.roomId || '',
    content,
    store.state.user?.secUid
  );
  sending.value = false;
  if (res.ok) {
    text.value = '';
    emit('sent');
    emit('tip', 'success', res.msg);
  } else {
    emit('tip', 'error', res.msg);
  }
}

defineExpose({ mention, send });
</script>

<style scoped lang="scss">
.chat-input-bar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 9px;
  background: var(--white);
  border-top: 1px solid var(--bd);
  flex-shrink: 0;
}
.chat-input {
  flex: 1;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--bd);
  border-radius: 17px;
  background: var(--bg);
  color: var(--title);
  font-size: 13px;
  outline: none;
  &:focus {
    border-color: var(--theme);
  }
  &:disabled {
    opacity: 0.6;
  }
}
.chat-send {
  height: 34px;
  padding: 0 16px;
  border: none;
  border-radius: 17px;
  background: var(--theme);
  color: var(--white);
  font-size: 12px;
  font-weight: bold;
  cursor: pointer;
  flex-shrink: 0;
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}
/* @ 用户候选浮层：锚定输入框上方 */
.mention-dropdown {
  position: absolute;
  left: 9px;
  right: 9px;
  bottom: calc(100% + 4px);
  background: var(--white);
  border: 1px solid var(--bd);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  max-height: 180px;
  overflow-y: auto;
  z-index: 210;
  padding: 4px 0;
}
.mention-title {
  padding: 4px 10px 2px;
  font-size: 10px;
  color: var(--tip);
}
.mention-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--title);
  cursor: pointer;
  &:active,
  &:hover {
    background: var(--nav-active-bg, rgba(104, 190, 141, 0.12));
  }
}
.mention-avatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  background: var(--loading-bg);
}
.mention-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mention-empty {
  padding: 8px 10px;
  font-size: 11px;
  color: var(--tip);
}
</style>