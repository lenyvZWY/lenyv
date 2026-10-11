/* ============================================================================
   保险库 · 桌面应用主进程（Electron 版 · 备用方案）
   ============================================================================
   ⚠️ 这份是「升级版」的桌面壳，目前**还没用上**，原因见下。

   【现状】
   现在能用的是 desktop/launcher.cjs —— 它不需要下载任何东西，
   双击 start-vault.cmd 就能开窗口，效果和这个几乎一样。

   【为什么这份先放着】
   Electron 需要下载一个约 200MB 的运行时。本机网络访问 GitHub Releases
   受限，下了好几次都没成功，所以先用轻量方案顶上。
   等哪天网络方便了，做这两步就能切换成这一份：
       npm i -D electron
       npx electron .
   （界面、数据、逻辑全都共用同一份代码，不需要改任何页面。）

   【它比启动器版好在哪】
   · 真正的独立应用：有自己的图标、自己的进程，不依赖你装没装 Edge
   · 以后可以用 electron-builder 打包成一个 .exe，直接双击安装

   【下面是原本的说明】
   --------------------------------------------------------------------------
   把网页版保险库装进一个真正的桌面窗口里：双击就能打开，
   有自己的窗口、自己的数据目录，不用再开浏览器、也不用记网址。

   【为什么要在里面起一个本地小服务】
   网页版的路径都是 /assets/... 这种「根路径」写法，直接读文件会找不到。
   所以在 127.0.0.1 上起一个只监听本机的小服务，把必要文件发出去 ——
   这样网页版一行代码都不用改，全部逻辑和测试都能原样复用。
   注意：只服务本机（127.0.0.1），外面访问不到；而且只放行白名单里的文件。

   【桌面版多出来的能力】（网页版做不到）
   · 自动扫描所有盘，找到 U 盘里的密钥文件 —— 不用再手动「选文件」
   · 数据存在应用自己的目录里，跟浏览器的「清缓存」完全无关
   ============================================================================ */

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 项目根目录（desktop/ 的上一级）
const ROOT = path.join(__dirname, '..');

// 密钥文件的默认名字（跟网页版生成的一致）
const KEY_FILE_NAMES = ['vault-key.bin', 'vault-key-new.bin'];

/* ---------------------------------------------------------------------------
   本地静态服务：只发白名单里的文件
   --------------------------------------------------------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

// 白名单：只有这些形状的路径会被发出去，别的一律 404
const ALLOWED = [
  /^\/$/,
  /^\/index\.html$/,
  /^\/favicon\.ico$/,
  /^\/assets\/css\/[A-Za-z0-9_.-]+$/,
  /^\/assets\/js\/[A-Za-z0-9_.-]+$/,
  /^\/download\/[A-Za-z0-9_.-]+$/
];

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

      // 不在白名单里 → 直接 404，不泄露目录结构
      if (!ALLOWED.some(re => re.test(urlPath))) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }

      const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
      const filePath = path.join(ROOT, rel);

      // 双保险：解析出来的路径必须还在项目目录里面（防目录穿越）
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(path.resolve(ROOT))) {
        res.writeHead(403).end('Forbidden');
        return;
      }

      fs.readFile(resolved, (err, data) => {
        if (err) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('Not found');
          return;
        }
        res.writeHead(200, {
          'content-type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
          'cache-control': 'no-store'   // 桌面版不需要缓存，避免改完看不到效果
        });
        res.end(data);
      });
    });

    // 只绑本机回环地址；端口让系统随便给一个空闲的
    server.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

/* ---------------------------------------------------------------------------
   U 盘识别：扫所有盘符的根目录，找密钥文件
   --------------------------------------------------------------------------- */

// 列出当前所有存在的盘符，例如 ['C:', 'D:', 'E:']
function listDrives() {
  const out = [];
  for (let i = 65; i <= 90; i++) {          // A 到 Z
    const letter = String.fromCharCode(i);
    try {
      if (fs.existsSync(letter + ':/')) out.push(letter + ':');
    } catch (e) { /* 没有这个盘，跳过 */ }
  }
  return out;
}

// 在所有盘的根目录里找密钥文件
function findKeyFiles() {
  const found = [];
  for (const drive of listDrives()) {
    for (const name of KEY_FILE_NAMES) {
      const p = drive + '/' + name;
      try {
        const st = fs.statSync(p);
        if (st.isFile()) {
          // 顺手确认一下长度：网页版生成的是 32 字节
          found.push({ path: p, size: st.size, mtime: st.mtimeMs });
        }
      } catch (e) { /* 这个盘没有这个文件 */ }
    }
  }
  // 32 字节的排前面（那才是我们生成的密钥文件）
  found.sort((a, b) => (b.size === 32 ? 1 : 0) - (a.size === 32 ? 1 : 0));
  return found;
}

/* ---------------------------------------------------------------------------
   窗口
   --------------------------------------------------------------------------- */
let mainWindow = null;
let server = null;

async function createWindow() {
  server = await startServer();
  const port = server.address().port;

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 780,
    minWidth: 420,
    minHeight: 560,
    backgroundColor: '#0c0d10',
    autoHideMenuBar: true,
    title: '保险库',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,   // 页面拿不到 Node，只能通过下面那几个受限接口
      nodeIntegration: false,   // 安全：绝不让页面直接碰文件系统
      sandbox: false            // preload 里要用 require
    }
  });

  mainWindow.loadURL('http://127.0.0.1:' + port + '/');

  // 页面里的外链一律用系统浏览器打开，不在应用窗口里跳走
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

/* ---------------------------------------------------------------------------
   给页面的受限接口（只有这三个，别的一概不给）
   --------------------------------------------------------------------------- */
ipcMain.handle('list-drives', () => listDrives());
ipcMain.handle('find-key-files', () => findKeyFiles());
ipcMain.handle('read-file', (evt, filePath) => {
  // 只读文件内容，而且限大小 —— 免得被页面指使去读什么奇怪的大文件
  const MAX = 1024 * 1024;
  const st = fs.statSync(filePath);
  if (!st.isFile() || st.size > MAX) throw new Error('文件不可读或过大');
  const buf = fs.readFileSync(filePath);
  return { name: path.basename(filePath), path: filePath, bytes: Array.from(buf) };
});

/* ---------------------------------------------------------------------------
   启动
   --------------------------------------------------------------------------- */
// 只允许开一个窗口；重复启动就把已有窗口拉到前面
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(createWindow);

  app.on('window-all-closed', () => {
    if (server) { try { server.close(); } catch (e) { /* ignore */ } }
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
