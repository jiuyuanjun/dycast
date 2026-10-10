<template>
  <div class="ar-page">
    <AppHeader title="自动回复" @back="router.back()" />
    <div class="ar-body">
      <div class="ar-group">
        <div class="notify-row">
          <span class="notify-icon ice-stat ice"></span>
          <span>开启自动回复</span>
          <Switch v-model="settings.autoReplyEnabled" :disabled="!isLoggedIn" @change="save" />
        </div>
        <div class="notify-hint">
          检测到弹幕命中下方关键词时，自动发送对应回复。同一用户 15 秒内只回复一次，避免刷屏。
        </div>
        <div class="room-scope" :class="{ on: !!currentRoom }">
          <span class="room-scope-label">规则作用房间</span>
          <span class="room-scope-value">{{ currentRoom || '未连接直播间' }}</span>
        </div>
        <div class="notify-hint" style="border:none;">规则按直播间独立保存：连接哪个直播间，这里就显示并生效哪个直播间的规则。</div>
        <div v-if="!isLoggedIn" class="login-tip">
          <span>自动回复需要登录抖音账号后才能使用</span>
          <button class="btn" @click="router.push('/login-webview')">去登录</button>
        </div>
      </div>

      <div class="ar-group">
        <div class="notify-group-title">回复规则</div>
        <div
          v-for="(rule, idx) in settings.autoReplyRules"
          :key="idx"
          class="rule-row">
          <input
            v-model="rule.keyword"
            class="rule-input"
            placeholder="触发关键词（如：你好）"
            @change="save" />
          <input
            v-model="rule.reply"
            class="rule-input"
            placeholder="回复内容"
            @change="save" />
          <button class="rule-del" title="删除" @click="removeRule(idx)">×</button>
        </div>
        <div class="notify-row" @click="addRule">
          <span class="notify-icon ice-add ice"></span>
          <span>添加规则</span>
          <span class="arrow"></span>
        </div>
        <div class="notify-hint">提示：命中关键词后自动发送对应回复，需先登录抖音账号才能发送。</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue';
import { useRouter } from 'vue-router';
import AppHeader from '@/components/AppHeader.vue';
import Switch from '@/components/Switch.vue';
import { notificationManager } from '@/utils/notificationManager';
import { useStore } from '@/store';

const router = useRouter();
const store = useStore();
const settings = reactive(notificationManager.getSettings());
/** 自动回复必须先登录：未登录时禁用开关 */
const isLoggedIn = computed(() => store.isLoggedIn.value);
/** 当前连接的直播间（自动回复按房间隔离） */
const currentRoom = computed(() => notificationManager.getCurrentRoom() || store.state.roomNum || '');

function save() {
  // 兜底：未登录时即使意外触发也不允许启用自动回复
  if (!isLoggedIn.value) settings.autoReplyEnabled = false;
  notificationManager.updateSettings({ ...settings });
}

function addRule() {
  settings.autoReplyRules.push({ keyword: '', reply: '' });
  save();
}

function removeRule(idx: number) {
  settings.autoReplyRules.splice(idx, 1);
  save();
}
</script>

<style scoped lang="scss">
.ar-page {
  position: absolute;
  inset: 0;
  background: var(--bg);
  z-index: 40;
  display: flex;
  flex-direction: column;
}
.ar-body {
  flex: 1;
  overflow-y: auto;
  padding: 9px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ar-group {
  background: var(--white);
  border: 1px solid var(--bd);
  border-radius: 6px;
  padding: 0 9px;
}
.notify-group-title {
  font-size: 12px;
  color: var(--text3);
  padding: 9px 0 3px;
  border-bottom: 1px solid var(--bd);
}
.notify-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 40px;
  padding: 9px 0;
  font-size: 14px;
  color: var(--text1);
  border-bottom: 1px solid var(--bd-line, var(--bd));
  &:last-child {
    border-bottom: none;
  }
}
.notify-icon {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  background: var(--bg);
  border: 1px solid var(--bd);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--theme);
  font-family: "castfont";
  font-style: normal;
  margin-right: 8px;
  flex-shrink: 0;
}
.notify-row span:nth-child(2) {
  flex: 1;
}
.notify-hint {
  font-size: 11px;
  color: var(--text3);
  padding: 6px 0 9px;
}
.login-tip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 0 10px;
  font-size: 11px;
  color: var(--text3);
}
.room-scope {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 0;
  border-top: 1px solid var(--bd-line, var(--bd));
}
.room-scope-label {
  font-size: 11px;
  color: var(--text3);
}
.room-scope-value {
  font-size: 11px;
  font-weight: bold;
  color: var(--text3);
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.room-scope.on .room-scope-value {
  color: var(--theme);
}
.login-tip .btn {
  flex-shrink: 0;
  padding: 5px 12px;
  border: none;
  border-radius: 6px;
  background: var(--theme);
  color: var(--white);
  font-size: 11px;
  font-weight: bold;
  cursor: pointer;
}
.rule-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 0;
  border-bottom: 1px solid var(--bd-line, var(--bd));
}
.rule-input {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--bd);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text1);
  font-size: 12px;
}
.rule-del {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 4px;
  background: var(--error, #e24b4a);
  color: var(--white);
  font-size: 15px;
  cursor: pointer;
  flex-shrink: 0;
  line-height: 1;
}
.arrow {
  width: 8px;
  height: 8px;
  border-top: 2px solid var(--text3);
  border-right: 2px solid var(--text3);
  transform: rotate(45deg);
  flex-shrink: 0;
}
</style>