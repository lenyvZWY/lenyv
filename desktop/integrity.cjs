/* ============================================================================
   保险库 · 完整性自检（防破坏）
   ============================================================================
   【防的是什么】
   有人偷偷改了保险库的程序文件，好让你输进去的密码被记走 ——
   这是密码本最真实的一种威胁：代码被换掉，界面看着一模一样。

   【怎么防】
   打包时把每个程序文件的 SHA-256 指纹记下来；每次启动再算一遍，
   对不上就说明被动过 —— 立刻报警，并且默认拒绝打开。

   【两层威力不一样，这点必须说清楚】
     · 【U 盘封印】vault-seal.json 放在 U 盘根目录 —— 最强的一层。
       没有你 U 盘的人伪造不出正确指纹，所以只要插着 U 盘启动，
       任何对代码的改动都一定会被发现。
     · 【本机清单】integrity.json 放在程序目录 —— 弱一层。
       懂行的人可以连清单一起改掉；它挡的是「顺手改一下脚本」这种。
   规则：**有 U 盘封印时以封印为准，没有才退回本机清单。**

   【为什么单独放一个文件】
   这一份只依赖 Node 自带模块，不依赖 Electron ——
   所以测试可以脱离界面直接跑它（见 tests/integrity.test.cjs）。
   ============================================================================ */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 密钥文件的默认名字
const KEY_FILE_NAMES = ['vault-key.bin', 'vault-key-new.bin'];

// 封印文件名（放在 U 盘根目录）
const SEAL_NAME = 'vault-seal.json';

// 本机清单文件名（放在程序目录）
const MANIFEST_NAME = 'integrity.json';

/* 列出当前存在的盘符，例如 ['C:', 'D:', 'F:'] */
function listDrives() {
  const out = [];
  for (let i = 65; i <= 90; i++) {              // A 到 Z
    const letter = String.fromCharCode(i);
    try {
      if (fs.existsSync(letter + ':/')) out.push(letter + ':');
    } catch (e) { /* 没这个盘 */ }
  }
  return out;
}

/* 算一个文件的 SHA-256 指纹 */
function hashFile(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

/* 读一份清单 / 封印。读不到、不是 JSON、结构不对 —— 一律返回 null（当作没有）。 */
function readManifest(p) {
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!j || typeof j !== 'object') return null;
    if (!j.files || typeof j.files !== 'object') return null;
    return j;
  } catch (e) {
    return null;
  }
}

/* 在所有盘的根目录里找 U 盘封印。找到第一份就用它。 */
function findSeal(drives) {
  for (const drive of (drives || listDrives())) {
    const p = drive + '/' + SEAL_NAME;
    const m = readManifest(p);
    if (m) return { manifest: m, path: p };
  }
  return null;
}

/* 做一次自检。
   参数 appDir 是「程序代码所在目录」——测试时指向一个临时目录即可。
   返回 { ok, source, problems[], appDir, sealPath, checked } */
function checkIntegrity(appDir, drives) {
  // 本机清单都没有 → 当作开发模式（直接跑源码），不校验，别妨碍开发
  const local = readManifest(path.join(appDir, MANIFEST_NAME));
  if (!local) {
    return { ok: true, source: 'none', problems: [], appDir, sealPath: null, checked: 0 };
  }

  // 有 U 盘封印就优先用它 —— 它才是攻击者伪造不了的那一层
  const seal = findSeal(drives);
  const use = seal ? seal.manifest : local;
  const source = seal ? 'usb' : 'local';

  const problems = [];
  const names = Object.keys(use.files);
  for (const rel of names) {
    const want = use.files[rel];
    const p = path.join(appDir, rel);
    try {
      if (hashFile(p) !== want) problems.push(rel + ' —— 内容被改过');
    } catch (e) {
      problems.push(rel + ' —— 文件不见了');
    }
  }

  return {
    ok: problems.length === 0,
    source,
    problems,
    appDir,
    sealPath: seal ? seal.path : null,
    checked: names.length
  };
}

/* 生成一份指纹清单（打包时用）。
   files 传路径映射：{ 'index.html': '绝对路径', ... } */
function buildManifest(fileMap) {
  const files = {};
  for (const rel of Object.keys(fileMap)) {
    const p = fileMap[rel];
    if (!fs.existsSync(p)) continue;
    files[rel] = hashFile(p);
  }
  return { version: 1, createdAt: new Date().toISOString(), files: files };
}

module.exports = {
  KEY_FILE_NAMES,
  SEAL_NAME,
  MANIFEST_NAME,
  listDrives,
  hashFile,
  readManifest,
  findSeal,
  checkIntegrity,
  buildManifest
};
