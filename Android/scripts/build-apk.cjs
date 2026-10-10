#!/usr/bin/env node
/**
 * ============================================================================
 * DyCast Android 一键构建 + 发布程序（健壮版）
 * ============================================================================
 * 目的：把「构建最新 APK → 签名 → 发布（GitHub / 飞书）」固化成一条稳定命令，
 *      任何一步失败都给出**可定位的明确报错 + 日志文件**，不再出现"莫名其妙的异常"。
 *
 * 用法（在 Android/ 目录下执行）：
 *   node scripts/build-apk.cjs                      # 沿用 package.json 版本，全流程
 *   node scripts/build-apk.cjs --bump               # 版本号 patch+1 后全流程
 *   node scripts/build-apk.cjs --version 1.2.0      # 指定版本号
 *   node scripts/build-apk.cjs --notes "修复xxx"     # 自定义更新说明
 *   node scripts/build-apk.cjs --from sign          # 断点续跑：从签名步骤开始
 *   node scripts/build-apk.cjs --only upload        # 只跑上传步骤
 *   node scripts/build-apk.cjs --no-upload          # 只构建签名，不上传飞书
 *   node scripts/build-apk.cjs --no-github          # 跳过 GitHub Release
 *   node scripts/build-apk.cjs --keep-stale         # 不清理残留 cargo/rustc 进程
 *   node scripts/build-apk.cjs --help
 *
 * 步骤（可用 --from / --only 指定）：
 *   preflight  环境与文件校验、清理残留构建进程、清理旧产物
 *   version    版本号 4 处同步（package.json / Cargo.toml / tauri.conf.json / tauri.properties）+ 回读校验
 *   frontend   npm run build（vue-tsc + vite）并校验产物
 *   assets     清空并同步 dist → gen/android/.../assets，做文件集合一致性校验（防 stale assets）
 *   build      cargo tauri android build --apk（日志落盘），校验产物新鲜度 + 内嵌 JS 与 dist 一致
 *   sign       zipalign + apksigner 签名（调用 scripts/sign-apk.cjs）并验签
 *   github     创建 GitHub Release 并上传 APK（gh CLI），删除旧 Release（仅保留最新）
 *   upload     上传飞书云盘 + 保留"最新 + 1 个回滚版本" + 更新 .feishu-upload-state.json
 *
 * 退出码：0 成功；非 0 失败（1 通用失败，2 校验不通过，3 环境缺失）
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

// ───────────────────────────── 路径与常量 ─────────────────────────────
const ROOT = path.resolve(__dirname, '..');                    // Android/
const REPO_ROOT = path.resolve(ROOT, '..');                    // dycast/
const SRC_TAURI = path.join(ROOT, 'src-tauri');
const GEN_APP = path.join(SRC_TAURI, 'gen/android/app');
const ASSETS_DIR = path.join(GEN_APP, 'src/main/assets');
const APK_OUT_ROOT = path.join(GEN_APP, 'build/outputs/apk');
/** 默认产物路径（universal 布局）；实际以构建后扫描到的最新 release APK 为准 */
const RELEASE_APK = path.join(APK_OUT_ROOT, 'universal/release/app-universal-release.apk');
const DIST = path.join(ROOT, 'dist');
const OUTPUT_DIR = path.join(ROOT, 'output');
const LOG_DIR = path.join(ROOT, 'logs');
const KEYSTORE = path.join(ROOT, 'keystore/dycast-release-new.keystore');
const BUILD_TOOLS = process.env.ANDROID_BUILD_TOOLS
  || path.join(process.env.LOCALAPPDATA || '', 'Android/Sdk/build-tools/37.0.0');
const CARGO = process.env.CARGO_BIN || 'C:/Users/jiuyuanjun/.cargo/bin/cargo.exe';
const LARK_RUN = path.join(
  process.env.APPDATA || '', 'npm/node_modules/@larksuite/cli/scripts/run.js'
);
const STATE_FILE = path.join(REPO_ROOT, '.feishu-upload-state.json');
const FEISHU_FOLDER_TOKEN = 'KUWzf6phnlApZSdAwBActyUrnke';
/** GitHub 公开仓库（发布源；默认分支 public-clean） */
const GITHUB_REPO = 'jiuyuanjun/dycast';
const GITHUB_BRANCH = 'public-clean';
/** gh CLI 路径（Windows 安装于 Program Files\GitHub CLI） */
const GH = 'C:/Program Files/GitHub CLI/gh.exe';
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** 会被本程序接管（清空后由 dist 覆盖）的 assets 条目；其余（如 tauri.conf.json）不动 */
const MANAGED_ASSETS = ['index.html', 'assets', 'mssdk.js'];

