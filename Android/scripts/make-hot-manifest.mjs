/**
 * 生成热更新发布物：扫描 dist/ 构建产物，生成 manifest.json 并拷贝文件到 hot-bundle/files/。
 *
 * 用法（先 npm run build）：
 *   node scripts/make-hot-manifest.mjs --base https://github.com/jiuyuanjun/dycast/releases/download/v1.4.0-hot/ --notes "修复在线观众榜"
 *   可选 --version 1.4.0.1（默认取 package.json 版本 + ".1"）
 *
 * 热更版本必须以当前应用版本为前缀（app 1.4.0 → 热更 1.4.0.x），否则 App 会判定失配拒绝安装。
 *
 * 发布（全部走 GitHub Releases 资产直链，绕开国内不稳的 raw.githubusercontent.com）：
 *   gh release create vX.Y.Z-hot --repo jiuyuanjun/dycast --target public-clean --title "vX.Y.Z-hot"
 *   gh release upload vX.Y.Z-hot --repo jiuyuanjun/dycast --clobber hot-bundle/files/* hot-bundle/manifest.json
 *   清单地址见 src/utils/hotUpdate.ts 的 HOT_MANIFEST_URL（指向 releases/download/vX.Y.Z-hot/manifest.json）。
 * 注意：mssdk.js 在 index.html 头部单独加载、不走热更引导，托管目录中无需包含也能正常启动。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const distDir = path.join(projectRoot, 'dist');
const outDir = path.join(projectRoot, 'hot-bundle');
const filesDir = path.join(outDir, 'files');

// ---------- 简易参数解析 ----------
const argMap = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      argMap[key] = next;
      i++;
    } else {
      argMap[key] = true;
    }
  }
}

if (!fs.existsSync(distDir)) {
  console.error('未找到 dist/，请先执行 npm run build');
  process.exit(1);
}
if (!argMap.base || typeof argMap.base !== 'string') {
  console.error('缺少 --base <URL>（文件托管地址前缀，需以 / 结尾），例如：\n'
    + '  node scripts/make-hot-manifest.mjs --base https://github.com/jiuyuanjun/dycast/releases/download/v1.4.0-hot/');
  process.exit(1);
}
const base = argMap.base.endsWith('/') ? argMap.base : `${argMap.base}/`;

const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const version = (typeof argMap.version === 'string' && argMap.version) || `${pkg.version}.1`;
const notes = (typeof argMap.notes === 'string' && argMap.notes) || '';

// ---------- 递归收集 dist 文件 ----------
// mssdk.js 必须排除：它由内置 index.html 头部 <script> 加载（热更引导不替换、运行时始终用
// APK 内置版本），不随热更资源发布，避免覆盖内置签名 SDK。
const EXCLUDE_FILES = new Set(['mssdk.js']);

function walk(dir, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...walk(path.join(dir, entry.name), relPath));
    } else if (entry.isFile()) {
      if (EXCLUDE_FILES.has(entry.name)) continue;
      out.push(relPath);
    }
  }
  return out;
}

const relFiles = walk(distDir).sort();
if (!relFiles.includes('index.html')) {
  console.error('dist/ 中没有 index.html，构建产物异常');
  process.exit(1);
}

// ---------- 输出 ----------
fs.rmSync(filesDir, { recursive: true, force: true });
fs.mkdirSync(filesDir, { recursive: true });

const files = relFiles.map(rel => {
  fs.mkdirSync(path.dirname(path.join(filesDir, rel)), { recursive: true });
  fs.copyFileSync(path.join(distDir, rel), path.join(filesDir, rel));
  return { path: rel, url: base + rel.split('/').map(encodeURIComponent).join('/') };
});

const manifest = { version, notes, files };
const manifestPath = path.join(outDir, 'manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

console.log(`热更版本: ${version}`);
console.log(`文件托管前缀: ${base}`);
console.log(`已生成 ${files.length} 个文件 -> ${filesDir}`);
console.log(`清单 -> ${manifestPath}`);
console.log('\n发布步骤：');
console.log(`  1. 把 files/ 目录内容按原相对路径上传到 ${base}`);
console.log('  2. 把 manifest.json 上传/覆盖到清单地址（GitHub 仓库 hot/manifest.json，public-clean 分支）');
console.log('  3. App「设置 → 关于 → 检查热更新」即可拉取安装');
