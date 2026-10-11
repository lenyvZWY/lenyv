/* lenyv 网站基础脚本：负责加载公共页头/页脚、主题切换、导航高亮、移动端菜单 */
(function () {
  const PARTIALS = {
    header: '/partials/header.html',
    footer: '/partials/footer.html'
  };

  async function loadPartial(el, url) {
    if (!el) return;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      el.innerHTML = await res.text();
    } catch (err) {
      console.warn('[lenyv] 组件加载失败：', url, err);
    }
  }

  function initTheme() {
    const root = document.documentElement;
    const saved = localStorage.getItem('lenyv-theme');
    if (saved) root.setAttribute('data-theme', saved);

    document.addEventListener('click', function (e) {
      const btn = e.target.closest('.theme-toggle');
      if (!btn) return;
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      localStorage.setItem('lenyv-theme', next);
    });
  }

  function initNav() {
    const page = document.body.dataset.page;
    if (!page) return;
    document.querySelectorAll('.site-nav a[data-nav]').forEach(function (a) {
      if (a.dataset.nav === page) a.classList.add('is-active');
    });
  }

  function initMobileMenu() {
    const toggle = document.querySelector('.nav-toggle');
    const nav = document.querySelector('.site-nav');
    if (!toggle || !nav) return;
    toggle.addEventListener('click', function () {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) {
        nav.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function initYear() {
    const y = document.getElementById('year');
    if (y) y.textContent = new Date().getFullYear();
  }

  async function init() {
    await Promise.all([
      loadPartial(document.getElementById('site-header'), PARTIALS.header),
      loadPartial(document.getElementById('site-footer'), PARTIALS.footer)
    ]);
    initTheme();
    initNav();
    initMobileMenu();
    initYear();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