const STEPS = ['preflight', 'version', 'frontend', 'assets', 'build', 'sign', 'github', 'upload'];

// ───────────────────────────── 参数解析 ─────────────────────────────
function parseArgs(argv) {
  const o = {
    version: '', bump: false, notes: '', from: '', only: '',
    upload: true, github: true, keepStale: false, universal: false, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--version': o.version = next(); break;
      case '--bump': o.bump = true; break;
      case '--notes': o.notes = next(); break;
      case '--from': o.from = next(); break;
      case '--only': o.only = next(); break;
      case '--no-upload': o.upload = false; break;
      case '--no-github': o.github = false; break;
      case '--keep-stale': o.keepStale = true; break;
      case '--universal': o.universal = true; break;
      case '-h': case '--help': o.help = true; break;
      default:
        if (a.startsWith('--from=')) o.from = a.slice(7);
        else if (a.startsWith('--only=')) o.only = a.slice(7);
        else if (a.startsWith('--version=')) o.version = a.slice(10);
        else if (a.startsWith('--notes=')) o.notes = a.slice(8);
        else throw new Error(`未知参数：${a}（用 --help 查看用法）`);
    }
  }
  return o;
}

// ───────────────────────────── 日志 ─────────────────────────────
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m',
  green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m',
};
let logStream = null;
function ts() { return new Date().toTimeString().slice(0, 8); }
function raw(line) {
  const s = `[${ts()}] ${line}\n`;
  process.stdout.write(s);
  if (logStream) logStream.write(s);
}
function info(m) { raw(`${C.cyan}·${C.reset} ${m}`); }
function ok(m) { raw(`${C.green}✔${C.reset} ${m}`); }
function warn(m) { raw(`${C.yellow}!${C.reset} ${m}`); }
function step(m) { raw(`\n${C.bold}${C.cyan}▶ ${m}${C.reset}`); }

class FatalError extends Error {
  constructor(msg, code = 1) { super(msg); this.code = code; }
}
function die(msg, code = 1) { throw new FatalError(msg, code); }

// ───────────────────────────── 小工具 ─────────────────────────────
function sh(cmd, args, opts = {}) {
  // 本机沙箱/杀软会间歇性对同步子进程（curl/tar/node 等）抛 EBUSY，重试几次即可
  let lastErr;
  for (let i = 0; i < 5; i++) {
    try {
      return execFileSync(cmd, args, {
        encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...opts,
      });
    } catch (e) {
      if (e && e.code === 'EBUSY' && i < 4) {
        lastErr = e;
        // 同步短退避（Node 主线程可用 Atomics.wait 阻塞）
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150 * (i + 1));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}
function exists(p) { try { fs.statSync(p); return true; } catch { return false; } }
function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function copyRecursive(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(src)) copyRecursive(path.join(src, f), path.join(dest, f));
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}
function assetsOf(dir) {
  const a = path.join(dir, 'assets');
  if (!exists(a)) return [];
  return fs.readdirSync(a).filter(f => /\.(js|css)$/.test(f)).sort();
}
function sha256(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}
function freshMs() { return Date.now(); }

/** 扫描构建输出目录下所有 release APK（兼容 arm64/universal 等布局），按 mtime 降序 */
function listReleaseApks() {
  const found = [];
  (function walk(d) {
    let es = [];
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else if (e.name.endsWith('.apk') && fp.includes(`${path.sep}release${path.sep}`)) found.push(fp);
    }
  })(APK_OUT_ROOT);
  found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return found;
}

