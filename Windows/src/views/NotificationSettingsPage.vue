<template>
  <div class="notify-page">
    <AppHeader title="通知设置" @back="router.back()" />
    <div class="notify-body">
      <div class="notify-group">
        <div class="notify-row">
          <span class="notify-icon ice-setting ice"></span>
          <span>总开关</span>
          <Switch v-model="settings.enabled" @change="save" />
        </div>
        <div class="notify-row">
          <span class="notify-icon ice-cast ice"></span>
          <span>前台时也推送</span>
          <Switch v-model="settings.foregroundEnabled" @change="save" />
        </div>
        <div class="notify-row">
          <span class="notify-icon ice-save ice"></span>
          <span>后台时推送</span>
          <Switch v-model="settings.backgroundEnabled" @change="save" />
        </div>
      </div>

      <div class="notify-group">
        <div class="notify-group-title">消息类型</div>
        <div class="notify-row">
          <span class="notify-icon ice-cast ice"></span>
          <span>弹幕</span>
          <Switch v-model="settings.categories.chat" @change="save" />
        </div>
        <div class="notify-row">
          <span class="notify-icon ice-gift ice"></span>
          <span>礼物</span>
          <Switch v-model="settings.categories.gift" @change="save" />
        </div>
        <div class="notify-row">
          <span class="notify-icon ice-member ice"></span>
          <span>进入</span>
          <Switch v-model="settings.categories.enter" @change="save" />
        </div>
        <div class="notify-row">
          <span class="notify-icon ice-member ice"></span>
          <span>关注</span>
          <Switch v-model="settings.categories.follow" @change="save" />
        </div>
        <div class="notify-row">
          <span class="notify-icon ice-member ice"></span>
          <span>粉丝团</span>
          <Switch v-model="settings.categories.fansclub" @change="save" />
        </div>
        <div class="notify-row">
          <span class="notify-icon ice-config ice"></span>
          <span>点赞</span>
          <Switch v-model="settings.categories.like" @change="save" />
        </div>
      </div>

      <div class="notify-group">
        <div class="notify-group-title">合并设置</div>
        <div class="notify-row">
          <span class="notify-icon ice-config ice"></span>
          <span>合并间隔（秒）</span>
          <input
            type="number"
            class="notify-number"
            v-model.number="settings.mergeSeconds"
            min="0"
            max="60"
            @change="save"
          />
        </div>
        <div class="notify-hint">0 表示不合并，每条消息单独通知</div>
        <div class="notify-row">
          <span class="notify-icon ice-save ice"></span>
          <span>自动清理消息（秒）</span>
          <input
            type="number"
            class="notify-number"
            v-model.number="settings.autoClearSeconds"
            min="0"
            max="3600"
            @change="save"
          />
        </div>
        <div class="notify-hint">每隔该秒数自动清空一次通知栏，避免通知堆积过多后系统不再显示新通知。0 表示不清理</div>
      </div>

      <div class="notify-group">
        <div class="notify-row" @click="router.push('/auto-reply')">
          <span class="notify-icon ice-cast ice"></span>
          <span>自动回复</span>
          <span class="arrow"></span>
        </div>
        <div class="notify-hint">检测弹幕关键词自动回复（含 @ 用户），需先登录账号</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, reactive } from 'vue';
import { useRouter } from 'vue-router';
import AppHeader from '@/components/AppHeader.vue';
import Switch from '@/components/Switch.vue';
import { notificationManager } from '@/utils/notificationManager';

const router = useRouter();
const settings = reactive(notificationManager.getSettings());

function save() {
  notificationManager.updateSettings({ ...settings });
}

onMounted(() => {
  notificationManager.onStatusChange = save;
});

onUnmounted(() => {
  notificationManager.onStatusChange = null;
});
</script>

<style scoped lang="scss">
.notify-page {
  position: absolute;
  inset: 0;
  background: var(--bg);
  z-index: 40;
  display: flex;
  flex-direction: column;
}
.notify-body {
  flex: 1;
  overflow-y: auto;
  padding: 9px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.notify-group {
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
.notify-number {
  width: 60px;
  height: 28px;
  border: 1px solid var(--bd);
  border-radius: 4px;
  text-align: center;
  background: var(--bg);
  color: var(--text1);
}
.notify-hint {
  font-size: 11px;
  color: var(--text3);
  padding: 6px 0 9px;
}
.arrow {
  width: 8px;
  height: 8px;
  border-top: 2px solid var(--text3);
  border-right: 2px solid var(--text3);
  transform: rotate(45deg);
}
.status-badge {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: bold;
}
.status-badge.ok {
  color: var(--theme);
  background: var(--nav-active-bg, rgba(104, 190, 141, 0.15));
}
.status-badge.off {
  color: var(--text3);
  background: var(--loading-bg, rgba(128, 128, 128, 0.12));
}
</style>
