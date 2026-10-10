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
import {
  applyHotUpdate,
  checkHotUpdate,
  getActiveHotVersion,
  rollbackHotUpdate,
  type HotCheckInfo
} from '@/utils/hotUpdate';
import { showGlobalTip } from '@/utils/globalTip';

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

// ---------- 热更新（小功能/bug 修复免装 APK） ----------
const hotVersion = ref<string | null>(null);
/** 已检查到、等待用户确认安装的热更 */
const hotPending = ref<HotCheckInfo | null>(null);
const hotBusy = ref(false);

const hotLabel = computed(() => {
  if (hotBusy.value) return '热更新处理中…';
  if (hotPending.value?.available && hotPending.value.version) {
    return `安装热更 ${hotPending.value.version}（点击）`;
  }
  return hotVersion.value ? `热更新 ${hotVersion.value}（点击检查新热更）` : '检查热更新';
});

onMounted(async () => {
  appVersion.value = await getCurrentVersion();
  hotVersion.value = getActiveHotVersion();
  // 静默预检：进入设置页即知道有没有新热更（失败不打扰）
  checkHotUpdate()
    .then(info => {
      if (info.available && info.version) hotPending.value = info;
      if (info.incompatible) hotVersion.value = null;
    })
    .catch(() => {});
});

async function runHotItem() {
  if (hotBusy.value) return;
  hotBusy.value = true;
  try {
    // 已检查到新热更：本次点击执行安装（用检查成功的同一清单地址，主备渠道一致）
    if (hotPending.value?.available && hotPending.value.version) {
      showGlobalTip('正在下载热更新包…', false, 6000);
      const applied = await applyHotUpdate(hotPending.value.sourceUrl);
      hotVersion.value = applied.version;
      hotPending.value = null;
      showGlobalTip(`热更新 ${applied.version} 已就绪，正在重启应用…`, false, 6000);
      setTimeout(() => location.reload(), 900);
      return;
    }
    showGlobalTip('正在检查热更新…', false, 4000);
    const info = await checkHotUpdate();
    if (info.error) {
      showGlobalTip(`检查失败：${info.error}`, true);
      return;
    }
    if (info.incompatible) {
      hotPending.value = null;
      hotVersion.value = null;
      showGlobalTip('当前热更与新版应用不匹配，已回退内置资源', true);
      return;
    }
    if (info.available && info.version) {
      hotPending.value = info;
      showGlobalTip(`发现热更 ${info.version}：${info.notes || '无更新说明'}，再次点击完成安装`, false, 6000);
    } else {
      hotPending.value = null;
      showGlobalTip(`热更新已是最新${info.currentHot ? `（${info.currentHot}）` : ''}`);
    }
  } catch (e) {
    showGlobalTip(`热更新失败：${(e as Error)?.message || e}`, true);
  } finally {
    hotBusy.value = false;
  }
}

async function runHotRollback() {
  if (hotBusy.value) return;
  hotBusy.value = true;
  try {
    await rollbackHotUpdate();
    hotVersion.value = null;
    hotPending.value = null;
    showGlobalTip('已回滚热更新，正在重启…', false, 6000);
    setTimeout(() => location.reload(), 900);
  } catch (e) {
    showGlobalTip(`回滚失败：${(e as Error)?.message || e}`, true);
  } finally {
    hotBusy.value = false;
  }
}

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
      // 账号操作收进二级菜单（/account），避免在设置页误触导致登录状态丢失
      { icon: 'ice-keya', label: '账号管理（登录/更换/退出）', to: '/account' }
    ]
  },
  {
    key: 'about',
    label: '关于',
    icon: 'ice-stat',
    items: [
      { icon: 'ice-save', label: hotLabel.value, action: runHotItem },
      ...(hotVersion.value
        ? [{ icon: 'ice-close', label: '回滚热更新（恢复内置资源）', action: runHotRollback }]
        : []),
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