/**
 * 运行子进程，stdout/stderr 实时透传到控制台并写入日志文件。
 *
 * ⚠ 关键修复（2026-09-20，根因见 agent.md 17.1「构建挂起」条目）：
 * **不能只等 'close' 事件**。`cargo tauri android build` 会拉起长驻的 Gradle daemon（java），
 * 守护进程继承了子进程的 stdout/stderr 管道并且不退出；而 Node 的 'close' 要求
 * 「子进程已退出 **且** 其 stdio 全部关闭」，因此 'close' 永远不会触发 →
 * `await run(...)` 永不返回 → 脚本在 "Finished 1 APK at" 之后无限挂起（此时 APK 其实已产出）。
 * 外部表现就是「构建刚出包就被静默终止 / 卡住不动」，此前一直靠 `--from sign` 绕过。
 * 处理：'exit' 之后再等 1.5s 收尾输出即强制完成，并主动销毁管道释放句柄。
 */
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const cp = spawn(cmd, args, {
      cwd: opts.cwd || ROOT,
      env: { ...process.env, ...(opts.env || {}) },
      windowsHide: true,
      shell: !!opts.shell,
      // 显式忽略 stdin：避免极少数子命令（如 tar）尝试读标准输入而挂住
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const sink = (d) => {
      process.stdout.write(d);
      if (logStream) logStream.write(d);
    };
    cp.stdout.on('data', sink);
    cp.stderr.on('data', sink);
    let settled = false;
    const finish = (code, note) => {
      if (settled) return;
      settled = true;
      if (note) info(note);
      // 长驻子进程（Gradle daemon）可能仍持有管道：主动销毁，避免句柄泄漏导致 node 不退出
      try { cp.stdout.removeAllListeners('data'); cp.stdout.destroy(); } catch { /* ignore */ }
      try { cp.stderr.removeAllListeners('data'); cp.stderr.destroy(); } catch { /* ignore */ }
      resolve({ code });
    };
    cp.on('error', (e) => finish(-1, `子进程启动失败：${e.message || e}`));
    cp.on('close', (code) => finish(code === null ? -1 : code));
    cp.on('exit', (code) => {
      // 'close' 迟迟不来（管道被长驻子进程占用）时的兜底：给 1.5s 收尾输出后强制完成
      setTimeout(() => {
        finish(code === null ? -1 : code,
          '子进程已退出但 stdio 管道仍被长驻子进程占用（如 Gradle daemon），已主动收尾并释放管道');
      }, 1500);
    });
  });
}

/** 读取 tasklist 输出，找出指定镜像名且确实在运行的进程 */
function listProcesses(imageName) {
  let out = '';
  try {
    out = sh('tasklist', ['/FI', `IMAGENAME eq ${imageName}`, '/FO', 'CSV', '/NH']);
  } catch { return []; }
  const pids = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^"[^"]+","(\d+)"/);
    if (m) pids.push(Number(m[1]));
  }
  return pids;
}
function killProcess(pid) {
  try { sh('taskkill', ['/F', '/PID', String(pid)]); return true; } catch { return false; }
}

// ───────────────────────────── 步骤实现 ─────────────────────────────

