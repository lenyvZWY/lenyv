/* ============================================================
   lenyv 保险库 · 回归测试
   ------------------------------------------------------------
   运行：  node tests/vault.test.cjs
   （需在项目根目录运行）

   原理：从 assets/js/vault.js 里**直接切出真实函数**来跑，
   不复制副本 —— 否则测的是副本，真代码里的 bug 会漏掉。
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC_PATH = path.join(__dirname, '..', 'assets', 'js', 'vault.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

function slice(a, b) {
  const s = src.indexOf(a), e = src.indexOf(b);
  if (s < 0 || e < 0 || e <= s) throw new Error('切片失败，vault.js 结构可能变了：' + a);
  return src.slice(s, e);
}

// A = 常量 + 工具 + 报错翻译 + 加密函数；B = 会话状态 + 建库 + 解锁 + 保存 + 钥匙
const A = slice("  var DB_NAME = 'lenyv_vault';", '  // ---------------- 存储层 ----------------');
const B = slice('  // ---------------- 会话状态 ----------------', '  // ---------------- 视图切换 ----------------');

function makeVault() {
  const disk = {};                                   // 模拟浏览器里存下来的密文
  const storePut = rec => { disk[rec.id] = JSON.parse(JSON.stringify(rec)); return Promise.resolve(); };
  const code = A + '\n' + B + `
    return { createVault, unlockWithPrimary, unlockWithRecovery, saveRecovery, changePrimaryKey,
      persistEntries, storageLabelStub: null,
      setMat: function (m) { vaultKeyMat = m; },
      setRecord: function (r) { record = r; },
      setEntries: function (e) { entries = e; },
      getEntries: function () { return entries; } };`;
  return { api: new Function('storePut', 'enterVault', code)(storePut, () => {}), disk };
}

let pass = 0, fail = 0;
const t = (cond, msg) => { cond ? (pass++, console.log('  ✔ ' + msg)) : (fail++, console.log('  ✘ ' + msg)); };
const section = s => console.log('\n' + s);

(async () => {
  const USB = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 255);
  const USB2 = new Uint8Array(32).map((_, i) => (i * 13 + 1) & 255);
  const ANSWER = '冷羽什么心情我就什么心情';

  section('[1] 建库');
  {
    const { api, disk } = makeVault();
    await api.createVault(USB, 'oldpw');
    t(!!disk.main, '密文记录已落盘');
    t(!!disk.main.primary.wrap, 'U 盘钥匙口已包裹文件');
    t(!!disk.main.verifier, '校验串已生成');
    t(disk.main.recovery === null, '恢复钥匙口初始为空（钥匙可以先不存在）');
    t(api.getEntries().length === 0, '新库没有条目');
  }

  section('[2] 钥匙校验');
  {
    const { api, disk } = makeVault();
    await api.createVault(USB, 'oldpw');
    api.setMat(null); api.setRecord(disk.main);
    await api.unlockWithPrimary(USB, 'oldpw');
    t(true, 'U 盘 + 正确主密码 → 能开');

    api.setMat(null); api.setRecord(disk.main);
    let bad = false;
    try { await api.unlockWithPrimary(USB, 'WRONG'); } catch (e) { bad = true; }
    t(bad, '主密码错 → 打不开');

    api.setMat(null); api.setRecord(disk.main);
    bad = false;
    try { await api.unlockWithPrimary(USB2, 'oldpw'); } catch (e) { bad = true; }
    t(bad, 'U 盘文件错 → 打不开');

    const { api: a2, disk: d2 } = makeVault();
    await a2.createVault(USB, '');
    a2.setMat(null); a2.setRecord(d2.main);
    await a2.unlockWithPrimary(USB, '');
    t(true, '不设主密码（只靠 U 盘）→ 能开');
  }

  section('[3] 条目：新增 / 重开 / 追加');
  {
    const { api, disk } = makeVault();
    await api.createVault(USB, 'pw1');
    api.setEntries([
      { id: 'a', title: 'A站', username: 'ua', password: 'pa' },
      { id: 'b', title: 'B站', username: 'ub', password: 'pb' }
    ]);
    await api.persistEntries();
    api.setMat(null); api.setRecord(disk.main);
    await api.unlockWithPrimary(USB, 'pw1');
    t(api.getEntries().length === 2, '关掉重开，两条都在');

    const e = api.getEntries();
    e.push({ id: 'c', title: 'C站', username: 'uc', password: 'pc' });
    api.setEntries(e);
    await api.persistEntries();
    api.setMat(null); api.setRecord(disk.main);
    await api.unlockWithPrimary(USB, 'pw1');
    const after = api.getEntries();
    t(after.length === 3 && after[2].title === 'C站', '新增条目保存住了');
    t(after[0].password === 'pa', '明文解密正确');
  }

  section('[4] 恢复问题（钥匙口先做出形状，钥匙可后补）');
  {
    const { api, disk } = makeVault();
    await api.createVault(USB, 'oldpw');

    api.setMat(null); api.setRecord(disk.main);
    let blocked = false;
    try { await api.unlockWithRecovery(ANSWER); } catch (e) { blocked = (e.message === 'NO_RECOVERY'); }
    t(blocked, '还没配钥匙时，恢复这条路走不通');

    api.setMat(null); api.setRecord(disk.main);
    await api.unlockWithPrimary(USB, 'oldpw');
    await api.saveRecovery('你今天什么心情？', ANSWER);
    t(!!disk.main.recovery, '配好钥匙后钥匙口有内容');

    api.setMat(null); api.setRecord(disk.main);
    await api.unlockWithRecovery(ANSWER);
    t(true, '只用恢复答案就能开（连 U 盘都不用插）');

    api.setMat(null); api.setRecord(disk.main);
    let near = false;
    try { await api.unlockWithRecovery(ANSWER + '。'); } catch (e) { near = true; }
    t(near, '答案多一个句号都打不开（严格匹配）');

    // 改答案：旧的作废、新的生效
    api.setMat(null); api.setRecord(disk.main);
    await api.unlockWithRecovery(ANSWER);            // 先重新进库
    await api.saveRecovery('你今天什么心情？', '新答案新答案');
    api.setMat(null); api.setRecord(disk.main);
    let oldGone = false;
    try { await api.unlockWithRecovery(ANSWER); } catch (e) { oldGone = true; }
    t(oldGone, '改答案后旧答案作废');
    api.setMat(null); api.setRecord(disk.main);
    await api.unlockWithRecovery('新答案新答案');
    t(true, '新答案生效');
  }

  section('[4b] 锁着的时候不该能改东西（应给中文错误码，而不是 WebCrypto 报错）');
  {
    const { api, disk } = makeVault();
    await api.createVault(USB, 'pw1');
    api.setMat(null); api.setRecord(disk.main);      // 模拟已锁定
    const codes = [];
    try { await api.saveRecovery('q', 'a'); } catch (e) { codes.push(e.message); }
    try { await api.persistEntries(); } catch (e) { codes.push(e.message); }
    try { await api.changePrimaryKey(USB, 'x'); } catch (e) { codes.push(e.message); }
    t(codes.length === 3 && codes.every(c => c === 'LOCKED'),
      '三处都抛 LOCKED（会被翻译成中文提示）');
  }

  section('[5] 忘记主密码 → 恢复答案进来 → 更换钥匙');
  {
    const { api, disk } = makeVault();
    await api.createVault(USB, 'oldpw');
    await api.saveRecovery('你今天什么心情？', ANSWER);
    api.setEntries([{ id: '1', title: '某网站', username: 'me', password: 'p@ss' }]);
    await api.persistEntries();

    api.setMat(null); api.setRecord(disk.main);
    await api.unlockWithRecovery(ANSWER);            // 忘了主密码
    await api.changePrimaryKey(USB, 'newpw');        // 设个新的
    api.setMat(null); api.setRecord(disk.main);

    await api.unlockWithPrimary(USB, 'newpw');
    t(api.getEntries().length === 1, '新主密码生效，条目完好');

    api.setMat(null); api.setRecord(disk.main);
    let oldDead = false;
    try { await api.unlockWithPrimary(USB, 'oldpw'); } catch (e) { oldDead = true; }
    t(oldDead, '旧主密码已失效');

    api.setMat(null); api.setRecord(disk.main);
    await api.unlockWithRecovery(ANSWER);
    t(true, '恢复答案这条路仍在');
  }

  section('[6] 导出备份 → 换台电脑导入');
  {
    const { api, disk } = makeVault();
    await api.createVault(USB, 'pw1');
    await api.setEntries([{ id: 'x', title: 'X站', username: 'ux', password: 'px' }]);
    await api.persistEntries();

    const backup = JSON.parse(JSON.stringify({ app: 'lenyv-vault', version: 1, record: disk.main }));
    const fresh = makeVault();
    fresh.disk.main = JSON.parse(JSON.stringify(backup.record));
    fresh.api.setRecord(fresh.disk.main);            // 相当于页面 init() 读记录
    await fresh.api.unlockWithPrimary(USB, 'pw1');
    t(fresh.api.getEntries().length === 1, '换个浏览器 + 带 U 盘 → 能开且条目齐全');
  }

  section('[7] 密文里不该出现明文');
  {
    const { api, disk } = makeVault();
    await api.createVault(USB, 'pw1');
    await api.setEntries([{ id: 'x', title: '秘密标题', username: 'secret-user', password: 'secret-pass-123' }]);
    await api.persistEntries();
    await api.saveRecovery('你今天什么心情？', ANSWER);
    const dump = JSON.stringify(disk.main);
    t(dump.indexOf('secret-pass-123') === -1, '密码明文没出现在落盘数据里');
    t(dump.indexOf('secret-user') === -1, '账号明文没出现在落盘数据里');
    t(dump.indexOf('秘密标题') === -1, '标题明文没出现在落盘数据里');
    t(dump.indexOf(ANSWER) === -1, '恢复答案明文没出现在落盘数据里');
    t(dump.indexOf('你今天什么心情？') !== -1, '问题文本是明文（本来就要显示给用户）');
  }

  console.log('\n============================');
  console.log('  结果：' + pass + ' 通过 / ' + fail + ' 失败');
  console.log('============================');
  process.exit(fail ? 1 : 0);
})().catch(err => {
  console.error('\n测试崩了：', err);
  process.exit(1);
});
