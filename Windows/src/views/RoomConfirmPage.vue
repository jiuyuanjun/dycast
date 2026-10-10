<template>
  <div class="page">
    <AppHeader title="确认主播" @back="router.back()" />
    <div class="page-body" :class="{ 'is-landscape': isLandscape }">
      <div class="confirm-media">
        <div class="cover-box">
          <img v-if="cover" :src="cover" alt="封面" />
          <span v-else>暂无封面</span>
        </div>
        <div class="cover-title">{{ title || '***' }}</div>
      </div>
      <div class="confirm-info">
        <div class="info-row"><span class="k">主播</span><span class="v">{{ nickname || '***' }}</span></div>
        <div class="info-row">
          <span class="k">直播状态</span>
          <span class="v" :style="isLiving ? {} : { color: 'var(--error)', fontWeight: 'bold' }">
            <span v-if="isLiving" class="live-badge">直播中</span>
            <span v-else>未开播</span>
          </span>
        </div>
        <div class="info-row"><span class="k">主播粉丝数</span><span class="v">{{ followCount }}</span></div>
        <div class="info-row"><span class="k">在线观众数</span><span class="v">{{ memberCount }}</span></div>
        <div class="info-row"><span class="k">累计观看人数</span><span class="v">{{ totalUserCount }}</span></div>
        <div class="info-row"><span class="k">本场点赞数</span><span class="v">{{ likeCount }}</span></div>
        <div class="confirm-actions">
          <button v-if="isLiving" class="btn" @click="confirm">确认正确，进入下一步</button>
          <button class="btn secondary" @click="router.back()">返回修改</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppHeader from '@/components/AppHeader.vue';
import { useStore } from '@/store';
import { useLandscape } from '@/composables/useOrientation';
import { RoomStatus } from '@/core/dycast';

const router = useRouter();
const route = useRoute();
const store = useStore();
const isLandscape = useLandscape();
const roomNum = computed(() => String(route.query.room || ''));

const info = computed(() => store.state.liveInfo);
const cover = computed(() => info.value?.cover || '');
const title = computed(() => info.value?.title || '');
const nickname = computed(() => info.value?.nickname || '');
const isLiving = computed(() => info.value?.status === RoomStatus.LIVING);

const fmt = (v?: string | number) => (v === undefined || v === null || v === '' ? '-' : String(v));
const followCount = computed(() => fmt(info.value?.followCount));
const memberCount = computed(() => fmt(info.value?.audienceCount));
const totalUserCount = computed(() => fmt(info.value?.totalUserCount));
const likeCount = computed(() => fmt(info.value?.likeCount));

onMounted(async () => {
  if (!roomNum.value) {
    router.replace('/');
    return;
  }
  try {
    await store.fetchRoomInfo(roomNum.value);
  } catch (e) {
    store.addConsole({ level: 'error', tag: '房间信息', content: `获取失败: ${(e as Error).message || e}` });
  }
});

function confirm() {
  store.setRoomInput(roomNum.value);
  store.setRoomNum(roomNum.value);
  router.push('/login');
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
/* 横屏双栏：左侧封面 + 右侧数据与操作 */
.page-body.is-landscape {
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 28px;
  padding: 10px 32px;
}
.page-body.is-landscape .confirm-media {
  flex: 0 0 320px;
}
.page-body.is-landscape .confirm-info {
  flex: 0 1 360px;
  min-width: 0;
}
.cover-box {
  width: 100%;
  aspect-ratio: 16 / 9;
  background: var(--loading-bg);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--tip);
  font-size: 11px;
  margin-bottom: 6px;
  overflow: hidden;
}
.cover-box img { width: 100%; height: 100%; object-fit: cover; }
.cover-title {
  text-align: center;
  font-weight: bold;
  margin-bottom: 8px;
  color: var(--title);
  font-size: 12px;
}
.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 0;
  border-bottom: 1px solid rgba(178, 191, 195, 0.4);
  font-size: 11px;
}
.info-row .k { font-weight: bold; color: var(--title); }
.info-row .v { color: var(--text); }
.confirm-actions {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
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
.btn.secondary {
  background: var(--white);
  color: var(--text);
  border: 1px solid var(--bd);
}
.live-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--theme);
  font-weight: bold;
  font-size: 11px;
}
.live-badge::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--theme);
}
</style>