async function stepPreflight(ctx) {
  step('1/8 preflight：环境校验与清理');
  const problems = [];

  // 必需文件
  const must = [
    [path.join(ROOT, 'package.json'), 'Android/package.json'],
    [path.join(SRC_TAURI, 'Cargo.toml'), 'src-tauri/Cargo.toml'],
    [path.join(SRC_TAURI, 'tauri.conf.json'), 'src-tauri/tauri.conf.json'],
    [path.join(GEN_APP, 'tauri.properties'), 'gen/android/app/tauri.properties'],
    [KEYSTORE, 'keystore/dycast-release-new.keystore'],
    [CARGO, 'cargo 可执行文件'],
    [path.join(BUILD_TOOLS, 'zipalign.exe'), 'zipalign.exe'],
    [path.join(BUILD_TOOLS, 'apksigner.bat'), 'apksigner.bat'],
    [path.join(SRC_TAURI, 'gen/android/gradlew.bat'), 'gradlew.bat'],
  ];
  for (const [p, label] of must) if (!exists(p)) problems.push(`缺少 ${label}：${p}`);

  // 环境变量
  const envNeeded = ['ANDROID_HOME', 'JAVA_HOME'];
  for (const k of envNeeded) if (!process.env[k]) problems.push(`环境变量 ${k} 未设置`);
  if (!process.env.NDK_HOME && !process.env.ANDROID_NDK_HOME) {
    problems.push('环境变量 NDK_HOME / ANDROID_NDK_HOME 均未设置');
  }

  // 清理残留构建进程（被中断的 cargo/rustc 会持有 target 目录锁 →
  // "Blocking waiting for file lock on build directory"，导致构建无限等待）
  if (!ctx.opt.keepStale) {
    for (const img of ['cargo.exe', 'rustc.exe']) {
      const pids = listProcesses(img);
      if (pids.length) {
        warn(`发现残留 ${img} 进程 ${pids.join(', ')}，正在清理（可用 --keep-stale 关闭）`);
        for (const pid of pids) info(`  taskkill ${pid} → ${killProcess(pid) ? 'ok' : 'failed'}`);
      }
    }
    // 给文件系统一点时间释放句柄
    await new Promise(r => setTimeout(r, 400));
  } else {
    const stale = [...listProcesses('cargo.exe'), ...listProcesses('rustc.exe')];
    if (stale.length) warn(`存在 cargo/rustc 进程 ${stale.join(', ')}（--keep-stale 未清理，若卡在文件锁请重跑）`);
  }

  // 删除旧 release APK，便于用 mtime 判定"本次构建真的产出了新包"；
  // 若删除失败说明存在文件锁 → 直接给出明确指引
  const skipClean = ['sign', 'github', 'upload'].includes(ctx.opt.only)
    || ['sign', 'github', 'upload'].includes(ctx.opt.from);
  if (!skipClean) {
    for (const p of listReleaseApks()) {
      try { fs.rmSync(p, { force: true }); info(`已删除旧 release APK：${path.basename(p)}`); }
      catch (e) {
        die(`无法删除旧 APK（可能被进程占用）：${p}\n` +
            `  → 请关闭正在使用该 APK 的进程后重跑；原始错误：${e.message}`, 3);
      }
    }
  }

  if (!exists(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  if (!exists(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  if (problems.length) {
    console.error(`${C.red}${C.bold}环境校验未通过：${C.reset}`);
    for (const p of problems) console.error(`  - ${p}`);
    die('请先修复上述问题再重跑本程序。', 3);
  }
  ctx.buildStart = freshMs();
  ok('环境校验通过');
}

function readVersion() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
}

function stepVersion(ctx) {
  const confPath = path.join(SRC_TAURI, 'tauri.conf.json');
  const propsPath = path.join(GEN_APP, 'tauri.properties');
  const cargoPath = path.join(SRC_TAURI, 'Cargo.toml');
  const cur = readVersion();

  if (!ctx.opt.version && !ctx.opt.bump) {
    if (ctx.opt.from || ctx.opt.only) { ctx.version = cur; info(`沿用当前版本 v${cur}`); return; }
    ctx.version = cur;
    info(`未指定 --version/--bump，沿用当前版本 v${cur}`);
    return;
  }
  let target = ctx.opt.version;
  if (!target) {
    const parts = cur.split('.');
    parts[2] = String(Number(parts[2]) + 1);
    target = parts.join('.');
  }
  if (!/^\d+\.\d+\.\d+$/.test(target)) die(`版本号格式应为 x.y.z，收到：${target}`);

  step(`2/8 version：v${cur} → v${target}`);
  const conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
  const newCode = Number(conf.bundle.android.versionCode) + 1;

  // 1) package.json
  fs.writeFileSync(path.join(ROOT, 'package.json'),
    fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')
      .replace(`"version": "${cur}"`, `"version": "${target}"`), 'utf8');
  // 2) tauri.conf.json（version + versionCode）
  conf.version = target;
  conf.bundle.android.versionCode = newCode;
  fs.writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n', 'utf8');
  // 3) Cargo.toml
  fs.writeFileSync(cargoPath,
    fs.readFileSync(cargoPath, 'utf8')
      .replace(/^version = ".*?"/m, `version = "${target}"`), 'utf8');
  // 4) tauri.properties
  fs.writeFileSync(propsPath,
    fs.readFileSync(propsPath, 'utf8')
      .replace(/tauri\.android\.versionName=.*/, `tauri.android.versionName=${target}`)
      .replace(/tauri\.android\.versionCode=.*/, `tauri.android.versionCode=${newCode}`), 'utf8');

  ctx.version = target;
  ctx.versionCode = newCode;
  verifyVersion(target, newCode);
  ok(`版本号已同步：v${target} / versionCode ${newCode}`);
}

function verifyVersion(version, versionCode) {
  const found = [];
  const pkgV = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const confV = JSON.parse(fs.readFileSync(path.join(SRC_TAURI, 'tauri.conf.json'), 'utf8'));
  const cargoV = (fs.readFileSync(path.join(SRC_TAURI, 'Cargo.toml'), 'utf8').match(/^version = "(.*?)"/m) || [])[1];
  const props = fs.readFileSync(path.join(GEN_APP, 'tauri.properties'), 'utf8');
  const propsV = (props.match(/tauri\.android\.versionName=(.*)/) || [])[1];
  const propsC = Number((props.match(/tauri\.android\.versionCode=(\d+)/) || [])[1]);
  if (pkgV !== version) found.push(`package.json=${pkgV}`);
  if (confV.version !== version) found.push(`tauri.conf.json=${confV.version}`);
  if (cargoV !== version) found.push(`Cargo.toml=${cargoV}`);
  if (propsV !== version) found.push(`tauri.properties=${propsV}`);
  if (versionCode !== undefined && Number(confV.bundle.android.versionCode) !== versionCode) {
    found.push(`tauri.conf.json.versionCode=${confV.bundle.android.versionCode}`);
  }
  if (versionCode !== undefined && propsC !== versionCode) found.push(`tauri.properties.versionCode=${propsC}`);
  if (found.length) die(`版本号同步校验失败：${found.join(' / ')}`, 2);
}

async function stepFrontend(ctx) {
  step('3/8 frontend：npm run build（vue-tsc + vite）');
  if (exists(DIST)) rmrf(DIST);
  const r = await run(NPM, ['run', 'build'], { cwd: ROOT, shell: process.platform === 'win32' });
  if (r.code !== 0) die(`前端构建失败（exit ${r.code}），详见日志 ${ctx.logFile}`, 1);
  const js = assetsOf(DIST);
  if (!js.some(f => f.endsWith('.js'))) die('前端产物 dist/assets 下没有 .js 文件，构建异常', 2);
  for (const f of ['index.html']) if (!exists(path.join(DIST, f))) die(`dist 缺少 ${f}`, 2);
  ok(`前端产物就绪：${assetsOf(DIST).join(', ')}`);
}

function stepAssets(ctx) {
  step('4/8 assets：同步 dist → android assets（防 stale assets）');
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  for (const name of MANAGED_ASSETS) {
    const p = path.join(ASSETS_DIR, name);
    if (exists(p)) { rmrf(p); info(`清除旧 ${name}`); }
  }
  copyRecursive(DIST, ASSETS_DIR);
  if (exists(path.join(ROOT, 'mssdk.js'))) {
    fs.copyFileSync(path.join(ROOT, 'mssdk.js'), path.join(ASSETS_DIR, 'mssdk.js'));
  }
  // 一致性校验（js + css 文件名集合）
  const d = assetsOf(DIST), a = assetsOf(ASSETS_DIR);
  if (JSON.stringify(d) !== JSON.stringify(a)) {
    die(`assets 同步不一致：\n  dist=${d.join(', ')}\n  assets=${a.join(', ')}`, 2);
  }
  ok(`assets 已同步且一致：${a.join(', ')}`);
}

/** 校验 APK 内嵌前端资源与 dist 一致 */
function verifyApkAssets(apk) {
  const d = assetsOf(DIST);
  const tmp = path.join(os.tmpdir(), `apkchk-${Date.now()}`);
  const tar = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/tar.exe');
  try {
    fs.mkdirSync(tmp, { recursive: true });
    execFileSync(tar, ['-xf', apk, '-C', tmp, 'assets/assets/'], { stdio: 'pipe' });
    const inner = path.join(tmp, 'assets/assets');
    const a = fs.existsSync(inner)
      ? fs.readdirSync(inner).filter(f => /\.(js|css)$/.test(f)).sort() : [];
    return { ok: JSON.stringify(d) === JSON.stringify(a), dist: d, apk: a };
  } catch {
    // tar 解包失败：退回「在 APK 二进制中查找 index-*.js」的降级探测
    const buf = fs.readFileSync(apk);
    const names = [...new Set((buf.toString('latin1').match(/index-[A-Za-z0-9_\-]+\.js/g) || []))];
    return { ok: names.some(n => d.includes(n)), dist: d, apk: names, degraded: true };
  } finally { rmrf(tmp); }
}

async function stepBuild(ctx) {
  const target = ctx.opt.universal ? null : 'aarch64';
  step(`5/8 build：cargo tauri android build --apk${target ? ` --target ${target}` : ''}`);
  info(target
    ? '按既定交付形态构建 arm64 单架构（约 30MB；如需全架构包请加 --universal）'
    : '构建全架构 universal 包（体积约为 arm64 的 3 倍，仅特殊场景需要）');
  info('该步骤耗时通常 1~10 分钟，请勿中断；若被中断，可稍后用 --from build 重跑');

  // 清掉已有 release APK，确保"最新 mtime"必然指向本次构建产物
  for (const p of listReleaseApks()) {
    try { fs.rmSync(p, { force: true }); info(`清除旧 release APK：${p.replace(ROOT + path.sep, '')}`); }
    catch (e) { die(`无法删除旧 APK（可能被进程占用）：${p}\n  → ${e.message}`, 3); }
  }

  const t0 = freshMs();
  const args = ['tauri', 'android', 'build', '--apk'];
  if (target) args.push('--target', target);
  // GRADLE_OPTS 关闭 Gradle 守护进程：daemon 会长期驻留（占用数百 MB 内存）并
  // 继承构建进程的 stdio 管道，是此前「构建出包后脚本挂起」的根因来源（详见 run() 注释）。
  const r = await run(CARGO, args, {
    cwd: ROOT,
    env: { CI: 'true', GRADLE_OPTS: '-Dorg.gradle.daemon=false' },
  });
  if (r.code !== 0) {
    die(`APK 构建失败（exit ${r.code}）。完整日志：${ctx.logFile}\n` +
        `  常见原因：① 残留 cargo 进程持有 target 锁（本程序 preflight 已自动清理，重跑即可）；` +
        `② NDK/JDK 环境变量缺失；③ 前端构建报错（请向上翻看日志）。`, 1);
  }

  const produced = listReleaseApks().filter(p => fs.statSync(p).mtimeMs >= t0 - 5000);
  if (!produced.length) {
    die(`构建命令返回成功但未产出新的 release APK（应在 ${APK_OUT_ROOT} 下 *\\release\\*.apk）`, 2);
  }
  const product = produced[0];
  ctx.sourceApk = product;
  const st = fs.statSync(product);
  const v = verifyApkAssets(product);
  info(`产物        : ${product.replace(ROOT + path.sep, '')}`);
  info(`dist JS/CSS : ${v.dist.join(', ')}`);
  info(`APK  内资源 : ${v.apk.join(', ')}${v.degraded ? '（降级探测）' : ''}`);
  if (!v.ok) die('APK 内前端资源与 dist 不一致（stale assets）！请重跑本程序（--from assets）', 2);
  ok(`APK 构建成功且内容正确：${(st.size / 1048576).toFixed(1)} MB @ ${st.mtime.toLocaleString()}`);
}

async function stepSign(ctx) {
  step('6/8 sign：zipalign + apksigner');
  const args = [path.join(ROOT, 'scripts/sign-apk.cjs')];
  if (ctx.sourceApk) args.push('--src', ctx.sourceApk);
  const r = await run(process.execPath, args, { cwd: ROOT });
  if (r.code === 2) die('签名后校验发现 APK 内前端资源与 dist 不一致（stale assets）', 2);
  if (r.code !== 0) die(`签名失败（exit ${r.code}）`, 1);
  ctx.signedApk = path.join(OUTPUT_DIR, `dycast-${ctx.version}-arm64.apk`);
  if (!exists(ctx.signedApk)) die(`未找到签名产物：${ctx.signedApk}`, 2);
  ctx.sha256 = sha256(ctx.signedApk);
  ok(`签名产物：${ctx.signedApk}`);
  info(`  size=${fs.statSync(ctx.signedApk).size} bytes  sha256=${ctx.sha256}`);
}

async function stepGitHub(ctx) {
  step('7/8 github：发布 GitHub Release（仅保留最新）');
  if (!fs.existsSync(GH)) {
    warn(`未找到 gh CLI（${GH}），跳过 GitHub 发布；可先安装 GitHub CLI 或用 --no-github 跳过`);
    return;
  }
  const notes = ctx.opt.notes || `DyCast Android v${ctx.version}`;
  const tag = `v${ctx.version}`;
  const apkName = path.basename(ctx.signedApk);

  // 删除同 tag 旧 Release（重新发布同版本时覆盖），保证 /releases/latest 指向本次版本
  try {
    sh(GH, ['release', 'view', tag, '--repo', GITHUB_REPO, '--json', 'tagName', '--jq', '.tagName']);
    // 上一步未抛错 = Release 已存在 → 删除后重建
    sh(GH, ['release', 'delete', tag, '--repo', GITHUB_REPO, '--yes']);
    info(`已删除同版本旧 Release：${tag}`);
  } catch (e) { /* Release 不存在则忽略 */ }

  // 创建 Release 并上传 APK（gh 会自动推 tag 到目标分支）
  try {
    sh(GH, [
      'release', 'create', tag, ctx.signedApk,
      '--repo', GITHUB_REPO,
      '--target', GITHUB_BRANCH,
      '--title', tag,
      '--notes', notes,
    ]);
  } catch (e) {
    // 若同 tag 已存在但上一步 view 也失败（如网络），这里再兜底尝试 --clobber 语义：报明确错误
    die(`创建 GitHub Release 失败：${e.message || e}`, 1);
  }
  ctx.githubUrl = `https://github.com/${GITHUB_REPO}/releases/tag/${tag}`;
  ok(`GitHub Release 已发布：${ctx.githubUrl}（APK: ${apkName}）`);

  // 清理其它旧 Release（保留本次 + 所有 -hot 热更 Release，保证 latest 指向最新 APK 版本）
  try {
    const listRaw = sh(GH, ['release', 'list', '--repo', GITHUB_REPO, '--limit', '50', '--json', 'tagName', '--jq', '[.[].tagName]']);
    const list = JSON.parse(listRaw || '[]');
    for (const oldTag of list) {
      if (oldTag === tag || oldTag.endsWith('-hot')) continue;
      sh(GH, ['release', 'delete', oldTag, '--repo', GITHUB_REPO, '--yes']);
      info(`已删除旧 Release：${oldTag}`);
    }
  } catch (e) { warn(`旧 Release 清理跳过：${e.message}`); }
}

function lark(args, cwd) {
  // 用异步 spawn 调 lark-cli：本环境同步 execFileSync/spawnSync 对 node.exe 偶发 EBUSY，
  // 异步 spawn 实测稳定，加失败重试兜底
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      let out = ''; let err = '';
      let c;
      try {
        c = spawn(process.execPath, [LARK_RUN, ...args], { cwd: cwd || ROOT, windowsHide: true });
      } catch (e) { return reject(e); }
      c.stdout.on('data', d => { out += d; });
      c.stderr.on('data', d => { err += d; });
      c.on('error', e => {
        if (e.code === 'EBUSY' && n > 0) { info('  lark EBUSY，重试...'); return attempt(n - 1); }
        reject(e);
      });
      c.on('close', () => resolve(out));
    };
    attempt(4);
  });
}
function parseJsonLoose(text) {
  const i = text.indexOf('{');
  if (i < 0) return null;
  for (let end = text.length; end > i; end--) {
    if (text[end - 1] !== '}') continue;
    try { return JSON.parse(text.slice(i, end)); } catch { /* keep shrinking */ }
  }
  return null;
}

