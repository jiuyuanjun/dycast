<template>
  <router-view />
  <UpdateDialog auto />
  <LiveEndDialog />
  <KeepAliveGuideDialog />
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import UpdateDialog from '@/components/UpdateDialog.vue';
import LiveEndDialog from '@/components/LiveEndDialog.vue';
import KeepAliveGuideDialog from '@/components/KeepAliveGuideDialog.vue';
import { useStore } from '@/store';
import { printInfo, printSKMCJ } from '@/utils/logUtil';

const store = useStore();

// 启动时自动恢复上次登录会话：用户登录过一次后，后续打开不再要求重新登录
onMounted(() => {
  store.restoreSession();
  // 挂载断线自动重连：回前台时若连接中断自动恢复（保活增强，配合后台 5 分钟断连问题）
  store.initAutoReconnect();
});

setTimeout(() => {
  console?.clear();
  printSKMCJ();
  printInfo();
}, 1500);
</script>
