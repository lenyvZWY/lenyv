/* ============================================================
   lenyv 保险库 · 单文件打包脚本
   ------------------------------------------------------------
   干什么：把保险库页面 + 3 个 CSS + vault.js，全部内联进**一个** HTML 文件。
   结果：download/lenyv-vault.html —— 双击就能用，不需要服务器、不需要联网。

   运行：  node tools/build-standalone.cjs
   （需在项目根目录运行）

   原理：直接读真实的 vault.html 做替换，而不是另抄一份模板 ——
   这样以后改了 vault.html，重新跑一遍就能同步，不会两份代码各走各的。
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'download');
const OUT_FILE = path.join(OUT_DIR, 'lenyv-vault.html');

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ---- 读取要内联的资源 ----
const CSS_FILES = ['assets/css/tokens.css', 'assets/css/main.css', 'assets/css/vault.css'];
const css = CSS_FILES.map(read).join('\n\n');
const vaultJs = read('assets/js/vault.js');

let html = read('vault.html');

/* ---- 1. 去掉联网依赖：Google 字体 / CDN SDK / main.js ----
   离线版不联网，字体自动退回系统字体（CSS 里本来就写了兜底字体）。 */
html = html
  .replace(/^\s*<link rel="preconnect"[^>]*>\s*$/gm, '')
  .replace(/^\s*<link href="https:\/\/fonts\.googleapis\.com[^>]*>\s*$/gm, '')
  .replace(/^\s*<!-- 云服务 SDK[^>]*-->\s*$/gm, '')
  .replace(/^\s*<script src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>\s*$/gm, '')
  // main.js 负责「取公共页头页脚 + 主题切换」，离线版没有服务器可取，直接不要
  .replace(/^\s*<script src="\/assets\/js\/main\.js"><\/script>\s*$/gm, '');

/* ---- 2. 三个 CSS 合并成一个 <style> ---- */
const styleTag = `<style>\n${css}\n\n/* 离线单文件版：云同步不可用（它需要联网 + 固定域名），这里藏起来 */\n#cloud-bar,\n#cloud-modal{display:none !important}\n</style>`;
html = html.replace(/^\s*<link rel="stylesheet" href="\/assets\/css\/[^"]*">\s*$/gm, '');
html = html.replace('</head>', styleTag + '\n</head>');

/* ---- 3. 页头页脚：离线版不 fetch 公共组件，直接把内容写进来 ---- */
const inlineHeader = `<header class="site-header">
  <div class="container header-inner">
    <a class="brand" href="#top" aria-label="lenyv 保险库">
      <span class="brand-mark">L</span>
      <span class="brand-name">lenyv 保险库</span>
    </a>
    <nav class="site-nav" aria-label="主导航">
      <span class="hint muted">离线单文件版 · 数据只存在这台设备上</span>
    </nav>
  </div>
</header>`;

const inlineFooter = `<footer class="site-footer">
  <div class="container footer-inner">
    <div class="footer-brand">
      <span class="brand-name">lenyv</span>
      <p class="footer-note">这是保险库的离线单文件版：双击打开就能用，不需要联网，也不需要服务器。</p>
    </div>
    <p class="footer-copy">© <span id="year"></span> lenyv · 想联网同步，请用网站上的在线版</p>
  </div>
</footer>
<script>document.getElementById('year').textContent = new Date().getFullYear();</script>`;

html = html.replace(/<div id="site-header"><\/div>/, inlineHeader);
html = html.replace(/<div id="site-footer"><\/div>/, inlineFooter);

/* ---- 4. 内联 vault.js ---- */
// 注意：脚本里若出现 "</script" 会提前结束脚本块，必须转义
const safeJs = vaultJs.replace(/<\/script/gi, '<\\/script');
html = html.replace(
  /^\s*<script src="\/assets\/js\/vault\.js"><\/script>\s*$/gm,
  '<script>\n' + safeJs + '\n</script>'
);

/* ---- 5. 标题与说明，标明这是离线版 ---- */
html = html
  .replace('<title>保险库 · lenyv</title>', '<title>lenyv 保险库 · 离线单文件版</title>')
  .replace(
    '</head>',
    `</head>`
  );

// 在 <main> 开头插一条说明横幅
html = html.replace(
  /(<main class="vault-main">)/,
  `$1
    <div class="container">
      <p class="standalone-note">
        <strong>离线单文件版</strong> —— 整个保险库都在这一个文件里，双击就能打开，
        把文件放进 U 盘随身带也行。<br>
        数据只存在这个浏览器里，不上传任何服务器。想要多设备同步，请用网站上的在线版。
      </p>
    </div>`
);

/* ---- 6. 写文件 ---- */
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, html, 'utf8');

const sizeKb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log('已生成：' + path.relative(ROOT, OUT_FILE));
console.log('大小：' + sizeKb + ' KB（单文件，自带全部样式和逻辑）');

// 自检：确认该内联的都在、该去掉的都没了
const problems = [];
if (html.includes('src="/assets/js/vault.js"')) problems.push('vault.js 没被内联');
if (/<link[^>]+fonts\.googleapis/.test(html)) problems.push('还在引用 Google 字体');
if (/<script[^>]+cdn\.jsdelivr/.test(html)) problems.push('还在引用 CDN');
if (/<div id="site-header">/.test(html)) problems.push('页头没被替换（离线版会取不到组件）');
if (!html.includes('standalone-note')) problems.push('说明横幅没插进去');
if (problems.length) {
  console.error('\n自检没通过：');
  problems.forEach(p => console.error('  ✘ ' + p));
  process.exit(1);
}
console.log('自检通过：无外部依赖，页头页脚已内联。');
