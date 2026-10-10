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
        <div v-for="cat in categoryRows" :key="cat.key" class="cat-block">
          <div class="notify-row">
            <span class="notify-icon" :class="cat.icon"></span>
            <span>{{ cat.name }}</span>
            <button
              type="button"
              class="cat-expand"
              :aria-expanded="expandedCategories[cat.key]"
              :aria-label="expandedCategories[cat.key] ? `收起${cat.name}设置` : `展开${cat.name}设置`"
              @click="toggleCategory(cat.key)"
            >
              <span class="cat-expand-icon" :class="{ expanded: expandedCategories[cat.key] }"></span>
            </button>
            <Switch v-model="settings.categories[cat.key]" @change="save" />
          </div>
          <div v-if="expandedCategories[cat.key]" class="cat-settings">
            <div class="cat-line">
              <span class="cat-label">展示</span>
              <EnumPicker :options="modeOptions" v-model="settings.categoryModes[cat.key]" @change="save" />
            </div>
            <div class="cat-line">
              <span class="cat-label">打扰</span>
              <EnumPicker :options="importanceOptions" v-model="settings.categoryImportance[cat.key]" @change="save" />
            </div>
          </div>
        </div>
        <div class="notify-hint">展示：合并=同类刷新成一条；独立=每条单独一条；按用户=同一人合并/累加。打扰：决定是否响铃、是否横幅</div>
      </div>

      <div class="notify-group">
        <div class="notify-group-title">锁屏可见性</div>
        <div class="cat-settings" style="padding: 9px 0;">
          <div class="cat-line">
            <span class="cat-label">锁屏</span>
            <EnumPicker :options="visibilityOptions" v-model="settings.lockVisibility" @change="save" />
          </div>
        </div>
        <div class="notify-hint">公开=锁屏显示全部内容；私密=锁屏只显示应用名与图标；保密=锁屏完全隐藏</div>
      </div>

      <div class="notify-group">
        <div class="notify-group-title">合并与清理设置</div>
        <div class="notify-row">
          <span class="notify-icon ice-config ice"></span>
          <span>合并间隔（秒）</span>
          <input type="number" class="notify-number" v-model.number="settings.mergeSeconds" min="0" max="60" @change="save" />
        </div>
        <div class="notify-hint">同类消息在该间隔内归并后刷新同一条通知；0 表示每条立即刷新</div>
        <div class="notify-group-title">清理设置</div>
        <div class="notify-row">
          <span class="notify-icon ice-save ice"></span>
          <span>按时间清理</span>
          <Switch v-model="settings.timeCleanupEnabled" @change="save" />
        </div>
        <div v-if="settings.timeCleanupEnabled" class="cleanup-line">
          <span>保留时长（秒）</span>
          <input type="number" class="notify-number" v-model.number="settings.autoClearSeconds" min="1" max="86400" @change="save" />
        </div>
        <div class="notify-row">
          <span class="notify-icon ice-config ice"></span>
          <span>按数量清理</span>
          <Switch v-model="settings.countCleanupEnabled" @change="save" />
        </div>
        <div v-if="settings.countCleanupEnabled" class="cleanup-line">
          <span>最多保留（条）</span>
          <input type="number" class="notify-number" v-model.number="settings.maxNotificationCount" min="1" max="10000" @change="save" />
        </div>
        <div class="notify-hint">两种清理可同时开启；关闭后对应策略不执行。清理只针对消息通知，不会删除后台保活通知。</div>
      </div>

      <div class="notify-group">
        <div class="notify-row" @click="router.push('/auto-reply')">
          <span class="notify-icon ice-cast ice"></span>
          <span>自动回复</span>
          <span class="arrow"></span>
        </div>
        <div class="notify-hint">检测弹幕关键词自动回复，需先登录账号</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppHeader from '@/components/AppHeader.vue';
import Switch from '@/components/Switch.vue';
import EnumPicker from '@/components/EnumPicker.vue';
import { notificationManager } from '@/utils/notificationManager';
import type { CatImportance, CatMode, LockVisibility, NotifyCategory } from '@/utils/notification';

const router = useRouter();
const settings = reactive(notificationManager.getSettings());
const expandedCategories = ref<Record<NotifyCategory, boolean>>({
  chat: false,
  gift: false,
  enter: false,
  follow: false,
  fansclub: false,
  like: false
});

function toggleCategory(key: NotifyCategory) {
  expandedCategories.value[key] = !expandedCategories.value[key];
}

function save() {
  notificationManager.updateSettings({ ...settings });
}

onMounted(() => {
  notificationManager.onStatusChange = save;
});

onUnmounted(() => {
  notificationManager.onStatusChange = null;
});

interface CategoryRow {
  key: NotifyCategory;
  name: string;
  icon: string;
}

/** 六类消息的展示顺序与图标（图标类用两部分，如 "ice-cast ice"） */
const categoryRows: CategoryRow[] = [
  { key: 'chat', name: '弹幕', icon: 'ice-cast ice' },
  { key: 'gift', name: '礼物', icon: 'ice-gift ice' },
  { key: 'enter', name: '进入', icon: 'ice-member ice' },
  { key: 'follow', name: '关注', icon: 'ice-member ice' },
  { key: 'fansclub', name: '粉丝团', icon: 'ice-member ice' },
  { key: 'like', name: '点赞', icon: 'ice-config ice' }
];

const modeOptions: { label: string; value: CatMode }[] = [
  { label: '合并', value: 'merge' },
  { label: '独立', value: 'independent' },
  { label: '按用户', value: 'perUser' }
];

const importanceOptions: { label: string; value: CatImportance }[] = [
  { label: '静默', value: 'min' },
  { label: '低', value: 'low' },
  { label: '中', value: 'default' },
  { label: '高', value: 'high' }
];

const visibilityOptions: { label: string; value: LockVisibility }[] = [
  { label: '公开', value: 'public' },
  { label: '私密', value: 'private' },
  { label: '保密', value: 'secret' }
];
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
.cat-expand {
  width: 28px;
  height: 28px;
  margin-right: 6px;
  padding: 0;
  border: 1px solid var(--bd);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text3);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
}
.cat-expand-icon {
  width: 7px;
  height: 7px;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  transform: rotate(45deg) translateY(-2px);
  transition: transform 0.15s ease;
}
.cat-expand-icon.expanded {
  transform: rotate(225deg) translate(-1px, -1px);
}
.cleanup-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 38px;
  padding: 4px 0 4px 30px;
  font-size: 12px;
  color: var(--text1);
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
.cat-block .cat-settings {
  padding: 0 0 9px 30px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-bottom: 1px solid var(--bd-line, var(--bd));
}
.cat-block:last-child .cat-settings {
  border-bottom: none;
}
.cat-line {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cat-label {
  width: 30px;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text3);
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
