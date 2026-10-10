<template>
  <div class="more-page">
    <AppHeader title="设置" @back="router.back()" />
    <!-- 竖屏：分组列表 -->
    <div v-if="!isLandscape" class="more-page-body">
      <div v-for="group in groups" :key="group.key" class="more-group">
        <div class="more-group-title">{{ group.label }}</div>
        <div
          v-for="item in group.items"
          :key="item.label"
          class="more-item"
          @click="handleItem(item)">
          <span class="icon" :class="[item.icon, 'ice']"></span>
          <span>{{ item.label }}</span>
          <span class="arrow"></span>
        </div>
      </div>
    </div>
    <!-- 横屏：一级 / 二级菜单 -->
    <div v-else class="ls-settings-body">
      <div class="ls-settings-nav">
        <div
          v-for="group in groups"
          :key="group.key"
          class="ls-settings-nav-item"
          :class="{ active: group.key === activeGroup }"
          @click="activeGroup = group.key">
          <span class="notify-icon" :class="[group.icon, 'ice']"></span>
          <span>{{ group.label }}</span>
        </div>
      </div>
      <div class="ls-settings-detail">
        <div class="more-group">
          <div class="more-group-title">{{ activeGroupData.label }}</div>
          <div
            v-for="item in activeGroupData.items"
            :key="item.label"
            class="more-item"
            @click="handleItem(item)">
            <span class="icon" :class="[item.icon, 'ice']"></span>
            <span>{{ item.label }}</span>
            <span v-if="!item.label.startsWith('当前版本')" class="arrow"></span>
          </div>
        </div>
      </div>
    </div>
    <UpdateDialog ref="updateDialogRef" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppHeader from '@/components/AppHeader.vue';
import UpdateDialog from '@/components/UpdateDialog.vue';
import { useStore } from '@/store';
import { useLandscape } from '@/composables/useOrientation';
import { getCurrentVersion } from '@/utils/updater';

type GroupKey = 'tools' | 'notify' | 'account' | 'about';

interface MoreItem {
  icon: string;
  label: string;
  to?: string;
  action?: () => void;
}

const router = useRouter();
const store = useStore();
const isLandscape = useLandscape();
const activeGroup = ref<GroupKey>('tools');

const updateDialogRef = ref<InstanceType<typeof UpdateDialog> | null>(null);
const appVersion = ref('');

async function checkUpdateManually() {
  await updateDialogRef.value?.check(true);
}

onMounted(async () => {
  appVersion.value = await getCurrentVersion();
});

const groups = computed<{ key: GroupKey; label: string; icon: string; items: MoreItem[] }[]>(() => [
  {
    key: 'tools',
    label: '工具',
    icon: 'ice-stat',
    items: [
      { icon: 'ice-stat', label: '控制台', to: '/console' }
    ]
  },
  {
    key: 'notify',
    label: '通知',
    icon: 'ice-msg',
    items: [
      { icon: 'ice-msg', label: '通知设置', to: '/notification-settings' },
      { icon: 'ice-stat', label: '后台保活', to: '/keep-alive-settings' }
    ]
  },
  {
    key: 'account',
    label: '账号',
    icon: 'ice-keya',
    items: [
      { icon: 'ice-keya', label: '登录 / 更换账号', to: '/login-webview' },
      { icon: 'ice-close', label: '退出房间', action: exitRoom }
    ]
  },
  {
    key: 'about',
    label: '关于',
    icon: 'ice-stat',
    items: [
      { icon: 'ice-config', label: `当前版本 ${appVersion.value}（点击检查更新）`, action: checkUpdateManually }
    ]
  }
]);

const activeGroupData = computed(() => groups.value.find(g => g.key === activeGroup.value) || groups.value[0]);

function handleItem(item: MoreItem) {
  if (item.action) {
    item.action();
    return;
  }
  if (item.to) {
    router.push(item.to);
  }
}

/** 退出房间：断开连接 + 清空房间信息 + 保留登录态 + 回首页（最近进入记录保留） */
function exitRoom() {
  store.exitRoom();
  router.replace('/');
}
</script>

<style scoped lang="scss">
.more-page {
  position: absolute;
  inset: 0;
  background: var(--bg);
  z-index: 35;
  display: flex;
  flex-direction: column;
}
.more-page-body {
  flex: 1;
  overflow-y: auto;
  padding: 9px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.more-group {
  background: var(--white);
  border: 1px solid var(--bd);
  border-radius: 6px;
  overflow: hidden;
}
.more-group-title {
  padding: 6px 8px;
  font-size: 10px;
  color: var(--tip);
  border-bottom: 1px solid var(--bd);
}
.more-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 8px;
  font-size: 11px;
  color: var(--title);
  border-bottom: 1px solid rgba(178, 191, 195, 0.3);
  cursor: pointer;
}
.more-item:last-child { border-bottom: none; }
.more-item .icon {
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
}
.more-item .arrow {
  margin-left: auto;
  color: var(--tip);
  font-family: "castfont";
  font-style: normal;
}
.more-item .arrow:before { content: "\e77e"; }

/* 横屏：一级 / 二级菜单 */
.ls-settings-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.ls-settings-nav {
  width: 150px;
  flex-shrink: 0;
  border-right: 1px solid var(--bd);
  background: var(--white);
  overflow-y: auto;
}
.ls-settings-nav-item {
  padding: 11px 12px;
  font-size: 11px;
  color: var(--title);
  cursor: pointer;
  border-bottom: 1px solid rgba(178, 191, 195, 0.3);
  display: flex;
  align-items: center;
  gap: 7px;
}
.ls-settings-nav-item.active {
  color: var(--theme);
  background: var(--nav-active-bg);
  font-weight: bold;
}
.ls-settings-detail {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}
.ls-settings-detail .more-group {
  max-width: 320px;
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
  flex-shrink: 0;
}
</style>
