/**
 * DyCast Android APK 签名脚本（通用版）
 * 用法：
 *   node scripts/sign-apk.cjs                              # 自动定位构建产物
 *   node scripts/sign-apk.cjs --src <apk路径>              # 指定源 APK（优先）
 *   node scripts/sign-apk.cjs --name dycast-1.1.13-arm64.apk   # 指定输出文件名
 *
 * 流程：定位构建产物 → zipalign 对齐 → apksigner 签名（dycast-release-new.keystore）
 *      → 校验签名与 APK 内前端资源 → 输出到 output/ 目录
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BT = path.join(process.env.LOCALAPPDATA || '', 'Android/Sdk/build-tools/37.0.0');
const DEFAULT_SRC = path.join(
  ROOT,
  'src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk'
);
const OUTPUT_DIR = path.join(ROOT, 'output');
const KEYSTORE = path.join(ROOT, 'keystore/dycast-release-new.keystore');
const KEYSTORE_PASS = 'dycast123';

// ── 参数解析（--src / --name，或第一个位置参数作为输出文件名，兼容旧用法）──
const argv = process.argv.slice(2);
function argVal(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}
const srcArg = argVal('--src');
const nameArg = argVal('--name');
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--src' && argv[i - 1] !== '--name');
let SRC = srcArg ? path.resolve(srcArg) : DEFAULT_SRC;
if (!srcArg && !fs.existsSync(SRC)) {
  // 兜底：在构建输出目录下按 mtime 找最新的 release APK（兼容 arm64/universal 布局）
  const base = path.join(ROOT, 'src-tauri/gen/android/app/build/outputs/apk');
  const found = [];
  (function walk(d) {
    let es = [];
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else if (e.name.endsWith('.apk') && fp.includes(`${path.sep}release${path.sep}`)) found.push(fp);
    }
  })(base);
  found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (found.length) SRC = found[0];
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const outName = nameArg || positional[0] || `dycast-${version}-arm64.apk`;
const ALIGNED = path.join(OUTPUT_DIR, `dycast-${version}-aligned.apk`);
const SIGNED = path.join(OUTPUT_DIR, outName);

function assertExists(p, label) {
  if (!fs.existsSync(p)) {
    console.error(`[sign-apk] ${label} 不存在: ${p}`);
    process.exit(1);
  }
}

assertExists(SRC, '构建产物 APK');
assertExists(path.join(BT, 'zipalign.exe'), 'zipalign');
assertExists(path.join(BT, 'apksigner.bat'), 'apksigner');
assertExists(KEYSTORE, '签名密钥');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

console.log(`[sign-apk] 版本 v${version}，产物 => ${SIGNED}`);
console.log('[sign-apk] 1/3 zipalign ...');
execFileSync(path.join(BT, 'zipalign.exe'), ['-p', '-f', '4', SRC, ALIGNED], { stdio: 'inherit' });

console.log('[sign-apk] 2/3 apksigner sign ...');
execFileSync(
  path.join(BT, 'apksigner.bat'),
  ['sign', '--ks', KEYSTORE, '--ks-pass', `pass:${KEYSTORE_PASS}`, '--key-pass', `pass:${KEYSTORE_PASS}`, '--out', SIGNED, ALIGNED],
  { stdio: 'inherit', shell: true }
);

console.log('[sign-apk] 3/3 apksigner verify ...');
execFileSync(path.join(BT, 'apksigner.bat'), ['verify', '--verbose', SIGNED], { stdio: 'inherit', shell: true });

// 校验 APK 内前端资源（js + css）与 dist 一致（防 stale assets 打进旧前端）
try {
  const tar = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/tar.exe');
  const tmp = path.join(require('os').tmpdir(), `apkcheck-${Date.now()}`);
  const pick = (d) => fs.readdirSync(d).filter(f => /\.(js|css)$/.test(f)).sort();
  fs.mkdirSync(tmp, { recursive: true });
  execFileSync(tar, ['-xf', SIGNED, '-C', tmp, 'assets/assets/'], { stdio: 'pipe' });
  const distFiles = pick(path.join(ROOT, 'dist/assets'));
  const apkFiles = pick(path.join(tmp, 'assets/assets'));
  const match = JSON.stringify(distFiles) === JSON.stringify(apkFiles);
  console.log(`[sign-apk] dist: ${distFiles.join(',')}`);
  console.log(`[sign-apk] apk : ${apkFiles.join(',')}`);
  console.log(match ? '[sign-apk] ✔ APK 内前端资源与 dist 一致' : '[sign-apk] ✘ APK 内前端资源与 dist 不一致（stale assets！）');
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!match) process.exitCode = 2;
} catch (e) {
  console.warn('[sign-apk] 前端资源一致性校验跳过:', e.message);
}

fs.rmSync(ALIGNED, { force: true });
console.log(`[sign-apk] 完成：${SIGNED} (${fs.statSync(SIGNED).size} bytes)`);
