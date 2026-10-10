<template>
  <router-view />
  <UpdateDialog auto />
  <LiveEndDialog />
  <KeepAliveGuideDialog />
  <GlobalTip />
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import UpdateDialog from '@/components/UpdateDialog.vue';
import LiveEndDialog from '@/components/LiveEndDialog.vue';
import KeepAliveGuideDialog from '@/components/KeepAliveGuideDialog.vue';
import GlobalTip from '@/components/GlobalTip.vue';
import { useStore } from '@/store';
import { notificationManager } from '@/utils/notificationManager';
import { checkHotUpdate, getActiveHotVersion } from '@/utils/hotUpdate';
import { printInfo, printSKMCJ } from '@/utils/logUtil';

const store = useStore();

// 启动时自动恢复上次登录会话：用户登录过一次后，后续打开不再要求重新登录
onMounted(() => {
  store.restoreSession();
  // 挂载断线自动重连：回前台时若连接中断自动恢复（保活增强，配合后台 5 分钟断连问题）
  store.initAutoReconnect();
  // 保活服务契约：只在连接直播间期间存活。
  // 启动时（未进直播间）先停掉上次进程可能遗留的前台服务与常驻通知；
  // 连接成功后由 store 的 cast.on('open') → init() 按"后台保活"开关拉起。
  notificationManager.startup();
  // APK 升级后旧热更失配：启动即检测并回退内置资源。
  // 只在本次启动实际加载了热更（BOOT_KEY 存在）时才需要 reload，
  // checkHotUpdate 内部会清掉失配标记，reload 后引导脚本走内置资源，不会循环。
  if (getActiveHotVersion()) {
    checkHotUpdate()
      .then(info => {
        if (info.incompatible) location.reload();
      })
      .catch(() => {});
  }
});

setTimeout(() => {
  console?.clear();
  printSKMCJ();
  printInfo();
}, 1500);
</script>
