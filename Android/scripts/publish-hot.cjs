#!/usr/bin/env node
/**
 * 热更新发布器：把 hot-bundle/（由 make-hot-manifest.mjs 生成）发布到 Gitee 仓库。
 *
 * 用法（先 npm run build + npm run hot:manifest）：
 *   node scripts/publish-hot.cjs --version 1.3.7.1
 *   可选 --dir hot-bundle --repo jiuyuanjun/dycast --branch master
 *
 * 步骤：
 *   1. 上传 hot-bundle/files/ 下全部文件到仓库 hot/{version}/{path}
 *      （通过 Gitee contents API；已存在的文件用 sha 做 PUT 更新）
 *   2. 上传 hot-bundle/manifest.json 到仓库 hot/manifest.json（App 默认检查地址）
 *   3. 逐个验证 raw 下载地址返回 200
 *
 * token 读取 scripts/gitee-token.txt（与 build-apk.cjs 相同来源）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..'); // Android/
const REPO_ROOT = path.resolve(ROOT, '..');
const TOKEN_FILE = path.join(ROOT, 'scripts', 'gitee-token.txt');

// ---------- 参数 ----------
const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
}
const version = arg('version', '');
const dir = path.resolve(ROOT, arg('dir', 'hot-bundle'));
const repo = arg('repo', 'jiuyuanjun/dycast');
const branch = arg('branch', 'master');

if (!version) {
  console.error('缺少 --version，例如：node scripts/publish-hot.cjs --version 1.3.7.1');
  process.exit(1);
}
const filesDir = path.join(dir, 'files');
const manifestPath = path.join(dir, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`未找到 ${manifestPath}，请先执行 npm run hot:manifest`);
  process.exit(1);
}

const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
const API = `https://gitee.com/api/v5/repos/${repo}/contents`;

function walk(dir, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), relPath));
    else if (entry.isFile()) out.push(relPath);
  }
  return out;
}

async function giteeJson(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON 响应 */ }
  return { status: res.status, ok: res.ok, json, text };
}

async function uploadFile(relPath, localFile, message) {
  const apiPath = `hot/${version}/${relPath}`;
  const content = fs.readFileSync(localFile).toString('base64');

  // 先查是否已存在（存在则走 PUT 更新）
  const head = await giteeJson('GET', `${API}/${apiPath}?ref=${branch}&access_token=${encodeURIComponent(token)}`);
  const exists = head.ok && head.json && head.json.sha;

  const reqBody = {
    access_token: token,
    content,
    message,
    branch
  };
  if (exists) {
    reqBody.sha = head.json.sha;
    const res = await giteeJson('PUT', `${API}/${apiPath}`, reqBody);
    if (!res.ok) throw new Error(`更新 ${apiPath} 失败: HTTP ${res.status} ${res.text.slice(0, 200)}`);
    console.log(`  已更新 hot/${version}/${relPath} (${res.json.content.size} bytes)`);
  } else {
    const res = await giteeJson('POST', `${API}/${apiPath}`, reqBody);
    if (!res.ok) throw new Error(`上传 ${apiPath} 失败: HTTP ${res.status} ${res.text.slice(0, 200)}`);
    console.log(`  已上传 hot/${version}/${relPath} (${res.json.content.size} bytes)`);
  }
}

async function main() {
  const relFiles = walk(filesDir);
  if (!relFiles.length) {
    console.error('files/ 目录为空');
    process.exit(1);
  }
  console.log(`发布热更 ${version}：${relFiles.length} 个文件 → 仓库 ${repo} (branch ${branch})`);

  for (const rel of relFiles) {
    await uploadFile(rel, path.join(filesDir, rel), `hot ${version}: ${rel}`);
  }

  // manifest 覆盖到固定检查地址
  const manifest = fs.readFileSync(manifestPath, 'utf8');
  const apiPath = 'hot/manifest.json';
  const head = await giteeJson('GET', `${API}/${apiPath}?ref=${branch}&access_token=${encodeURIComponent(token)}`);
  const reqBody = {
    access_token: token,
    content: Buffer.from(manifest, 'utf8').toString('base64'),
    message: `hot manifest -> ${version}`,
    branch
  };
  if (head.ok && head.json && head.json.sha) {
    reqBody.sha = head.json.sha;
    const res = await giteeJson('PUT', `${API}/${apiPath}`, reqBody);
    if (!res.ok) throw new Error(`更新 manifest 失败: HTTP ${res.status} ${res.text.slice(0, 200)}`);
    console.log('  已更新 hot/manifest.json');
  } else {
    const res = await giteeJson('POST', `${API}/${apiPath}`, reqBody);
    if (!res.ok) throw new Error(`上传 manifest 失败: HTTP ${res.status} ${res.text.slice(0, 200)}`);
    console.log('  已上传 hot/manifest.json');
  }

  // raw 下载验证
  console.log('验证 raw 下载地址…');
  let failed = 0;
  for (const rel of relFiles) {
    const url = `https://gitee.com/${repo}/raw/${branch}/hot/${version}/${rel}`;
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) {
      console.error(`  ✗ ${url} => HTTP ${res.status}`);
      failed++;
    }
  }
  const mUrl = `https://gitee.com/${repo}/raw/${branch}/hot/manifest.json`;
  const mRes = await fetch(mUrl);
  if (!mRes.ok) {
    console.error(`  ✗ ${mUrl} => HTTP ${mRes.status}`);
    failed++;
  }
  if (failed) {
    console.error(`完成但有 ${failed} 个地址验证失败，请人工检查`);
    process.exit(2);
  }
  console.log(`✔ 热更 ${version} 发布完成，App 内「设置 → 关于 → 检查热更新」即可拉取`);
}

main().catch(err => {
  console.error('发布失败:', err.message || err);
  process.exit(1);
});
