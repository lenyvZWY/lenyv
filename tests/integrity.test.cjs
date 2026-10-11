/* ============================================================
   防破坏（完整性自检）· 回归测试
   ------------------------------------------------------------
   运行：  node tests/integrity.test.cjs

   原理：直接 require desktop/integrity.cjs（那份不依赖 Electron），
   在一个临时目录里造几个「假程序文件」，模拟各种被破坏的情况。
   盘符用一个假的「U 盘目录」代替 —— 不需要真的插 U 盘。
   ============================================================ */
'use strict';
const { checkIntegrity, buildManifest, findSeal } = require('../desktop/integrity.cjs');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  \u2714 ' + m)) : (fail++, console.log('  \u2718 ' + m)); };
const section = s => console.log('\n' + s);

// 建一个临时目录，里面放「程序目录」和「假 U 盘」
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-int-'));
const appDir = path.join(base, 'app');
const usbDir = path.join(base, 'usb');   // 用完整路径当「假盘符」
fs.mkdirSync(appDir, { recursive: true });
fs.mkdirSync(usbDir, { recursive: true });

// 假程序文件
const FILES = {
  'index.html': 'A',
  'assets/js/vault.js': 'B',
  'desktop/main.cjs': 'C'
};
function writeFiles() {
  for (const [rel, content] of Object.entries(FILES)) {
    const p = path.join(appDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}
function manifestOf() {
  const map = {};
  for (const rel of Object.keys(FILES)) map[rel] = path.join(appDir, rel);
  return buildManifest(map);
}
function writeManifest(m) {
  fs.writeFileSync(path.join(appDir, 'integrity.json'), JSON.stringify(m), 'utf8');
}

section('[1] 没有清单（开发模式）→ 不校验，不拦人');
{
  const r = checkIntegrity(appDir, []);
  ok(r.ok === true && r.source === 'none', '无清单 → source=none，ok=true');
}

section('[2] 有清单、文件完好 → 通过');
{
  writeFiles();
  writeManifest(manifestOf());
  const r = checkIntegrity(appDir, []);
  ok(r.ok === true, '文件完好 → 通过');
  ok(r.source === 'local', '没插 U 盘 → 依据是本机清单');
  ok(r.checked === Object.keys(FILES).length, '核对的文件数量正确');
}

section('[3] 文件被改 → 发现');
{
  writeFiles();
  writeManifest(manifestOf());
  fs.writeFileSync(path.join(appDir, 'index.html'), 'A-modified');
  const r = checkIntegrity(appDir, []);
  ok(r.ok === false, '被改后 → 不通过');
  ok(r.problems.some(p => p.includes('index.html')), '能指出是 index.html 被改');
}

section('[4] 文件被删 → 发现');
{
  writeFiles();
  writeManifest(manifestOf());
  fs.rmSync(path.join(appDir, 'assets/js/vault.js'));
  const r = checkIntegrity(appDir, []);
  ok(r.ok === false, '被删后 → 不通过');
  ok(r.problems.some(p => p.includes('vault.js')), '能指出是 vault.js 不见了');
}

section('[5] U 盘封印：有封印时以它为准');
{
  writeFiles();
  const m = manifestOf();
  writeManifest(m);
  // 把封印放进「假 U 盘」根目录
  fs.writeFileSync(path.join(usbDir, 'vault-seal.json'), JSON.stringify(m), 'utf8');

  const r = checkIntegrity(appDir, [usbDir]);
  ok(r.source === 'usb', '有封印 → 依据是 U 盘封印');
  ok(r.ok === true, '封印和文件一致 → 通过');

  const s = findSeal([usbDir]);
  ok(s && s.path.replace(/[\\/]/g, '/').endsWith('/vault-seal.json'), 'findSeal 能找到封印');
}

section('[6] 最关键：本机清单被一起改掉，但 U 盘封印还在 → 照样抓出来');
{
  // 场景：攻击者改了代码，还聪明地把本机清单也改成新的了。
  // 但他没有 U 盘，改不了 U 盘上的封印。
  writeFiles();
  const real = manifestOf();
  fs.writeFileSync(path.join(usbDir, 'vault-seal.json'), JSON.stringify(real), 'utf8');

  // 攻击者改代码
  fs.writeFileSync(path.join(appDir, 'assets/js/vault.js'), 'B-evil');
  // 攻击者伪造本机清单，让它跟改过的代码一致
  const fake = manifestOf();   // 现在算出来的清单已经对应「被改过的」代码
  writeManifest(fake);

  const r = checkIntegrity(appDir, [usbDir]);
  ok(r.source === 'usb', '因为插着 U 盘，用的是封印');
  ok(r.ok === false, '被改的代码逃不过封印');
  ok(r.problems.some(p => p.includes('vault.js')), '明确指出是 vault.js 被改');
}

section('[7] 没插 U 盘时，本机清单被一起伪造 → 就查不出来了（诚实的边界）');
{
  writeFiles();
  fs.writeFileSync(path.join(appDir, 'assets/js/vault.js'), 'B-evil');
  writeManifest(manifestOf());   // 清单也一起改掉
  const r = checkIntegrity(appDir, []);   // 没有 U 盘
  ok(r.ok === true, '无 U 盘 + 清单一起被改 → 查不出（这正是为什么要插 U 盘）');
}

// 清理
fs.rmSync(base, { recursive: true, force: true });

console.log('\n============================');
console.log('  结果：' + pass + ' 通过 / ' + fail + ' 失败');
console.log('============================');
process.exit(fail ? 1 : 0);
