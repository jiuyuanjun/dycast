<template>
  <div class="chat-input-bar">
    <!-- 常用语（快捷发送）面板：点击条目填充输入框；「管理」进入增删改模式 -->
    <div v-if="showQuick" class="quick-panel" @click.stop>
      <div class="quick-head">
        <span class="quick-title">常用语</span>
        <button class="quick-manage-btn" @click="toggleManage">{{ manageMode ? '完成' : '管理' }}</button>
      </div>
      <div v-if="manageMode && editingIndex < 0" class="quick-add-row">
        <input
          v-model="addDraft"
          class="quick-add-input"
          placeholder="输入新常用语，回车或点添加"
          maxlength="100"
          @keydown.enter.prevent="confirmAdd"
        />
        <button class="quick-add-btn" @click="confirmAdd">添加</button>
      </div>
      <div class="quick-list">
        <div
          v-for="(p, i) in store.state.quickPhrases"
          :key="i"
          class="quick-item"
          @click="pick(p)"
        >
          <template v-if="manageMode && editingIndex === i">
            <input
              v-model="editDraft"
              class="quick-edit-input"
              maxlength="100"
              @click.stop
              @keydown.enter.prevent="confirmEdit(i)"
              @blur="confirmEdit(i)"
            />
          </template>
          <template v-else>
            <span class="quick-item-text">{{ p }}</span>
            <button v-if="manageMode" class="quick-item-edit" @click.stop="startEdit(i)">改</button>
            <button v-if="manageMode" class="quick-item-del" @click.stop="removeAt(i)">删</button>
          </template>
        </div>
        <div v-if="!store.state.quickPhrases.length" class="quick-empty">
          {{ manageMode ? '输入上方文字后点「添加」' : '还没有常用语，点「管理」添加' }}
        </div>
      </div>
    </div>
    <input
      v-model="text"
      class="chat-input"
      :placeholder="placeholder"
      :disabled="sending || !loggedIn"
      maxlength="100"
      @keydown.enter.prevent="send"
      @focus="showQuick = false"
    />
    <button
      class="chat-quick"
      :class="{ on: showQuick }"
      :disabled="!loggedIn"
      title="常用语"
      @click.stop="toggleQuick"
    >常用</button>
    <button class="chat-send" :disabled="!canSend" @click="send">
      {{ sending ? '...' : '发送' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useStore } from '@/store';
import { sendText } from '@/core/sender';
import { CLog } from '@/utils/logUtil';

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
/** 弹幕草稿：初始从 store 恢复（横竖屏切换时另一页面写入的草稿），变更写回 store，发送成功后清空 */
const text = ref(store.state.chatDraft);
// 与 store.chatDraft 双向同步，保证横屏/竖屏两个实例共享同一份草稿
watch(text, v => store.setChatDraft(v));
const sending = ref(false);
/** 常用语面板显隐 */
const showQuick = ref(false);
/** 是否处于"管理"模式（增删改） */
const manageMode = ref(false);
/** 新增常用语草稿 */
const addDraft = ref('');
/** 编辑常用语草稿 */
const editDraft = ref('');
/** 正在编辑的条目下标（-1 表示未在编辑） */
const editingIndex = ref(-1);

/** 打开/关闭常用语面板；关闭时退出管理模式。 */
function toggleQuick() {
  showQuick.value = !showQuick.value;
  if (!showQuick.value) {
    manageMode.value = false;
    editingIndex.value = -1;
    addDraft.value = '';
  }
}
/** 切换"管理"模式：进入时清空草稿与编辑态 */
function toggleManage() {
  manageMode.value = !manageMode.value;
  editingIndex.value = -1;
  addDraft.value = '';
}
/** 点击常用语：非管理模式下填充输入框并收起面板（不直接发送，便于微调） */
function pick(p: string) {
  if (manageMode.value) return;
  text.value = p;
  showQuick.value = false;
}
/** 确认新增 */
function confirmAdd() {
  const v = addDraft.value.trim();
  if (v) store.addQuickPhrase(v);
  addDraft.value = '';
}
/** 开始编辑某条 */
function startEdit(i: number) {
  editingIndex.value = i;
  editDraft.value = store.state.quickPhrases[i] || '';
}
/** 确认修改（新值为空则删除该条）；幂等避免 blur/enter 双触发 */
function confirmEdit(i: number) {
  if (editingIndex.value !== i) return;
  store.updateQuickPhrase(i, editDraft.value);
  editingIndex.value = -1;
}
/** 删除某条 */
function removeAt(i: number) {
  store.removeQuickPhrase(i);
  // 删除的条目位于正在编辑的条目之前时，编辑索引需前移一位，否则编辑会错位覆盖别的条目
  if (editingIndex.value > i) editingIndex.value--;
  else if (editingIndex.value === i) editingIndex.value = -1;
}

const canSend = computed(() => !!text.value.trim() && !sending.value && !!props.loggedIn);

async function send() {
  const content = text.value.trim();
  if (!content || sending.value) return;
  sending.value = true;
  try {
    // 本地有 cookie 即视为已登录；secUid 尚未拉到时先实时补齐（补齐后 sender 上下文自动更新）
    let secUid = store.state.user?.secUid;
    if (!secUid) {
      const user = await store.ensureUserInfo();
      secUid = user?.secUid;
    }
    // 统一发送层：上下文（roomId/secUid/webRid）在连接成功时由 store 注入
    const res = await sendText(content);
    if (res.ok) {
      text.value = '';
      emit('sent');
      emit('tip', 'success', res.msg);
    } else {
      emit('tip', 'error', res.msg);
    }
  } finally {
    // 无论成功失败都恢复按钮，避免异常时按钮永远禁用
    sending.value = false;
  }
}

defineExpose({ send });
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
/* 常用语（快捷发送）面板 */
.quick-panel {
  position: absolute;
  left: 9px;
  right: 9px;
  bottom: calc(100% + 4px);
  background: var(--white);
  border: 1px solid var(--bd);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  max-height: 240px;
  overflow-y: auto;
  z-index: 210;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.quick-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.quick-title {
  font-size: 11px;
  color: var(--tip);
  font-weight: bold;
}
.quick-manage-btn {
  border: none;
  background: transparent;
  color: var(--theme);
  font-size: 11px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
  &:active {
    background: var(--nav-active-bg, rgba(104, 190, 141, 0.12));
  }
}
.quick-add-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.quick-add-input,
.quick-edit-input {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--bd);
  border-radius: 6px;
  background: var(--bg);
  color: var(--title);
  font-size: 12px;
  outline: none;
  &:focus {
    border-color: var(--theme);
  }
}
.quick-add-btn {
  height: 30px;
  padding: 0 12px;
  border: none;
  border-radius: 6px;
  background: var(--theme);
  color: var(--white);
  font-size: 12px;
  font-weight: bold;
  cursor: pointer;
  flex-shrink: 0;
}
.quick-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.quick-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border-radius: 6px;
  background: var(--bg);
  cursor: pointer;
  &:active,
  &:hover {
    background: var(--nav-active-bg, rgba(104, 190, 141, 0.12));
  }
}
.quick-item-text {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--title);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.quick-item-edit,
.quick-item-del {
  flex-shrink: 0;
  height: 24px;
  padding: 0 8px;
  border: none;
  border-radius: 5px;
  font-size: 11px;
  cursor: pointer;
}
.quick-item-edit {
  background: var(--nav-bg, #eef3f1);
  color: var(--theme);
}
.quick-item-del {
  background: rgba(255, 77, 79, 0.12);
  color: #ff4d4f;
}
.quick-empty {
  padding: 8px 6px;
  font-size: 11px;
  color: var(--tip);
  text-align: center;
}
/* 「常用」快捷按钮 */
.chat-quick {
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--bd);
  border-radius: 17px;
  background: var(--bg);
  color: var(--title);
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
  &.on {
    border-color: var(--theme);
    color: var(--theme);
    background: rgba(104, 190, 141, 0.12);
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}
</style>