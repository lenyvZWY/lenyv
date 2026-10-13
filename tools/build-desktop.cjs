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
const INCLUDE = ['vault.html', 'assets', 'download', 'desktop'];

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

// ---- 6. 生成「指纹清单」（防破坏用）----
// 思路：把每个程序文件的 SHA-256 记下来，程序启动时再算一遍，对不上就报警。
// 清单放两处：程序目录里一份（弱），U 盘根目录再放一份「封印」（强，别人伪造不了）。
const crypto = require('crypto');

const WATCH = [
  'vault.html',
  'assets/js/vault.js',
  'assets/css/tokens.css',
  'assets/css/main.css',
  'assets/css/vault.css',
  'desktop/main.cjs',
  'desktop/preload.cjs'
];

const fileHashes = {};
for (const rel of WATCH) {
  const p = path.join(appDir, rel);
  if (!fs.existsSync(p)) { console.warn('  ! 清单里跳过（文件不存在）：' + rel); continue; }
  fileHashes[rel] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
const manifest = { version: 1, createdAt: new Date().toISOString(), files: fileHashes };
fs.writeFileSync(path.join(appDir, 'integrity.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log('  ✔ 已生成指纹清单：' + Object.keys(fileHashes).length + ' 个文件');

// ---- 7. 找到 U 盘：写封印 + （可选）把程序也复制一份过去 ----
// 怎么认出是「你的 U 盘」：根目录有 vault-key.bin。
// 这样绝不会误写别的盘 —— 只有你自己放过密钥的那个盘才会被动。
const TO_USB = process.argv.includes('--to-usb');
const usbDrives = [];
for (let i = 67; i <= 90; i++) {                    // C 到 Z
  const drive = String.fromCharCode(i) + ':';
  try {
    if (fs.existsSync(drive + '/vault-key.bin')) usbDrives.push(drive);
  } catch (e) { /* 没这个盘 */ }
}

if (!usbDrives.length) {
  console.log('  · 没找到 U 盘（根目录有 vault-key.bin 的盘）。插上 U 盘再跑一次就能写封印。');
} else {
  for (const drive of usbDrives) {
    // ① 封印：跟程序目录里那份一模一样
    try {
      fs.writeFileSync(drive + '/vault-seal.json', JSON.stringify(manifest, null, 2), 'utf8');
      console.log('  ✔ 封印已写到 ' + drive + '\\vault-seal.json');
    } catch (e) {
      console.warn('  ! 写封印失败（' + drive + '）：' + e.message);
    }

    // ② 整份程序也复制过去（要加 --to-usb）
    //    这一份是「干净的备份」：万一电脑上那份被人破坏了，从这里复制回来就行。
    if (TO_USB) {
      const dest = path.join(drive + '/', APP_NAME);
      try {
        if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
        copyDir(OUT_APP, dest);
        console.log('  ✔ 程序已复制到 ' + drive + '\\' + APP_NAME + '\\');
      } catch (e) {
        console.warn('  ! 复制到 U 盘失败（' + drive + '）：' + e.message);
      }
    }
  }
  if (!TO_USB) {
    console.log('  （想把程序本身也复制到 U 盘，加上 --to-usb 参数）');
  }
}

// ---- 8. 自检 ----
const problems = [];
if (!fs.existsSync(exeTo)) problems.push('主程序 exe 不存在');
if (!fs.existsSync(path.join(appDir, 'vault.html'))) problems.push('vault.html 没进去');
if (!fs.existsSync(path.join(appDir, 'assets/js/vault.js'))) problems.push('vault.js 没进去');
if (!fs.existsSync(path.join(appDir, 'desktop/main.cjs'))) problems.push('main.cjs 没进去');
if (!fs.existsSync(path.join(appDir, 'integrity.json'))) problems.push('指纹清单没生成');

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
