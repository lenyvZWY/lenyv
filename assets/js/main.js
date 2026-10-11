/* ============================================================================
   lenyv 网站 · 基础脚本（所有页面都会加载这一个文件）
   ============================================================================
   它负责每个页面都需要的「公共动作」：
     1. 把公共的页头 / 页脚塞进页面里（这样改一个文件，全站都变）
     2. 深色 / 浅色主题切换，并记住你的选择
     3. 高亮当前所在的导航项
     4. 手机上的汉堡菜单展开 / 收起
     5. 页面往下滚时给页头加一条分隔线
     6. 内容滚动进入视野时轻轻淡入
     7. 页脚自动显示当前年份

   注意：整个文件包在一对括号里（这叫 IIFE），
   目的是把自己的变量藏起来，不去污染全局，也不和别的脚本打架。
   ============================================================================ */
(function () {
  // 公共组件的地址：页头页脚不写死在每个页面里，而是运行时去取，
  // 以后只要改 partials/ 下的文件，所有页面同时生效。
  const PARTIALS = {
    header: '/partials/header.html',
    footer: '/partials/footer.html'
  };

  /* 把一个组件文件的内容，塞进页面上预留的占位元素里。
     el  = 页面里的占位元素（比如 <div id="site-header"></div>）
     url = 要取的组件地址 */
  async function loadPartial(el, url) {
    if (!el) return;                 // 页面上没有这个占位元素，直接跳过
    try {
      const res = await fetch(url);  // 去服务器取组件内容
      if (!res.ok) throw new Error('HTTP ' + res.status);  // 取失败要报错，不能装作没事
      el.innerHTML = await res.text();   // 把取回来的 HTML 塞进去
    } catch (err) {
      // 取不到也不让整个页面崩掉，只在控制台留个记录，方便排查
      console.warn('[lenyv] 组件加载失败：', url, err);
    }
  }

  /* 主题切换：深色 ←→ 浅色。
     用户的选择记在 localStorage 里，下次打开还是这个主题。 */
  function initTheme() {
    const root = document.documentElement;               // <html> 元素
    const saved = localStorage.getItem('lenyv-theme');   // 读上次的选择
    if (saved) root.setAttribute('data-theme', saved);   // 有记录就应用它

    // 用「事件委托」监听整个文档的点击：
    // 因为页头是稍后才注入的，直接给按钮绑定事件会绑不到；
    // 挂在 document 上就没有这个时间差问题。
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('.theme-toggle');     // 判断点的是不是主题按钮
      if (!btn) return;                                  // 不是就什么也不做
      // 当前是深色就切浅色，反之亦然
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      localStorage.setItem('lenyv-theme', next);         // 记住这次的选择
    });
  }

  /* 导航高亮：让当前所在页面对应的导航项显眼一点。
     原理：每个页面的 <body> 上写了 data-page="xxx"，
     而页头里每个链接写了 data-nav="xxx"，两者对上就加高亮样式。 */
  function initNav() {
    const page = document.body.dataset.page;   // 当前是哪个页面
    if (!page) return;                         // 没写就跳过
    document.querySelectorAll('.site-nav a[data-nav]').forEach(function (a) {
      if (a.dataset.nav === page) a.classList.add('is-active');
    });
  }

  /* 手机端菜单：屏幕窄的时候导航会收起来，点汉堡按钮才展开。 */
  function initMobileMenu() {
    const toggle = document.querySelector('.nav-toggle');  // 汉堡按钮
    const nav = document.querySelector('.site-nav');       // 导航容器
    if (!toggle || !nav) return;                           // 元素不全就不处理

    // 点汉堡按钮：展开 / 收起
    toggle.addEventListener('click', function () {
      const open = nav.classList.toggle('open');           // 切换展开状态
      // aria-expanded 是给读屏软件用的，告诉它菜单现在是开着还是关着
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    // 点导航里的链接后，自动把菜单收起来（不然跳转后菜单还挡着页面）
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) {
        nav.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* 页面往下滚时，给页头补一条底部分隔线。
     这样内容滚到页头底下时，边界看得清楚，不会糊成一片。 */
  function initHeaderShadow() {
    const header = document.querySelector('.site-header');
    if (!header) return;
    const onScroll = function () {
      // 滚过 12 像素就加上 scrolled 这个 class
      header.classList.toggle('scrolled', window.scrollY > 12);
    };
    onScroll();                                           // 先执行一次，处理「刷新时已经在中间」的情况
    window.addEventListener('scroll', onScroll, { passive: true });  // passive 表示不会阻止滚动，性能更好
  }

  /* 滚动渐显：内容滚进视野时，轻轻淡入并上浮一下。
     「轻轻」是有意的 —— 动效太多会显得花哨，和极简风格冲突。 */
  function initReveal() {
    const els = document.querySelectorAll('.reveal');
    // 老浏览器不支持 IntersectionObserver，或者页面上没有这类元素：
    // 那就直接全部显示出来，保证内容一定能看到（不能因为动效把内容藏没了）
    if (!('IntersectionObserver' in window) || !els.length) {
      els.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    // 观察者：元素进入视野时给它加 in 这个 class，触发 CSS 里的淡入动画
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);   // 已经显示过了就不再观察，省性能
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });  // 露出 12% 时算「进入视野」

    // 逐个登记，并给一点依次延迟，让多个元素错开出场，看起来更自然
    els.forEach(function (el, i) {
      el.style.transitionDelay = (Math.min(i, 6) * 60) + 'ms';  // 最多延迟 6 档，避免排太久的等
      io.observe(el);
    });
  }

  /* 页脚的版权年份自动更新，省得每年手动改一次。 */
  function initYear() {
    const y = document.getElementById('year');
    if (y) y.textContent = new Date().getFullYear();
  }

  /* 启动：按顺序把所有初始化跑一遍。
     第一步要等页头页脚注入完成，因为后面的导航高亮、菜单、
     页头分隔线都得先有那些元素才能操作。 */
  async function init() {
    await Promise.all([
      loadPartial(document.getElementById('site-header'), PARTIALS.header),
      loadPartial(document.getElementById('site-footer'), PARTIALS.footer)
    ]);
    initTheme();          // 主题
    initNav();            // 导航高亮（必须在页头注入之后）
    initMobileMenu();     // 手机菜单（同上）
    initHeaderShadow();   // 页头分隔线（同上）
    initReveal();         // 滚动淡入
    initYear();           // 版权年份
  }

  // 页面可能还在加载中，也可能已经加载完了，两种情况都要正确处理
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);   // 还在加载 → 等就绪再跑
  } else {
    init();                                                // 已经就绪 → 立刻跑
  }
})();
