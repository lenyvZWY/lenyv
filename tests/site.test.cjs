/* ============================================================
   lenyv 网站 · 连通性测试
   ------------------------------------------------------------
   运行：  node tests/site.test.cjs
   （需在项目根目录运行）

   检查六件事：
     1. 资源连通性：HTML 里引用的每个本地文件是不是真的存在
     2. 导航连通性：页头/页脚里的每个链接是不是都能到达真实页面
     3. JS ↔ HTML 契约：JS 里用 $('#id') 找的元素，HTML 里有没有
     4. HTML ↔ CSS 契约：HTML 用的 class，CSS 里有没有定义
     5. HTML 结构：标签是否配平（少了 </div> 会让整页排版崩掉）
     6. HTTP 实测：本地预览服务器能不能真的把这些文件发出来
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASE_URL = 'http://127.0.0.1:8000';

// 页面 / 组件 / 静态资源清单
const PAGES = ['index.html', 'about.html', 'projects.html', 'blog.html', 'contact.html', 'vault.html'];
const PARTIALS = ['partials/header.html', 'partials/footer.html'];
const CSS_FILES = ['assets/css/tokens.css', 'assets/css/main.css', 'assets/css/vault.css'];

let pass = 0, fail = 0, skip = 0;
const ok = m => { pass++; console.log('  \u2714 ' + m); };
const bad = m => { fail++; console.log('  \u2718 ' + m); };
const skp = m => { skip++; console.log('  \u2013 ' + m); };
const section = s => console.log('\n' + s);

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = p => fs.existsSync(path.join(ROOT, p));

/* 扫描代码前先把注释去掉。
   否则代码注释里写的示例（比如说明 "$('#id')" 怎么用）会被当成真的引用。
   下面这行对 // 的处理带了个小技巧：前面是冒号的（例如 https://）不算注释。 */
const stripJsComments = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')       // 去掉 /* ... */ 块注释
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');  // 去掉 // 行注释，但放过 https://

// 去掉 HTML 注释，避免注释里的 id / class 被算进去
const stripHtmlComments = s => s.replace(/<!--[\s\S]*?-->/g, '');

