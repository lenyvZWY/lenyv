/* lenyv 网站基础脚本：加载公共页头/页脚、主题切换、导航高亮、移动端菜单、滚动渐显 */
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

  function initHeaderShadow() {
    const header = document.querySelector('.site-header');
    if (!header) return;
    const onScroll = function () {
      header.classList.toggle('scrolled', window.scrollY > 12);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  function initReveal() {
    const els = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window) || !els.length) {
      els.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    els.forEach(function (el, i) {
      el.style.transitionDelay = (Math.min(i, 6) * 60) + 'ms';
      io.observe(el);
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
    initHeaderShadow();
    initReveal();
    initYear();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
