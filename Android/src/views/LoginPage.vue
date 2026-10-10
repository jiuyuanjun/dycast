<template>
  <div class="page">
    <AppHeader title="登录抖音账号" @back="router.back()" />
    <div class="page-body center" :class="{ 'is-landscape': isLandscape }">
      <div style="display:flex;flex-direction:column;align-items:center;width:100%;">
        <div class="key-icon"><i class="ice-keya ice"></i></div>
        <p class="tip-text">登录抖音账号后才可显示礼物信息</p>
      </div>
      <div class="login-actions" style="width:100%;margin-top:18px;">
        <button class="btn" @click="router.push('/login-webview')">抖音扫码 / 网页登录</button>
        <div class="skip-row">
          <span class="skip-link" @click="skip">跳过，稍后登录</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import AppHeader from '@/components/AppHeader.vue';
import { useLandscape } from '@/composables/useOrientation';

const router = useRouter();
const isLandscape = useLandscape();
function skip() {
  router.push('/live');
}
</script>

<style scoped lang="scss">
.page {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.page-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
}
.page-body.center {
  justify-content: center;
  align-items: center;
}
/* 横屏：登录动作区收窄居中 */
.page-body.center.is-landscape .login-actions {
  width: 280px !important;
  max-width: 60%;
}
.key-icon {
  width: 46px;
  height: 46px;
  margin: 16px auto 10px;
  background: var(--white);
  border: 2px solid var(--theme);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  color: var(--theme);
}
.tip-text {
  text-align: center;
  color: var(--text);
  font-size: 11px;
  line-height: 1.5;
  margin-bottom: 14px;
}
.skip-row {
  text-align: center;
  margin-top: auto;
  padding-top: 10px;
}
.skip-link {
  color: var(--tip);
  font-size: 10px;
  text-decoration: underline;
  cursor: pointer;
}
.btn {
  width: 100%;
  padding: 8px;
  border: none;
  border-radius: 6px;
  background: var(--theme);
  color: var(--white);
  font-size: 12px;
  font-weight: bold;
  cursor: pointer;
}
</style>
