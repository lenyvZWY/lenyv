/* ============================================================================
   保险库 · 桌面启动器
   ============================================================================
   【它是干什么的】
   双击一下，弹出一个小窗口，里面就是你的保险库 —— 看起来、用起来都像
   一个装在电脑上的应用：没有地址栏、没有标签页、不用记网址。

   【为什么不用下载任何东西】
   它不是靠 Electron 那种几百兆的框架，而是：
     1. 在本机起一个只自己能看到的小服务（127.0.0.1，外面访问不到）
     2. 用它把保险库页面发出来
     3. 用你电脑上本来就有的 Edge / Chrome，以「应用模式」打开它
        —— 应用模式就是没有地址栏、没有标签页的那种独立窗口
   所以零依赖、零下载、启动很快。

   【比网页版多出来的能力】
   · 自动扫描所有盘，找到 U 盘里的密钥文件（不用再手动「选文件」）
   · 关掉窗口 = 服务自动退出（见下面的心跳机制）

   【怎么退出】
   关掉那个窗口就行。启动器发现 30 秒收不到页面的心跳，就自己退出。
   ============================================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const KEY_FILE_NAMES = ['vault-key.bin', 'vault-key-new.bin'];

/* 记一行日志。既打到控制台，也写进项目里的 desktop-launch.log ——
   双击启动时控制台是最小化的，出问题把那个日志发给开发者就能定位。 */
const LOG_FILE = path.join(ROOT, 'desktop-launch.log');
function log(msg) {
  const line = '[' + new Date().toLocaleString() + '] ' + msg;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + os.EOL); } catch (e) { /* 写不了就算了 */ }
}

/* ---------------------------------------------------------------------------
   静态文件白名单：只发这几个形状的路径
   --------------------------------------------------------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};
const ALLOWED = [
  /^\/$/,
  /^\/index\.html$/,
  /^\/favicon\.ico$/,
  /^\/assets\/css\/[A-Za-z0-9_.-]+$/,
  /^\/assets\/js\/[A-Za-z0-9_.-]+$/,
  /^\/download\/[A-Za-z0-9_.-]+$/
];

/* ---------------------------------------------------------------------------
   给页面的「桌面能力」——用 HTTP 接口实现，页面那边看起来跟桌面版一样
   --------------------------------------------------------------------------- */
const BRIDGE = `<script>
/* 由桌面启动器注入：让页面以为自己在桌面应用里（接口形状跟 Electron 版一致） */
window.desktop = {
  isDesktop: true,
  platform: 'win32',
  listDrives: function () {
    return fetch('/api/desktop/drives').then(function (r) { return r.json(); });
  },
  findKeyFiles: function () {
    return fetch('/api/desktop/keys').then(function (r) { return r.json(); });
  },
  readFile: function (p) {
    return fetch('/api/desktop/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: p })
    }).then(function (r) { return r.json(); });
  }
};
/* 心跳：每 5 秒告诉启动器「窗口还开着」；窗口一关，启动器就自己退出 */
setInterval(function () {
  fetch('/api/desktop/ping', { method: 'POST' }).catch(function () {});
}, 5000);
</script>`;

/* ---------------------------------------------------------------------------
   盘符扫描
   --------------------------------------------------------------------------- */
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

function findKeyFiles() {
  const found = [];
  for (const drive of listDrives()) {
    for (const name of KEY_FILE_NAMES) {
      const p = drive + '/' + name;
      try {
        const st = fs.statSync(p);
        if (st.isFile()) found.push({ path: p, size: st.size, mtime: st.mtimeMs });
      } catch (e) { /* 这个盘没这个文件 */ }
    }
  }
  // 32 字节的排前面 —— 那才是我们生成的密钥文件
  found.sort((a, b) => (b.size === 32 ? 1 : 0) - (a.size === 32 ? 1 : 0));
  return found;
}

/* ---------------------------------------------------------------------------
   服务
   --------------------------------------------------------------------------- */
let lastSeen = Date.now();     // 最后一次收到页面心跳的时间
let everPinged = false;        // 窗口有没有真的连上来过（用来确认启动成功）

function sendJson(res, obj, status) {
  res.writeHead(status || 200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (d) => { s += d; if (s.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(JSON.parse(s || '{}')); } catch (e) { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

  // ---- 桌面能力接口 ----
  if (urlPath.startsWith('/api/desktop/')) {
    if (urlPath === '/api/desktop/ping') {
      lastSeen = Date.now();
      // 第一次收到心跳 = 窗口真的打开了。记一行，出问题时好排查。
      if (!everPinged) {
        everPinged = true;
        log('窗口已连上，可以开始用了。');
      }
      return sendJson(res, { ok: true });
    }
    if (urlPath === '/api/desktop/drives') return sendJson(res, listDrives());
    if (urlPath === '/api/desktop/keys') return sendJson(res, findKeyFiles());
    if (urlPath === '/api/desktop/read') {
      const body = await readBody(req);
      try {
        const p = String(body.path || '');
        const st = fs.statSync(p);
        // 只读小文件，避免被页面指使去读什么奇怪的大文件
        if (!st.isFile() || st.size > 1024 * 1024) throw new Error('too big');
        const buf = fs.readFileSync(p);
        return sendJson(res, { name: path.basename(p), path: p, bytes: Array.from(buf) });
      } catch (e) {
        return sendJson(res, { error: '读不到这个文件' }, 400);
      }
    }
    return sendJson(res, { error: '不认识的接口' }, 404);
  }

  // ---- 静态文件 ----
  if (!ALLOWED.some(re => re.test(urlPath))) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }

  const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const resolved = path.resolve(path.join(ROOT, rel));
  // 双保险：路径必须还在项目目录里（防目录穿越）
  if (!resolved.startsWith(path.resolve(ROOT))) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(resolved, 'utf8', (err, text) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    let out = text;
    // 首页：把「桌面能力桥」注入进去。
    // 必须在 vault.js **之前**注入 —— 因为 vault.js 一加载就会读 window.desktop。
    if (rel === 'index.html') {
      out = out.replace('<script src="/assets/js/vault.js"></script>', BRIDGE + '\n  <script src="/assets/js/vault.js"></script>');
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(out);
  });
});

/* ---------------------------------------------------------------------------
   找一个能用的浏览器（应用模式）
   --------------------------------------------------------------------------- */
function findBrowser() {
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch (e) { /* 继续找 */ }
  }
  return null;
}

/* ---------------------------------------------------------------------------
   启动
   --------------------------------------------------------------------------- */
// 加 --no-browser（或环境变量 VAULT_NO_BROWSER=1）就只起服务、不开窗口
const NO_BROWSER = process.argv.includes('--no-browser') || process.env.VAULT_NO_BROWSER === '1';

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const url = 'http://127.0.0.1:' + port + '/';

  if (NO_BROWSER) {
    log('PORT=' + port);
    log('（--no-browser 模式：只起服务，不开窗口）');
    return;
  }

  const browser = findBrowser();
  if (browser) {
    // --app= 就是「应用模式」：没有地址栏、没有标签页，看上去就是个独立软件
    spawn(browser, ['--app=' + url, '--window-size=1000,780'], {
      detached: true,
      stdio: 'ignore'
    }).unref();
    log('保险库已启动，正在打开窗口……');
  } else {
    log('没找到 Edge / Chrome，请手动用浏览器打开： ' + url);
  }

  // 心跳看门狗：30 秒收不到页面心跳，说明窗口关了 → 自己退出
  setInterval(() => {
    if (Date.now() - lastSeen > 30000) {
      log('窗口已关闭，退出。');
      process.exit(0);
    }
  }, 5000);
});
