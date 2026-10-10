import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const android = resolve(root, '..', 'Android');
const publicDir = resolve(root, 'public');
const assetsDir = resolve(publicDir, 'preview-assets');
await mkdir(assetsDir, { recursive: true });

// 打包浏览器可加载的真实核心（DyCast / getLiveInfo / 签名 / protobuf）
await build({
  absWorkingDir: root,
  entryPoints: [resolve(root, 'scripts/preview-runtime-entry.ts')],
  outfile: resolve(publicDir, 'preview-runtime.js'),
  bundle: true,
  format: 'iife',
  globalName: 'DyCastPreviewRuntime',
  platform: 'browser',
  target: 'es2020',
  plugins: [{
    name: 'preview-tauri-bridge',
    setup(build) {
      build.onResolve({ filter: /(?:^|[\\/])utils[\\/]tauriBridge\.ts$/ }, args => {
        if (args.importer.includes(`${resolve(root, 'src')}`)) {
          return { path: resolve(root, 'scripts/preview-tauri-bridge.ts') };
        }
        return undefined;
      });
    }
  }],
  alias: { '@': resolve(root, 'src') }
});

// 复制 castfont 图标字体与应用图标到 public，解决注入副本中相对路径失效导致的图标缺失
await copyFile(resolve(root, 'src/assets/font/castfont.ttf'), resolve(assetsDir, 'castfont.ttf'));
await copyFile(resolve(android, 'app-icon.png'), resolve(assetsDir, 'app-icon.png'));

const sourceHtml = await readFile(resolve(android, 'pages/android-ui-preview.html'), 'utf8');
const controller = await readFile(resolve(root, 'scripts/preview-real-controller.js'), 'utf8');

let injected = sourceHtml
  .replace("url('../src/assets/font/castfont.ttf')", "url('/preview-assets/castfont.ttf')")
  .replaceAll('src="../app-icon.png"', 'src="/preview-assets/app-icon.png"')
  .replace('</head>', '  <script src="/mssdk.js"></script>\n  <script src="/preview-runtime.js"></script>\n</head>')
  .replace('</body>', `  <script>${controller.replace(/<\/script/gi, '<\\/script')}</script>\n</body>`);

await writeFile(resolve(publicDir, 'android-ui-preview.html'), injected, 'utf8');
console.log('preview runtime + mssdk + controller + assets injected into Windows/public/android-ui-preview.html');