/* ============================================================
   保险库 · 单文件打包脚本
   ------------------------------------------------------------
   干什么：把保险库页面 + 3 个 CSS + vault.js，全部内联进**一个** HTML 文件。
   结果：download/vault.html —— 双击就能用，不需要服务器、不需要联网。

   运行：  node tools/build-standalone.cjs
   （需在项目根目录运行）

   原理：直接读真实的 index.html 做替换，而不是另抄一份模板 ——
   这样以后改了 index.html，重新跑一遍就能同步，不会两份代码各走各的。
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'download');
const OUT_FILE = path.join(OUT_DIR, 'vault.html');

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = p => fs.existsSync(path.join(ROOT, p));

// ---- 读取要内联的资源 ----
const CSS_FILES = ['assets/css/tokens.css', 'assets/css/main.css', 'assets/css/vault.css'];
const css = CSS_FILES.map(read).join('\n\n');
const vaultJs = read('assets/js/vault.js');

let html = read('index.html');

/* ---- 1. 去掉联网依赖 ----
   离线版不联网：Google 字体（用系统字体兜底）和云服务 SDK 都去掉。
   页头页脚本来就写在 index.html 里，不需要额外处理。 */
html = html
  .replace(/^\s*<link rel="preconnect"[^>]*>\s*$/gm, '')
  .replace(/^\s*<link href="https:\/\/fonts\.googleapis\.com[^>]*>\s*$/gm, '')
  .replace(/^\s*<!-- 云服务 SDK[^>]*-->\s*$/gm, '')
  .replace(/^\s*<script src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>\s*$/gm, '');

/* ---- 2. 三个 CSS 合并成一个 <style> ---- */
const styleTag = '<style>\n' + css +
  '\n\n/* 离线单文件版：云同步需要联网 + 固定域名，这里藏起来 */\n#cloud-bar,\n#cloud-modal{display:none !important}\n</style>';
html = html.replace(/^\s*<link rel="stylesheet" href="\/assets\/css\/[^"]*">\s*$/gm, '');
html = html.replace('</head>', styleTag + '\n</head>');

/* ---- 3. 内联 vault.js ---- */
// 注意：脚本里若出现 "</script" 会提前结束脚本块，必须转义
const safeJs = vaultJs.replace(/<\/script/gi, '<\\/script');
html = html.replace(
  /^\s*<script src="\/assets\/js\/vault\.js"><\/script>\s*$/gm,
  '<script>\n' + safeJs + '\n</script>'
);

/* ---- 4. 标题标明这是离线版，并在页面顶部插一条说明 ---- */
html = html.replace('<title>保险库</title>', '<title>保险库 · 离线单文件版</title>');
html = html.replace(
  /(<main class="vault-main">)/,
  '$1\n    <div class="container">\n' +
  '      <p class="standalone-note">\n' +
  '        <strong>离线单文件版</strong> —— 整个保险库都在这一个文件里，双击就能打开，\n' +
  '        放进 U 盘随身带也行。<br>\n' +
  '        数据只存在这个浏览器里，不上传任何服务器。想要多设备同步，请用网站上的在线版。\n' +
  '      </p>\n' +
  '    </div>'
);

/* ---- 5. 写文件 ---- */
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, html, 'utf8');

const sizeKb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log('已生成：' + path.relative(ROOT, OUT_FILE).replace(/\\/g, '/'));
console.log('大小：' + sizeKb + ' KB（单文件，自带全部样式和逻辑）');

// ---- 自检：该内联的都在、该去掉的都没了 ----
const problems = [];
if (html.includes('src="/assets/js/vault.js"')) problems.push('vault.js 没被内联');
if (/<link[^>]+stylesheet/.test(html)) problems.push('还有外链样式表');
if (/<link[^>]+fonts\.googleapis/.test(html)) problems.push('还在引用 Google 字体');
if (/<script[^>]+src=/.test(html)) problems.push('还有外链脚本');
if (!html.includes('standalone-note')) problems.push('说明横幅没插进去');
if (problems.length) {
  console.error('\n自检没通过：');
  problems.forEach(p => console.error('  ✘ ' + p));
  process.exit(1);
}
console.log('自检通过：无任何外部依赖。');