// 把 "/assets/css/main.css" 这样的网址路径，转成本地文件路径
const urlToFile = u => u.replace(/^\//, '').split('?')[0].split('#')[0];

// 从 HTML 里抓出所有 href="..." / src="..."
function assetsOf(html) {
  const out = [];
  for (const m of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) out.push(m[1]);
  return out;
}

(async () => {
  /* ---------- 1. 资源连通性 ---------- */
  section('[1] 资源连通性（HTML 引用的本地文件是否都存在）');
  {
    const needed = new Set();
    for (const page of PAGES) {
      for (const a of assetsOf(stripHtmlComments(read(page)))) {
        if (a.startsWith('//') || /^https?:/i.test(a) || a.startsWith('#') || a.startsWith('data:')) continue;
        if (a.startsWith('/')) needed.add(urlToFile(a));
      }
    }
    // main.js 运行时还会去 fetch 两个公共组件
    for (const p of PARTIALS) needed.add(p);

    const missing = [...needed].filter(f => !exists(f));
    if (missing.length) missing.forEach(f => bad('文件不存在：/' + f));
    else ok('引用的 ' + needed.size + ' 个本地文件全部存在');
  }

  /* ---------- 2. 导航连通性 ---------- */
  section('[2] 导航连通性（页头/页脚链接是否都能到达）');
  {
    const navTargets = new Set();
    for (const p of PARTIALS) {
      for (const a of assetsOf(read(p))) {
        if (a.startsWith('/') && /\.html$/.test(a)) navTargets.add(urlToFile(a));
      }
    }
    const dead = [...navTargets].filter(f => !exists(f));
    if (dead.length) dead.forEach(f => bad('导航指向了不存在的页面：' + f));
    else ok('导航里的 ' + navTargets.size + ' 个页面全部存在');

    // 反向检查：每个页面都应该能从导航到达（vault 页也该在导航里）
    const unreachable = PAGES.filter(p => !navTargets.has(p));
    if (unreachable.length) unreachable.forEach(p => bad('这个页面不在导航里，可能点不到：' + p));
    else ok('所有页面都能从导航到达');
  }

  /* ---------- 3. JS ↔ HTML 契约 ---------- */
  section('[3] JS ↔ HTML 契约（JS 找的元素是否存在）');
  {
    // 公共组件里的 id 也算「页面上存在」，因为它们是运行时注入的
    let partialIds = new Set();
    for (const p of PARTIALS) {
      for (const m of read(p).matchAll(/\bid="([^"]+)"/g)) partialIds.add(m[1]);
    }

    for (const page of PAGES) {
      const html = stripHtmlComments(read(page));          // 先去掉注释再扫
      const pageIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
      const avail = new Set([...pageIds, ...partialIds]);

      // 找出这个页面加载了哪些 JS
      const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)]
        .map(m => urlToFile(m[1]))
        .filter(f => exists(f));

      const refs = new Set();
      for (const jsFile of scripts) {
        const js = stripJsComments(read(jsFile));          // 先去掉注释，避免注释里的示例被误判
        for (const m of js.matchAll(/\$\(\s*'(#[A-Za-z0-9_-]+)'/g)) refs.add(m[1].slice(1));
        for (const m of js.matchAll(/getElementById\(\s*'([A-Za-z0-9_-]+)'/g)) refs.add(m[1]);
      }

      const missing = [...refs].filter(id => !avail.has(id));
      if (missing.length) missing.forEach(id => bad(page + ' → JS 找 #' + id + '，但页面上没有'));
      else ok(page + '：' + scripts.length + ' 个脚本引用到的 ' + refs.size + ' 个元素都在');
    }
  }

  /* ---------- 4. HTML ↔ CSS 契约 ---------- */
  section('[4] HTML ↔ CSS 契约（用的 class 是否都有样式）');
  {
    const css = CSS_FILES.filter(exists).map(read).join('\n');
    const defined = new Set([...css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map(m => m[1]));

    // 这些 class 是 JS 用来做状态开关的，故意不需要样式
    const NO_STYLE_NEEDED = new Set(['tab-panel', 'hidden', 'is-active', 'in']);

    const allHtml = [...PAGES, ...PARTIALS].map(f => stripHtmlComments(read(f))).join('\n');
    const used = new Set();
    for (const m of allHtml.matchAll(/class="([^"]+)"/g)) {
      m[1].split(/\s+/).filter(Boolean).forEach(c => used.add(c));
    }
    const undef = [...used].filter(c => !defined.has(c) && !NO_STYLE_NEEDED.has(c));
    if (undef.length) undef.forEach(c => bad('HTML 用了 .' + c + '，CSS 里没有定义'));
    else ok('用到的 ' + used.size + ' 个 class 全部有定义');
  }

  /* ---------- 5. HTML 结构 ---------- */
  section('[5] HTML 结构（标签是否配平）');
  {
    for (const f of [...PAGES, ...PARTIALS]) {
      const h = read(f);
      const pairs = [['div', /<div\b/g, /<\/div>/g], ['section', /<section\b/g, /<\/section>/g], ['svg', /<svg\b/g, /<\/svg>/g]];
      let bad5 = false;
      for (const [name, o, c] of pairs) {
        const no = (h.match(o) || []).length, nc = (h.match(c) || []).length;
        if (no !== nc) { bad(f + '：<' + name + '> ' + no + ' 个，</' + name + '> ' + nc + ' 个，不配平'); bad5 = true; }
      }
      if (!bad5) ok(f + '：标签配平');
    }
  }

  /* ---------- 6. HTTP 实测 ---------- */
  section('[6] HTTP 实测（本地预览服务器能否真的送出这些文件）');
  {
    const urls = [];
    for (const p of PAGES) urls.push('/' + p);
    for (const p of PARTIALS) urls.push('/' + p);
    for (const p of CSS_FILES) urls.push('/' + p);
    for (const f of ['assets/js/main.js', 'assets/js/vault.js', 'download/lenyv-vault.html']) urls.push('/' + f);

    let reachable = false;
    try {
      const r0 = await fetch(BASE_URL + '/index.html', { signal: AbortSignal.timeout(2500) });
      reachable = r0.ok;
    } catch (e) { reachable = false; }

    if (!reachable) {
      skp('本地预览服务器没在跑，跳过实测。想测请先：python -m http.server 8000 --bind 127.0.0.1');
    } else {
      let httpFail = 0;
      for (const u of urls) {
        try {
          const res = await fetch(BASE_URL + u, { signal: AbortSignal.timeout(4000) });
          if (res.status !== 200) { bad(u + ' → HTTP ' + res.status); httpFail++; }
        } catch (e) { bad(u + ' → 连不上（' + e.message + '）'); httpFail++; }
      }
      if (!httpFail) ok(urls.length + ' 个地址全部返回 200');
    }
  }

  section('[8] 可下载的单文件版（整个保险库打包成一个 HTML）');
  {
    const STANDALONE = 'download/lenyv-vault.html';
    if (!exists(STANDALONE)) {
      bad('单文件版不存在，请先跑：node tools/build-standalone.cjs');
    } else {
      const f = read(STANDALONE);
      ok('文件存在（' + (Buffer.byteLength(f, 'utf8') / 1024).toFixed(0) + ' KB）');

      // 自包含：不能有任何外部依赖，否则离线打开就废了
      const leaks = [];
      if (/<link[^>]+stylesheet/.test(f)) leaks.push('还有外链样式表');
      if (/<link[^>]+fonts\.googleapis/.test(f)) leaks.push('还在引用 Google 字体');
      if (/<script[^>]+src=/.test(f)) leaks.push('还有外链脚本');
      if (/<div id="site-header">/.test(f)) leaks.push('页头没被内联（离线版会取不到组件）');
      if (leaks.length) leaks.forEach(l => bad('单文件版不自包含：' + l));
      else ok('完全自包含：无外链样式、无外链脚本、无 Google 字体');

      // 关键内容确实在里面
      const must = [
        ['vault 逻辑', 'lenyv 保险库'],
        ['加密核心', 'deriveAesKey'],
        ['存储降级', 'probeStorage'],
        ['离线说明', 'standalone-note']
      ];
      const missing = must.filter(([, k]) => !f.includes(k)).map(([n]) => n);
      if (missing.length) missing.forEach(m => bad('单文件版缺少：' + m));
      else ok('加密与存储逻辑都在里面');

      // 入口页要能点到它
      const linked = ['index.html', 'partials/footer.html'].every(p => read(p).includes('/download/lenyv-vault.html'));
      if (linked) ok('首页和页脚都有下载入口');
      else bad('首页或页脚缺少下载入口');
    }
  }

  console.log('\n============================');
  console.log('  结果：' + pass + ' 通过 / ' + fail + ' 失败' + (skip ? ' / ' + skip + ' 跳过' : ''));
  console.log('============================');
  process.exit(fail ? 1 : 0);
})().catch(err => {
  console.error('\n测试崩了：', err);
  process.exit(1);
});
