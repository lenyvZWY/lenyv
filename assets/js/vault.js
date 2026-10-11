/* ============================================================
   lenyv 保险库 · 零知识本地密码本
   ------------------------------------------------------------
   设计要点（信封加密）：
     · 真正加密数据的是一把随机生成的「保险库密钥」(vaultKeyMat)。
     · 两把「钥匙」各自把保险库密钥再加密一份（wrap），任一钥匙都能取出它：
         钥匙A：U 盘密钥文件（something you have）+ 可选主密码（something you know）
         钥匙B：恢复问题答案（something you know，可与重要的人共享）
     · 明文与密钥绝不离开浏览器；落盘的只有密文。
     · 解锁后密钥只存在于内存；刷新页面即自动上锁。
   ============================================================ */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var DB_NAME = 'lenyv_vault';
  var STORE = 'vault';
  var REC_ID = 'main';
  var ITER = 250000;                       // PBKDF2 迭代次数
  var VERIFIER_TEXT = 'lenyv-vault-ok-v1'; // 用于校验钥匙是否正确
  var NO_PASSWORD = 'lenyv::no-master-password::v1';
  var DEFAULT_QUESTION = '你今天什么心情？';
  var enc = new TextEncoder();
  var dec = new TextDecoder();

  // ---------------- 基础工具 ----------------
  function u8ToB64(u8) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  }
  function b64ToU8(b64) {
    var s = atob(b64), u = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }
  function randomBytes(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return a; }
  function uid() {
    return (crypto.randomUUID ? crypto.randomUUID()
      : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
  }
  function setMsg(el, text, type) {
    if (!el) return;
    el.textContent = text || '';
    el.classList.remove('is-ok', 'is-err');
    if (type === 'ok') el.classList.add('is-ok');
    else if (type === 'err') el.classList.add('is-err');
  }
  function show(el) { if (el) el.classList.remove('hidden'); }
  function hide(el) { if (el) el.classList.add('hidden'); }

  // ---------------- 加密 ----------------
  function deriveAesKey(passphrase, saltBytes) {
    return crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: saltBytes, iterations: ITER, hash: 'SHA-256' },
          base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
        );
      });
  }
  function encryptBytes(key, bytes) {
    var iv = randomBytes(12);
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, bytes).then(function (ct) {
      return { iv: u8ToB64(iv), ct: u8ToB64(new Uint8Array(ct)) };
    });
  }
  function decryptBytes(key, blob) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToU8(blob.iv) }, key, b64ToU8(blob.ct))
      .then(function (pt) { return new Uint8Array(pt); });
  }
  function importDataKey(mat) {
    return crypto.subtle.importKey('raw', mat, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  // ---------------- IndexedDB ----------------
  function openDB() {
    return new Promise(function (res, rej) {
      var rq = indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = function () {
        var db = rq.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
  }
  function dbGet(id) {
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var rq = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { rej(rq.error); };
      });
    });
  }
  function dbPut(rec) {
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(rec);
        tx.oncomplete = function () { res(); };
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }

  // ---------------- 文件 / 下载 ----------------
  function readFileBytes(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(new Uint8Array(fr.result)); };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsArrayBuffer(file);
    });
  }
  function download(bytes, name, mime) {
    var blob = new Blob([bytes], mime ? { type: mime } : undefined);
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  function copyText(text, btn) {
    var done = function () {
      if (!btn) return;
      var old = btn.textContent;
      btn.textContent = '已复制';
      setTimeout(function () { btn.textContent = old; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
    } else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
    ta.remove();
  }

  // ---------------- 会话状态 ----------------
  var vaultKeyMat = null;   // 保险库密钥（内存）
  var record = null;        // 磁盘上的密文记录
  var entries = [];         // 解密后的条目
  var setupKeyBytes = null; // 「首次创建」时暂存的密钥文件字节
  var newKeyBytes = null;   // 「更换钥匙」时暂存的密钥文件字节
  var editingId = null;     // 正在编辑的条目 id

  // ---------------- 首次创建 ----------------
  function createVault(usbBytes, password) {
    var mat = randomBytes(32);
    var pass = (password && password.length) ? password : NO_PASSWORD;
    return deriveAesKey(pass, usbBytes).then(function (primaryKey) {
      return encryptBytes(primaryKey, mat);
    }).then(function (wrap) {
      var dk = importDataKey(mat);
      return Promise.all([dk, encryptBytes(dk, enc.encode(VERIFIER_TEXT))]).then(function (r) {
        return { wrap: wrap, verifier: r[1], mat: mat };
      });
    }).then(function (r) {
      var rec = {
        id: REC_ID,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        kdf: { iterations: ITER },
        primary: { wrap: r.wrap },
        verifier: r.verifier,
        data: null,
        recovery: null
      };
      return dbPut(rec).then(function () {
        record = rec; vaultKeyMat = r.mat; entries = [];
        enterVault();
      });
    });
  }

  // ---------------- 解锁 ----------------
  function finishUnlock(mat) {
    vaultKeyMat = mat;
    var dk = importDataKey(mat);
    return dk.then(function (k) {
      return decryptBytes(k, record.verifier).then(function (v) {
        if (dec.decode(v) !== VERIFIER_TEXT) throw new Error('WRONG_KEY');
        if (!record.data) { entries = []; return null; }
        return decryptBytes(k, record.data).then(function (pt) {
          entries = JSON.parse(dec.decode(pt)) || [];
        });
      });
    }).then(function () {
      enterVault();
    }).catch(function (err) {
      vaultKeyMat = null;
      if (err && err.message === 'WRONG_KEY') throw err;
      throw new Error('WRONG_KEY');
    });
  }

  function unlockWithPrimary(usbBytes, password) {
    var pass = (password && password.length) ? password : NO_PASSWORD;
    return deriveAesKey(pass, usbBytes).then(function (key) {
      return decryptBytes(key, record.primary.wrap).then(function (mat) {
        return finishUnlock(mat);
      }, function () { throw new Error('WRONG_KEY'); });
    });
  }
  function unlockWithRecovery(answer) {
    if (!record.recovery) throw new Error('NO_RECOVERY');
    return deriveAesKey(answer, b64ToU8(record.recovery.salt)).then(function (key) {
      return decryptBytes(key, record.recovery.wrap).then(function (mat) {
        return finishUnlock(mat);
      }, function () { throw new Error('WRONG_KEY'); });
    });
  }

  // ---------------- 保存条目 ----------------
  function persistEntries() {
    var dk = importDataKey(vaultKeyMat);
    return dk.then(function (k) {
      return encryptBytes(k, enc.encode(JSON.stringify(entries))).then(function (blob) {
        record.data = blob;
        record.updatedAt = Date.now();
        return dbPut(record);
      });
    });
  }

  // ---------------- 恢复问题 ----------------
  function saveRecovery(question, answer) {
    var salt = randomBytes(16);
    return deriveAesKey(answer, salt).then(function (key) {
      return encryptBytes(key, vaultKeyMat);
    }).then(function (wrap) {
      record.recovery = { question: question, salt: u8ToB64(salt), wrap: wrap };
      record.updatedAt = Date.now();
      return dbPut(record);
    });
  }

  // ---------------- 更换钥匙 ----------------
  function changePrimaryKey(usbBytes, password) {
    var pass = (password && password.length) ? password : NO_PASSWORD;
    return deriveAesKey(pass, usbBytes).then(function (key) {
      return encryptBytes(key, vaultKeyMat);
    }).then(function (wrap) {
      record.primary = { wrap: wrap };
      record.updatedAt = Date.now();
      return dbPut(record);
    });
  }

  // ---------------- 视图切换 ----------------
  function enterVault() {
    hide($('#lock-view'));
    show($('#vault-view'));
    renderEntries();
    updateRecoveryStatus();
  }
  function lock() {
    vaultKeyMat = null; entries = []; editingId = null;
    record = record || null;
    hide($('#vault-view'));
    show($('#lock-view'));
    $('#entries').innerHTML = '';
    // 清空输入
    ['#unlock-password', '#recovery-answer', '#setup-password', '#setup-password2'].forEach(function (s) {
      var el = $(s); if (el) el.value = '';
    });
    refreshLockUI();
  }

  function refreshLockUI() {
    var hasVault = !!record;
    $('#setup-panel').classList.toggle('hidden', hasVault);
    $('#unlock-panel').classList.toggle('hidden', !hasVault);
    if (hasVault) {
      // 恢复问题标签
      var hasRec = !!record.recovery;
      $('#recovery-not-set').classList.toggle('hidden', hasRec);
      $('#recovery-form').classList.toggle('hidden', !hasRec);
      if (hasRec) $('#recovery-question').textContent = record.recovery.question || DEFAULT_QUESTION;
    }
  }
  function updateRecoveryStatus() {
    var el = $('#r-status');
    var has = !!(record && record.recovery);
    if (el) {
      el.textContent = has
        ? '已设置（' + (record.recovery.question || DEFAULT_QUESTION) + '）'
        : '未设置';
    }
    var nudge = $('#recovery-nudge');
    if (nudge) nudge.classList.toggle('hidden', has);
  }

  // ---------------- 渲染条目 ----------------
  function renderEntries() {
    var box = $('#entries');
    var q = ($('#search').value || '').trim().toLowerCase();
    box.innerHTML = '';
    var list = entries.slice().sort(function (a, b) {
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    if (q) {
      list = list.filter(function (e) {
        return [e.title, e.site, e.username, e.note].join(' ').toLowerCase().indexOf(q) !== -1;
      });
    }
    $('#empty-hint').classList.toggle('hidden', list.length > 0);

    list.forEach(function (e) {
      box.appendChild(entryNode(e));
    });
  }

  function entryNode(e) {
    var el = document.createElement('article');
    el.className = 'entry';

    var top = document.createElement('div');
    top.className = 'entry-top';
    var t = document.createElement('div');
    t.className = 'entry-title';
    t.textContent = e.title || '(未命名)';
    var s = document.createElement('div');
    s.className = 'entry-site';
    s.textContent = e.site || '';
    top.appendChild(t); top.appendChild(s);
    el.appendChild(top);

    if (e.username) el.appendChild(line('账号', e.username, true));
    if (e.password) el.appendChild(passwordLine(e.password));
    if (e.note) {
      var n = document.createElement('div');
      n.className = 'entry-note';
      n.textContent = e.note;
      el.appendChild(n);
    }

    var tools = document.createElement('div');
    tools.className = 'entry-tools';
    tools.appendChild(mini('编辑', function () { openEdit(e.id); }));
    tools.appendChild(mini('删除', function () { removeEntry(e.id); }, true));
    el.appendChild(tools);
    return el;
  }

  function line(key, value, copyable) {
    var row = document.createElement('div');
    row.className = 'entry-line';
    var k = document.createElement('span'); k.className = 'k'; k.textContent = key;
    var v = document.createElement('span'); v.className = 'v'; v.textContent = value;
    row.appendChild(k); row.appendChild(v);
    if (copyable) row.appendChild(mini('复制', function (btn) { copyText(value, btn); }));
    return row;
  }

  function passwordLine(pw) {
    var row = document.createElement('div');
    row.className = 'entry-line';
    var k = document.createElement('span'); k.className = 'k'; k.textContent = '密码';
    var v = document.createElement('span'); v.className = 'v'; v.textContent = '••••••••';
    var shown = false;
    row.appendChild(k); row.appendChild(v);
    row.appendChild(mini('显示', function (btn) {
      shown = !shown;
      v.textContent = shown ? pw : '••••••••';
      btn.textContent = shown ? '隐藏' : '显示';
    }));
    row.appendChild(mini('复制', function (btn) { copyText(pw, btn); }));
    return row;
  }

  function mini(text, fn, danger) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'mini' + (danger ? ' danger' : '');
    b.textContent = text;
    b.addEventListener('click', function () { fn(b); });
    return b;
  }

  function removeEntry(id) {
    var e = entries.filter(function (x) { return x.id === id; })[0];
    if (!e) return;
    if (!window.confirm('删除「' + (e.title || '未命名') + '」？此操作不可撤销。')) return;
    entries = entries.filter(function (x) { return x.id !== id; });
    persistEntries().then(renderEntries);
  }

  // ---------------- 条目弹层 ----------------
  function openAdd() {
    editingId = null;
    $('#modal-title').textContent = '新条目';
    $('#f-title').value = ''; $('#f-site').value = '';
    $('#f-user').value = ''; $('#f-pass').value = ''; $('#f-note').value = '';
    show($('#modal'));
    $('#f-title').focus();
  }
  function openEdit(id) {
    var e = entries.filter(function (x) { return x.id === id; })[0];
    if (!e) return;
    editingId = id;
    $('#modal-title').textContent = '编辑条目';
    $('#f-title').value = e.title || '';
    $('#f-site').value = e.site || '';
    $('#f-user').value = e.username || '';
    $('#f-pass').value = e.password || '';
    $('#f-note').value = e.note || '';
    show($('#modal'));
  }
  function saveEntry() {
    var title = $('#f-title').value.trim();
    var site = $('#f-site').value.trim();
    var username = $('#f-user').value.trim();
    var password = $('#f-pass').value;
    var note = $('#f-note').value.trim();
    if (!title && !username && !password) {
      alert('至少填一个标题或账号吧。');
      return;
    }
    if (editingId) {
      var e = entries.filter(function (x) { return x.id === editingId; })[0];
      if (e) {
        e.title = title; e.site = site; e.username = username;
        e.password = password; e.note = note; e.updatedAt = Date.now();
      }
    } else {
      entries.push({
        id: uid(), title: title, site: site, username: username,
        password: password, note: note, createdAt: Date.now(), updatedAt: Date.now()
      });
    }
    persistEntries().then(function () {
      hide($('#modal'));
      renderEntries();
    });
  }
  function genPassword() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+';
    var len = 20, out = '', limit = 256 - (256 % chars.length);
    while (out.length < len) {
      var a = randomBytes(len * 2);
      for (var i = 0; i < a.length && out.length < len; i++) {
        if (a[i] < limit) out += chars.charAt(a[i] % chars.length);
      }
    }
    $('#f-pass').value = out;
  }

  // ---------------- 导入 / 导出 ----------------
  function exportBackup() {
    var payload = JSON.stringify({ app: 'lenyv-vault', version: 1, record: record }, null, 2);
    var d = new Date();
    var name = 'lenyv-vault-backup-' + d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + '.json';
    download(payload, name, 'application/json');
  }
  function importBackup(file) {
    readFileBytes(file).then(function (bytes) {
      var obj = JSON.parse(dec.decode(bytes));
      var rec = obj && obj.record ? obj.record : obj;
      if (!rec || !rec.primary || !rec.verifier) throw new Error('BAD_FILE');
      return dbPut(rec).then(function () {
        record = rec;
        alert('导入成功。请用这份备份对应的钥匙解锁。');
        lock();
      });
    }).catch(function () {
      alert('导入失败：这不是有效的 lenyv 保险库备份文件。');
    });
  }

  // ---------------- 事件绑定 ----------------
  function bind() {
    // 标签页
    $$('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        $$('.tab').forEach(function (t) { t.classList.remove('is-active'); });
        tab.classList.add('is-active');
        var name = tab.getAttribute('data-tab');
        $('#tab-usb').classList.toggle('hidden', name !== 'usb');
        $('#tab-recovery').classList.toggle('hidden', name !== 'recovery');
      });
    });

    // 生成密钥文件（首次创建）
    $('#btn-generate-key').addEventListener('click', function () {
      setupKeyBytes = randomBytes(32);
      download(setupKeyBytes, 'lenyv-vault-key.bin');
      setMsg($('#setup-key-status'), '已生成并下载。请把它存进 U 盘，然后回来点「创建保险库」。', 'ok');
    });
    $('#input-key-file-setup').addEventListener('change', function (ev) {
      var f = ev.target.files && ev.target.files[0];
      if (!f) return;
      readFileBytes(f).then(function (b) {
        setupKeyBytes = b;
        setMsg($('#setup-key-status'), '已选择：「' + f.name + '」', 'ok');
      });
    });

    // 创建
    $('#btn-create').addEventListener('click', function () {
      if (!setupKeyBytes) { setMsg($('#setup-msg'), '还没有密钥文件：先生成或选择一个。', 'err'); return; }
      var p1 = $('#setup-password').value, p2 = $('#setup-password2').value;
      if (p1 !== p2) { setMsg($('#setup-msg'), '两次输入的主密码不一致。', 'err'); return; }
      setMsg($('#setup-msg'), '正在创建……');
      createVault(setupKeyBytes, p1).then(function () {
        setupKeyBytes = null;
        setMsg($('#setup-msg'), '');
      }).catch(function (e) {
        setMsg($('#setup-msg'), '创建失败：' + (e && e.message ? e.message : e), 'err');
      });
    });

    // 解锁（U 盘）
    var unlockBytes = null;
    $('#input-key-file').addEventListener('change', function (ev) {
      var f = ev.target.files && ev.target.files[0];
      if (!f) return;
      readFileBytes(f).then(function (b) {
        unlockBytes = b;
        setMsg($('#unlock-key-status'), '已选择：「' + f.name + '」', 'ok');
      });
    });
    $('#btn-unlock').addEventListener('click', function () {
      if (!unlockBytes) { setMsg($('#unlock-msg'), '先选择 U 盘里的密钥文件。', 'err'); return; }
      setMsg($('#unlock-msg'), '正在解锁……');
      unlockWithPrimary(unlockBytes, $('#unlock-password').value).then(function () {
        unlockBytes = null;
        setMsg($('#unlock-msg'), '');
      }).catch(function () {
        setMsg($('#unlock-msg'), '打不开：密钥文件或主密码不对。', 'err');
      });
    });

    // 解锁（恢复问题）
    $('#btn-unlock-recovery').addEventListener('click', function () {
      var ans = $('#recovery-answer').value;
      if (!ans) { setMsg($('#unlock-msg'), '请输入答案。', 'err'); return; }
      setMsg($('#unlock-msg'), '正在解锁……');
      Promise.resolve().then(function () { return unlockWithRecovery(ans); }).then(function () {
        $('#recovery-answer').value = '';
        setMsg($('#unlock-msg'), '');
      }).catch(function () {
        setMsg($('#unlock-msg'), '打不开：答案不对，或者还没有设置恢复问题。', 'err');
      });
    });

    // 解锁后的工具
    $('#btn-lock').addEventListener('click', lock);
    $('#btn-add').addEventListener('click', openAdd);
    $('#search').addEventListener('input', renderEntries);
    $('#btn-export').addEventListener('click', exportBackup);
    $('#input-import').addEventListener('change', function (ev) {
      var f = ev.target.files && ev.target.files[0];
      if (f) importBackup(f);
      ev.target.value = '';
    });

    // 条目弹层
    $('#btn-cancel').addEventListener('click', function () { hide($('#modal')); });
    $('#btn-save').addEventListener('click', saveEntry);
    $('#btn-gen').addEventListener('click', genPassword);

    // 恢复问题弹层
    function openRecoveryModal() {
      $('#r-question').value = (record.recovery && record.recovery.question) || DEFAULT_QUESTION;
      $('#r-answer').value = '';
      updateRecoveryStatus();
      show($('#recovery-modal'));
      $('#r-answer').focus();
    }
    $('#btn-recovery-settings').addEventListener('click', openRecoveryModal);
    $('#btn-nudge-set').addEventListener('click', openRecoveryModal);
    $('#btn-r-cancel').addEventListener('click', function () { hide($('#recovery-modal')); });
    $('#btn-r-save').addEventListener('click', function () {
      var q = $('#r-question').value.trim() || DEFAULT_QUESTION;
      var a = $('#r-answer').value;
      if (!a) { alert('答案不能为空。'); return; }
      saveRecovery(q, a).then(function () {
        updateRecoveryStatus();
        hide($('#recovery-modal'));
        alert('恢复问题已保存。以后 U 盘不在，就用这句话开门。');
      });
    });

    // 更换钥匙弹层
    $('#btn-change-key').addEventListener('click', function () {
      newKeyBytes = null;
      setMsg($('#k-status'), '尚未选择');
      $('#k-pass').value = ''; $('#k-pass2').value = '';
      setMsg($('#k-msg'), '');
      show($('#key-modal'));
    });
    $('#btn-k-cancel').addEventListener('click', function () { hide($('#key-modal')); });
    $('#btn-k-gen').addEventListener('click', function () {
      newKeyBytes = randomBytes(32);
      download(newKeyBytes, 'lenyv-vault-key-new.bin');
      setMsg($('#k-status'), '已生成并下载。存进 U 盘后点「保存」。', 'ok');
    });
    $('#input-k-file').addEventListener('change', function (ev) {
      var f = ev.target.files && ev.target.files[0];
      if (!f) return;
      readFileBytes(f).then(function (b) {
        newKeyBytes = b;
        setMsg($('#k-status'), '已选择：「' + f.name + '」', 'ok');
      });
    });
    $('#btn-k-save').addEventListener('click', function () {
      if (!newKeyBytes) { setMsg($('#k-msg'), '先生成或选择一个新密钥文件。', 'err'); return; }
      if ($('#k-pass').value !== $('#k-pass2').value) { setMsg($('#k-msg'), '两次主密码不一致。', 'err'); return; }
      setMsg($('#k-msg'), '正在保存……');
      changePrimaryKey(newKeyBytes, $('#k-pass').value).then(function () {
        newKeyBytes = null;
        hide($('#key-modal'));
        alert('钥匙已更换。旧钥匙从此刻起失效。');
      }).catch(function (e) {
        setMsg($('#k-msg'), '保存失败：' + (e && e.message ? e.message : e), 'err');
      });
    });

    // 点遮罩关闭弹层
    [$('#modal'), $('#recovery-modal'), $('#key-modal')].forEach(function (m) {
      m.addEventListener('click', function (ev) { if (ev.target === m) hide(m); });
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { hide($('#modal')); hide($('#recovery-modal')); hide($('#key-modal')); }
    });
  }

  // ---------------- 启动 ----------------
  function init() {
    if (!window.crypto || !window.crypto.subtle) {
      document.body.innerHTML = '<div class="container" style="padding:80px 0">' +
        '<h1>这个浏览器不支持加密功能</h1>' +
        '<p>请用较新的 Chrome / Edge / Firefox，并通过 https 或 localhost 打开本页。</p></div>';
      return;
    }
    bind();
    dbGet(REC_ID).then(function (rec) {
      record = rec || null;
      refreshLockUI();
    }, function () {
      record = null;
      refreshLockUI();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