async function stepUpload(ctx) {
  step('8/8 upload：飞书云盘（保留最新 + 1 个回滚版本）');
  if (!exists(LARK_RUN)) die(`未找到 lark-cli（${LARK_RUN}）`, 3);
  const fileName = path.basename(ctx.signedApk);

  const listFolder = async () => {
    const j = parseJsonLoose(await lark(['drive', 'files', 'list', '--folder-token', FEISHU_FOLDER_TOKEN]));
    return (j && j.data && (j.data.files || j.data.items)) || [];
  };

  // 1) 先清掉"同版本"的历史残留（同名重复上传会生成新 token 而不覆盖）
  try {
    for (const f of await listFolder()) {
      const m = String(f.name || '').match(/v?(\d+\.\d+\.\d+)/);
      if (m && m[1] === ctx.version) {
        await lark(['drive', '+delete', '--file-token', f.token, '--type', 'file', '--yes']);
        info(`清除同版本残留：${f.name}`);
      }
    }
  } catch (e) { warn(`同版本清理跳过：${e.message}`); }

  // 2) 上传
  const upOut = await lark(['drive', '+upload', '--folder-token', FEISHU_FOLDER_TOKEN, '--file', `./${fileName}`], OUTPUT_DIR);
  const upJson = parseJsonLoose(upOut);
  let newToken = upJson && upJson.data ? upJson.data.file_token : null;
  if (!newToken) newToken = (upOut.match(/"file_token"\s*:\s*"([^"]+)"/) || [])[1];
  if (!newToken) die(`飞书上传失败：${String(upOut).slice(0, 400)}`, 1);
  ok(`飞书已上传：${fileName}（token=${newToken}）`);

  // 3) 整理：最新 + 1 个回滚版本，其余删除（非版本命名文件不删）
  let removed = 0; const kept = [];
  try {
    const olds = [];
    for (const f of await listFolder()) {
      if (!f || f.token === newToken) continue;
      const m = String(f.name || '').match(/v?(\d+\.\d+\.\d+)/);
      if (!m) { info(`跳过非版本命名文件（不删除）：${f.name}`); continue; }
      olds.push({ token: f.token, name: f.name, ver: m[1] });
    }
    olds.sort((x, y) => y.ver.localeCompare(x.ver, undefined, { numeric: true }));
    for (const [idx, f] of olds.entries()) {
      if (idx === 0) { kept.push(f.name); info(`保留回滚版本：${f.name}`); continue; }
      try { await lark(['drive', '+delete', '--file-token', f.token, '--type', 'file', '--yes']); removed++; info(`已删除飞书旧版本：${f.name}`); }
      catch (e) { warn(`删除失败 ${f.name}：${e.message}`); }
    }
  } catch (e) { warn(`飞书目录清理跳过：${e.message}`); }

  // 4) 状态文件
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    fileName,
    sha256: ctx.sha256,
    fileToken: newToken,
    url: `https://my.feishu.cn/file/${newToken}`,
    folderToken: FEISHU_FOLDER_TOKEN,
    uploadedAt: new Date().toISOString(),
    note: ctx.opt.notes || `DyCast Android v${ctx.version}`,
  }, null, 2) + '\n', 'utf8');
  ctx.feishu = { token: newToken, url: `https://my.feishu.cn/file/${newToken}`, removed, kept };
  ok(`飞书文件夹已整理（删除 ${removed} 个旧版本，保留回滚：${kept.join(', ') || '无'}）`);
}

