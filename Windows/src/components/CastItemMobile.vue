<template>
  <div class="cast-item" :class="method" @click="emit('click')">
    <template v-if="method === CastMethod.GIFT && gift">
      <span class="user">{{ userName }}</span>
      <span class="gift-text"> 送出了 </span>
      <img v-if="gift.icon" class="gift-icon" :src="gift.icon" :alt="gift.name || '礼物'" />
      <span v-else class="gift-text">{{ gift.name || '礼物' }}</span>
      <span class="gift-amount">×{{ gift.count || 1 }}</span>
    </template>
    <template v-else-if="method === CastMethod.EMOJI_CHAT">
      <span class="user">{{ userName }}：</span>
      <img v-if="content" class="gift-icon" :src="content" alt="表情" />
    </template>
    <template v-else>
      <span class="user">{{ userName }}</span>
      <span v-if="method === CastMethod.MEMBER" class="social-tag"> 进入直播间</span>
      <span v-else-if="method === CastMethod.SOCIAL" class="social-tag"> 关注了主播</span>
      <span v-else-if="method === CastMethod.FANSCLUB" class="social-tag"> 加入粉丝团</span>
      <span v-else-if="method === CastMethod.LIKE" class="social-tag"> 为主播点赞了({{ content }})</span>
      <template v-else>
        <span class="sep">：</span>
        <span class="msg">{{ content }}</span>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { CastMethod, type CastUser, type CastGift } from '@/core/dycast';
import { computed } from 'vue';
interface Props {
  method?: CastMethod;
  user?: CastUser;
  gift?: CastGift;
  content?: string;
}
const props = defineProps<Props>();
const emit = defineEmits<{ (e: 'click'): void }>();
const userName = computed(() => props.user?.name || '未知用户');
</script>

<style scoped lang="scss">
.cast-item {
  padding: 3px 0;
  font-size: 10px;
  border-bottom: 1px solid rgba(178,191,195,0.25);
  line-height: 1.4;
  word-break: break-all;
}
.cast-item:last-child { border-bottom: none; }
.user { color: var(--theme); font-weight: bold; }
.sep { color: var(--text); }
.msg { color: var(--title); }
.gift-icon { width: 14px; height: 14px; vertical-align: middle; margin: 0 2px; object-fit: contain; }
.gift-amount { color: var(--gold); font-weight: bold; vertical-align: middle; font-size: 11px; }
.gift-text { color: #eba825; }
.social-tag { color: var(--link); font-size: 9px; }
</style>
