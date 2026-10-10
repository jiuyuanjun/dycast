import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import os from 'os';

function copyStaticAssets() {
  return {
    name: 'copy-static-assets',
    closeBundle() {
      const files = ['mssdk.js'];
      for (const file of files) {
        try {
          const dest = `./dist/${file}`;
          mkdirSync(dirname(dest), { recursive: true });
          copyFileSync(file, dest);
          console.log(`[copy-static-assets] copied ${file} -> ${dest}`);
        } catch (e) {
          console.warn(`[copy-static-assets] failed to copy ${file}:`, e);
        }
      }
    }
  };
}

function getLanIp(): string | undefined {
  for (const interfaces of Object.values(os.networkInterfaces())) {
    if (!interfaces) continue;
    for (const iface of interfaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return undefined;
}

const lanIp = getLanIp();

export default defineConfig({
  clearScreen: false,
  plugins: [vue(), copyStaticAssets()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '0.0.0.0',
    watch: {
      ignored: ['**/src-tauri/**', '**/node_modules/**', '**/.git/**'],
    },
    hmr: lanIp
      ? {
          protocol: 'ws',
          host: lanIp,
          port: 5173,
          clientPort: 5173,
        }
      : undefined,
  },
  build: {
    outDir: './dist',
    emptyOutDir: true,
    target: 'es2020',
  },
});