// ───────────────────────────── 主流程 ─────────────────────────────
const HELP = `
DyCast Android 一键构建 + 发布程序

用法：node scripts/build-apk.cjs [选项]

选项：
  --version <x.y.z>   指定版本号（默认沿用 package.json 当前版本）
  --bump              patch 号 +1
  --notes "<文本>"    更新说明（写入 GitHub Release 与飞书状态文件）
  --from <step>       从指定步骤开始续跑
  --only <step>       只执行指定步骤
  --no-upload         跳过飞书上传
  --no-github         跳过 GitHub Release
  --keep-stale        不清理残留 cargo/rustc 进程
  --universal         构建全架构 universal 包（默认只构建 arm64 单架构，约 30MB）
  -h, --help          显示本帮助

步骤名：${STEPS.join(' | ')}

示例：
  node scripts/build-apk.cjs --bump --notes "修复直播重连竞态"
  node scripts/build-apk.cjs --from sign          # 构建已完成，只补签名+发布
  node scripts/build-apk.cjs --only upload        # 只重新上传飞书
`;

(async function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (opt.help) { process.stdout.write(HELP); return; }

  if (opt.only && !STEPS.includes(opt.only)) die(`--only 的值必须是：${STEPS.join(' | ')}`);
  if (opt.from && !STEPS.includes(opt.from)) die(`--from 的值必须是：${STEPS.join(' | ')}`);

  let plan = STEPS.slice();
  if (opt.only) plan = [opt.only];
  else if (opt.from) plan = STEPS.slice(STEPS.indexOf(opt.from));
  if (!opt.upload) plan = plan.filter(s => s !== 'upload');
  if (!opt.github) plan = plan.filter(s => s !== 'github');

  const version = opt.version || (() => { try { return readVersion(); } catch { return 'unknown'; } })();
  if (!exists(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const logFile = path.join(LOG_DIR, `build-${version}-${stamp}.log`);
  logStream = fs.createWriteStream(logFile, { flags: 'a' });

  const ctx = { opt, version, logFile, signedApk: null, sha256: '', versionCode: undefined };

  raw(`${C.bold}DyCast Android 构建程序${C.reset}  版本 v${version}  ${new Date().toLocaleString()}`);
  raw(`${C.dim}日志文件：${logFile}${C.reset}`);
  raw(`${C.dim}执行步骤：${plan.join(' → ')}${C.reset}`);

  const t0 = Date.now();
  const impl = {
    preflight: stepPreflight, version: stepVersion, frontend: stepFrontend,
    assets: stepAssets, build: stepBuild, sign: stepSign, github: stepGitHub, upload: stepUpload,
  };

  try {
    for (const s of plan) {
      await impl[s](ctx);
      if (s === 'version' || (s === 'preflight' && !plan.includes('version'))) {
        // 版本可能在本步骤才确定，回读一次
        ctx.version = readVersion();
      }
    }
    if (plan.includes('sign') && !plan.includes('upload') && ctx.signedApk) {
      info('（未执行上传：如需上传飞书请加 --only upload 或去掉 --no-upload）');
    }
  } catch (e) {
    raw('');
    if (e instanceof FatalError) raw(`${C.red}${C.bold}✘ 失败：${e.message}${C.reset}`);
    else raw(`${C.red}${C.bold}✘ 未预期错误：${e.stack || e.message}${C.reset}`);
    raw(`${C.dim}完整日志：${logFile}${C.reset}`);
    if (logStream) logStream.end();
    process.exitCode = e instanceof FatalError ? e.code : 1;
    return;
  }

  // ── 汇总 ──
  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  raw('');
  raw(`${C.green}${C.bold}═══ 完成（耗时 ${mins} 分钟）═══${C.reset}`);
  raw(`版本      : v${ctx.version}${ctx.versionCode ? ` (versionCode ${ctx.versionCode})` : ''}`);
  if (ctx.signedApk) raw(`APK       : ${ctx.signedApk}`);
  if (ctx.sha256) raw(`SHA-256   : ${ctx.sha256}`);
  if (ctx.githubUrl) raw(`GitHub    : ${ctx.githubUrl}`);
  if (ctx.feishu) raw(`飞书      : ${ctx.feishu.url}`);
  if (ctx.opt.notes) raw(`更新说明  : ${ctx.opt.notes}`);
  raw(`${C.dim}日志文件  : ${ctx.logFile}${C.reset}`);
  raw('');
  raw(`${C.yellow}提醒：按项目约定，请同步更新 agent.md（功能/Bug/版本状态）。${C.reset}`);
  if (logStream) logStream.end();
})();
