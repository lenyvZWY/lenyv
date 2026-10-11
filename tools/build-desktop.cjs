/* ============================================================
   保险库 · 桌面应用打包脚本
   ------------------------------------------------------------
   干什么：把保险库打成一个真正的 Windows 程序 ——
           一个文件夹，里面有个「保险库.exe」，双击就能开。

   运行：  node tools/build-desktop.cjs
   （需在项目根目录运行）

   为什么要自己写而不用 electron-packager：
   那些工具在打包时会联网去下载 / 校验 Electron 运行时，
   本机网络受限时直接失败。其实它们内部做的事很朴素：
     ① 把 Electron 运行时复制一份
     ② 把 electron.exe 改名成你的程序名
     ③ 把你的代码放进 resources/app/
   我们就照做，不联网、可重复、还快。
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP_NAME = '保险库';
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_APP = path.join(OUT_DIR, APP_NAME);
const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');

/* 要放进程序里的东西（其余一概不带：测试、工具、Netlify 函数都用不上） */
const INCLUDE = ['index.html', 'assets', 'download', 'desktop'];

function copyDir(from, to, { skip = [] } = {}) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip.includes(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst, { skip });
    else fs.copyFileSync(src, dst);
  }
}

// ---- 0. 前置检查 ----
if (!fs.existsSync(path.join(ELECTRON_DIST, 'electron.exe'))) {
  console.error('找不到 Electron 运行时：' + ELECTRON_DIST);
  console.error('请先按 README 里的说明装好 Electron。');
  process.exit(1);
}

console.log('开始打包……');

// ---- 1. 复制 Electron 运行时 ----
if (fs.existsSync(OUT_APP)) fs.rmSync(OUT_APP, { recursive: true, force: true });
copyDir(ELECTRON_DIST, OUT_APP);
console.log('  ✔ 已复制 Electron 运行时');

// ---- 2. electron.exe 改名成「保险库.exe」----
const exeFrom = path.join(OUT_APP, 'electron.exe');
const exeTo = path.join(OUT_APP, APP_NAME + '.exe');
fs.renameSync(exeFrom, exeTo);
console.log('  ✔ 主程序已改名：' + APP_NAME + '.exe');

// ---- 3. 清掉 Electron 自带的示例程序，换成我们的 ----
const resources = path.join(OUT_APP, 'resources');
for (const junk of ['default_app.asar', 'app.asar']) {
  const p = path.join(resources, junk);
  if (fs.existsSync(p)) fs.rmSync(p, { force: true });
}

// ---- 4. 放进我们的代码 ----
const appDir = path.join(resources, 'app');
fs.mkdirSync(appDir, { recursive: true });
for (const item of INCLUDE) {
  const src = path.join(ROOT, item);
  if (!fs.existsSync(src)) { console.warn('  ! 跳过不存在的：' + item); continue; }
  const dst = path.join(appDir, item);
  if (fs.statSync(src).isDirectory()) copyDir(src, dst);
  else fs.copyFileSync(src, dst);
}
console.log('  ✔ 已放入程序代码');

// ---- 5. 给打包后的程序写一份最小的 package.json ----
// 注意：只写运行必需的字段，不要把仓库根目录那份（带一堆依赖）照抄进来 ——
// 那些依赖在桌面上用不到，写进来只会让 Electron 白找一圈。
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
  name: 'vault',
  productName: APP_NAME,
  version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
  main: 'desktop/main.cjs'
}, null, 2), 'utf8');
console.log('  ✔ 已写入程序清单');

// ---- 6. 自检 ----
const problems = [];
if (!fs.existsSync(exeTo)) problems.push('主程序 exe 不存在');
if (!fs.existsSync(path.join(appDir, 'index.html'))) problems.push('index.html 没进去');
if (!fs.existsSync(path.join(appDir, 'assets/js/vault.js'))) problems.push('vault.js 没进去');
if (!fs.existsSync(path.join(appDir, 'desktop/main.cjs'))) problems.push('main.cjs 没进去');

if (problems.length) {
  console.error('\n自检没通过：');
  problems.forEach(p => console.error('  ✘ ' + p));
  process.exit(1);
}

// 算一下整个文件夹多大
let total = 0;
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else total += fs.statSync(p).size;
  }
})(OUT_APP);

console.log('\n打包完成！');
console.log('程序位置：' + path.relative(ROOT, OUT_APP).replace(/\\/g, '/') + '\\' + APP_NAME + '.exe');
console.log('文件夹大小：' + (total / 1024 / 1024).toFixed(0) + ' MB（Electron 运行时占大头，正常）');
console.log('自检通过：主程序、页面、逻辑、清单都在。');
