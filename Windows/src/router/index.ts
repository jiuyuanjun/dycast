import { createRouter, createWebHashHistory } from 'vue-router';
import HomePage from '@/views/HomePage.vue';
import RoomConfirmPage from '@/views/RoomConfirmPage.vue';
import LoginPage from '@/views/LoginPage.vue';
import LoginWebviewPage from '@/views/LoginWebviewPage.vue';
import LivePage from '@/views/LivePage.vue';
import MorePage from '@/views/MorePage.vue';
import ConsolePage from '@/views/ConsolePage.vue';
import LandscapePage from '@/views/LandscapePage.vue';
import NotificationSettingsPage from '@/views/NotificationSettingsPage.vue';
import AutoReplyPage from '@/views/AutoReplyPage.vue';
import KeepAliveSettingsPage from '@/views/KeepAliveSettingsPage.vue';
import RoomSearchWebviewPage from '@/views/RoomSearchWebviewPage.vue';

const routes = [
  { path: '/', name: 'home', component: HomePage },
  { path: '/confirm', name: 'confirm', component: RoomConfirmPage },
  { path: '/login', name: 'login', component: LoginPage },
  { path: '/login-webview', name: 'login-webview', component: LoginWebviewPage },
  { path: '/live/gift-login', name: 'gift-login', component: LoginWebviewPage },
  { path: '/room-search', name: 'room-search', component: RoomSearchWebviewPage },
  { path: '/live/:tab?', name: 'live', component: LivePage },
  { path: '/more', name: 'more', component: MorePage },
  { path: '/console', name: 'console', component: ConsolePage },
  { path: '/landscape', name: 'landscape', component: LandscapePage },
  { path: '/notification-settings', name: 'notification-settings', component: NotificationSettingsPage },
  { path: '/auto-reply', name: 'auto-reply', component: AutoReplyPage },
  { path: '/keep-alive-settings', name: 'keep-alive-settings', component: KeepAliveSettingsPage }
];

const router = createRouter({
  history: createWebHashHistory(),
  routes
});

export default router;
