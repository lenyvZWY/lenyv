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

  // ---------------- 报错翻译成人话 ----------------
  var ERROR_ZH = {
    // 本程序自己抛出的
    WRONG_KEY: '打不开：密钥文件或主密码不对。先确认 U 盘里的那个文件选对了没有。',
    RECOVERY_WRONG: '打不开：答案不对。再想想那句话是怎么说的。',
    NO_RECOVERY: '这个保险库还没有设置恢复问题，所以这条路暂时走不通。',
    NO_VAULT: '这台设备上还没有保险库。',
    BAD_FILE: '这不是有效的 lenyv 保险库备份文件。',
    STORAGE_BLOCKED: '浏览器不让这个页面保存数据。如果你是在「预览小窗口」里打开的，请改用真正的浏览器窗口打开本页；如果是无痕模式，请换成普通窗口。',
    STORAGE_ABORTED: '写入本地存储时被打断了，请再试一次。',
    STORAGE_FULL: '本地存储空间不够了，清理一点浏览器数据再试。',
    // 浏览器发出的（名称 → 中文）
    NotAllowedError: '浏览器拒绝了这次操作。如果你正在用「无痕 / 隐私模式」，请换成普通窗口打开本页。',
    SecurityError: '浏览器出于安全策略挡住了本地存储。请用普通窗口（不是无痕模式）打开本页。',
    QuotaExceededError: '本地存储空间不够了，清理一点浏览器数据再试。',
    InvalidStateError: '本地数据库状态异常，写不进去。刷新页面重来一次通常就好了。',
    VersionError: '本地数据库版本对不上，无法打开。',
    ConstraintError: '本地数据库写入冲突，请重试。',
    TransactionInactiveError: '本地数据库事务已结束，请重试。',
    AbortError: '操作被中断了，请重试一次。',
    DataError: '数据格式有问题，处理不了。',
    OperationError: '加密操作没能完成。请确认密钥文件是完好的、没被别人改过。',
    UnknownError: '浏览器报了一个未知错误，请重试。',
    NetworkError: '本地存储被占用，请关掉其他打开了本页的标签页再试。'
  };

  function friendlyError(err) {
    if (!err) return '没能完成，请再试一次。';
    if (typeof err === 'string') return ERROR_ZH[err] || '没能完成，请再试一次。';
    if (err.message && ERROR_ZH[err.message]) return ERROR_ZH[err.message];
    if (err.name && ERROR_ZH[err.name]) return ERROR_ZH[err.name];
    if (err.name === 'TypeError') {
      return '这个浏览器缺少所需的加密功能。请用较新的 Chrome / Edge / Firefox，并通过 https 或 localhost 打开本页。';
    }
    var m = String(err.message || '');
    if (/indexeddb|database|transaction/i.test(m)) return '本地数据库打不开。如果你在用「无痕 / 隐私模式」，换成普通窗口再试。';
    if (/storage|quota/i.test(m)) return '本地存储不可用，换成普通窗口再试。';
    return '没能完成，请再试一次。';
  }

  // 中文主提示 + 可折叠的英文技术细节（方便排查，看不懂可忽略）
  function showError(el, prefix, err) {
    if (!el) return;
    el.textContent = '';
    el.classList.remove('is-ok');
    el.classList.add('is-err');
    var span = document.createElement('span');
    span.textContent = (prefix || '') + friendlyError(err);
    el.appendChild(span);

    var detail = '';
    if (err) {
      detail = (typeof err === 'string') ? err
        : ((err.name ? err.name + ': ' : '') + (err.message || ''));
    }
    if (detail && detail.replace(/[:\s]/g, '') !== '') {
      var box = document.createElement('details');
      box.className = 'tech';
      var sum = document.createElement('summary');
      sum.textContent = '技术细节（看不懂可忽略；需要我帮忙时复制这段给我）';
      var code = document.createElement('code');
      code.textContent = detail;
      box.appendChild(sum);
      box.appendChild(code);
      el.appendChild(box);
    }
  }

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

  // ---------------- 存储层 ----------------
  // 首选 IndexedDB；若浏览器禁用、无痕模式、或预览面板里不可用，自动降级到 localStorage。
  var LS_KEY = 'lenyv_vault_record_v1';
  var idbUsable = null; // null = 还没探测过

  function probeStorage() {
    if (idbUsable !== null) return Promise.resolve(idbUsable);
    return new Promise(function (resolve) {
      var done = false;
      function finish(v) { if (done) return; done = true; idbUsable = v; resolve(v); }
      if (!window.indexedDB) return finish(false);
      var t = setTimeout(function () { finish(false); }, 2500);
      try {
        var rq = indexedDB.open(DB_NAME, 1);
        rq.onupgradeneeded = function () {
          var db = rq.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        };
        rq.onsuccess = function () { clearTimeout(t); try { rq.result.close(); } catch (e) { /* ignore */ } finish(true); };
        rq.onerror = function () { clearTimeout(t); finish(false); };
        rq.onblocked = function () { clearTimeout(t); finish(false); };
      } catch (e) { clearTimeout(t); finish(false); }
    });
  }

  function openDB() {
    return new Promise(function (res, rej) {
      var rq = indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = function () {
        var db = rq.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error || new Error('STORAGE_BLOCKED')); };
      rq.onblocked = function () { rej(new Error('STORAGE_BLOCKED')); };
    });
  }
  function idbGet(id) {
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var rq = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
        rq.onsuccess = function () { res(rq.result || null); };
        rq.onerror = function () { rej(rq.error); };
      });
    });
  }
  function idbPut(rec) {
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(rec);
        tx.oncomplete = function () { res(); };
        tx.onerror = function () { rej(tx.error || new Error('STORAGE_ABORTED')); };
        tx.onabort = function () { rej(tx.error || new Error('STORAGE_ABORTED')); };
      });
    });
  }
  function lsGet() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      return (obj && obj.id) ? obj : null;
    } catch (e) { return null; }
  }
  function lsPut(rec) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(rec)); }
    catch (e) {
      if (e && (e.name === 'SecurityError' || e.name === 'NotAllowedError')) throw new Error('STORAGE_BLOCKED');
      throw new Error('STORAGE_FULL');
    }
  }
  function lsClear() { try { localStorage.removeItem(LS_KEY); } catch (e) { /* ignore */ } }

  function storeGet(id) {
    return probeStorage().then(function (useIdb) {
      if (!useIdb) return lsGet();
      return idbGet(id).then(function (rec) {
        return rec || lsGet();
      }, function () { return lsGet(); });
    });
  }
  function storePut(rec) {
    return probeStorage().then(function (useIdb) {
      if (!useIdb) { lsPut(rec); return; }
      return idbPut(rec).then(function () { lsClear(); }, function () { lsPut(rec); });
    });
  }
  function storageLabel() {
    return probeStorage().then(function (useIdb) {
      return useIdb ? '浏览器本地数据库（IndexedDB）' : '浏览器本地存储（localStorage · 降级模式）';
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
      // 注意：importDataKey 返回的是 Promise，必须先取到真正的 CryptoKey 才能用来加密
      return importDataKey(mat).then(function (dk) {
        return encryptBytes(dk, enc.encode(VERIFIER_TEXT)).then(function (verifier) {
          return { wrap: wrap, verifier: verifier, mat: mat };
        });
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
      return storePut(rec).then(function () {
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
        return storePut(record);
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
      return storePut(record);
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
      return storePut(record);
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
    // 把所有「显示」按钮复位成隐藏状态
    $$('.pw-toggle').forEach(function (b) { b.textContent = '显示'; });
    $$('.pw-row input').forEach(function (i) { i.type = 'password'; });
    var hint = $('#setup-pw-hint');
    if (hint) { hint.textContent = '看不清就先点「显示」，确认没打错再创建。'; hint.classList.remove('is-ok', 'is-err'); }
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
      return storePut(rec).then(function () {
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

    // 密码「显示 / 隐藏」：全站通用，点一下就能看清自己输了什么
    document.addEventListener('click', function (ev) {
      var btn = (ev.target && ev.target.closest) ? ev.target.closest('.pw-toggle') : null;
      if (!btn) return;
      var row = btn.closest('.pw-row');
      var input = row ? row.querySelector('input') : null;
      if (!input) return;
      var willShow = input.type === 'password';
      input.type = willShow ? 'text' : 'password';
      btn.textContent = willShow ? '隐藏' : '显示';
      input.focus();
    });

    // 创建时的实时提示：输了几个字符 / 两次是否一致
    function updatePwHint() {
      var el = $('#setup-pw-hint');
      if (!el) return;
      var p1 = $('#setup-password').value, p2 = $('#setup-password2').value;
      el.classList.remove('is-ok', 'is-err');
      if (!p1 && !p2) { el.textContent = '看不清就先点「显示」，确认没打错再创建。'; return; }
      if (!p1) { el.textContent = '下面那栏已输入 ' + p2.length + ' 个字符；上面那栏还没填。'; return; }
      if (p1 !== p2) {
        el.textContent = '两次输入不一致（上面 ' + p1.length + ' 个字符，下面 ' + p2.length + ' 个字符）。';
        el.classList.add('is-err');
        return;
      }
      el.textContent = '两次一致，共 ' + p1.length + ' 个字符，可以创建了。';
      el.classList.add('is-ok');
    }
    $('#setup-password').addEventListener('input', updatePwHint);
    $('#setup-password2').addEventListener('input', updatePwHint);

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
        showError($('#setup-msg'), '创建失败：', e);
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
      }).catch(function (e) {
        showError($('#unlock-msg'), '', e);
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
      }).catch(function (e) {
        if (e && e.message === 'NO_RECOVERY') { showError($('#unlock-msg'), '', e); return; }
        showError($('#unlock-msg'), '', new Error('RECOVERY_WRONG'));
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
        showError($('#k-msg'), '保存失败：', e);
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
    storageLabel().then(function (label) {
      var el = $('#storage-note');
      if (el) el.textContent = label;
    });
    storeGet(REC_ID).then(function (rec) {
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
