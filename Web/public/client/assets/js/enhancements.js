/**
 * enhancements.js — OpenEcom UI Enhancements (Cam Phung – Frontend)
 *
 * Features:
 *  1. Active nav link highlight
 *  2. IntersectionObserver fade-in for product cards & features
 *  3. Gentle floating hearts when adding to wishlist (nhẹ nhàng, thanh lịch)
 *  4. Custom Notyf toast styling
 *  5. Page-exit smooth transition
 *  6. Scroll-progress bar at top of page
 *  7. Smooth scroll-to-top
 *  8. Sticky header shrink on scroll
 *  9. Number counter animation for dashboard stats
 * 10. Skeleton loader for cart
 */

(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────────────────
   * 1. Active nav link highlight
   * ───────────────────────────────────────────────────────────────────────── */
  (function highlightActiveNav() {
    const path = window.location.pathname;
    document.querySelectorAll('.menu_nav_links a[href], .menu_item a[href]').forEach(function (a) {
      const href = a.getAttribute('href');
      if (!href) return;
      const isActive =
        href === path ||
        (href !== '/' && path.startsWith(href));
      if (isActive) {
        a.classList.add('nav-active');
        a.setAttribute('aria-current', 'page');
      }
    });
  })();

  /* ─────────────────────────────────────────────────────────────────────────
   * 2. IntersectionObserver — fade-in product/category cards on scroll
   * ───────────────────────────────────────────────────────────────────────── */
  (function fadeInOnScroll() {
    if (!('IntersectionObserver' in window)) return;

    const selector = '.product_item, .product_item_2, .category_item, .dashboard_overview_item, .features_item';
    const cards = document.querySelectorAll(selector);

    cards.forEach(function (el) {
      el.classList.add('reveal-hidden');
    });

    const obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('reveal-visible');
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });

    cards.forEach(function (el) { obs.observe(el); });
  })();

  /* ─────────────────────────────────────────────────────────────────────────
   * 3. Gentle Floating Hearts on Wishlist Click (Nhẹ nhàng như đợt trước)
   * ───────────────────────────────────────────────────────────────────────── */
  (function gentleHeartPop() {
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('[button-add-wishlist]');
      if (!btn) return;

      const rect = btn.getBoundingClientRect();
      const originX = rect.left + rect.width / 2;
      const originY = rect.top + window.scrollY;

      for (let i = 0; i < 7; i++) {
        const heart = document.createElement('span');
        heart.textContent = '♥';
        heart.className = 'float-heart';
        heart.style.cssText =
          'left:' + (originX + (Math.random() - 0.5) * 36) + 'px;' +
          'top:' + originY + 'px;' +
          '--dx:' + ((Math.random() - 0.5) * 50) + 'px;' +
          '--dy:' + (-(45 + Math.random() * 55)) + 'px;' +
          'animation-delay:' + (i * 70) + 'ms;';

        document.body.appendChild(heart);
        heart.addEventListener('animationend', function () { heart.remove(); });
      }
    });
  })();

  /* ─────────────────────────────────────────────────────────────────────────
   * 4. Custom Notyf toast styling
   * ───────────────────────────────────────────────────────────────────────── */
  (function styleTosts() {
    var waitForNotyf = setInterval(function () {
      var container = document.querySelector('.notyf');
      if (container) {
        container.classList.add('oec-notyf');
        clearInterval(waitForNotyf);
      }
    }, 300);
  })();

  /* ─────────────────────────────────────────────────────────────────────────
   * 5. Page-exit smooth transition
   * ───────────────────────────────────────────────────────────────────────── */
  (function pageTransition() {
    document.body.classList.add('page-enter');

    document.addEventListener('click', function (e) {
      const a = e.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href');

      if (
        !href ||
        href.startsWith('http') ||
        href.startsWith('#') ||
        href.startsWith('javascript') ||
        a.target === '_blank' ||
        a.hasAttribute('data-bs-toggle') ||
        a.hasAttribute('download') ||
        a.hasAttribute('data-logout')
      ) return;

      e.preventDefault();
      document.body.classList.remove('page-enter');
      document.body.classList.add('page-exit');

      setTimeout(function () {
        window.location.href = href;
      }, 180);
    });
  })();

  /* ─────────────────────────────────────────────────────────────────────────
   * 6. Scroll-progress bar
   * ───────────────────────────────────────────────────────────────────────── */
  (function scrollProgress() {
    var bar = document.createElement('div');
    bar.id = 'scroll-progress-bar';
    document.body.appendChild(bar);

    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        var scrollTop = window.scrollY || document.documentElement.scrollTop;
        var docHeight = document.documentElement.scrollHeight - window.innerHeight;
        var pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
        bar.style.width = pct + '%';
        ticking = false;
      });
    }, { passive: true });
  })();

  /* ─────────────────────────────────────────────────────────────────────────
   * 7. Smooth scroll
   * ───────────────────────────────────────────────────────────────────────── */
  document.documentElement.style.scrollBehavior = 'smooth';

  /* ─────────────────────────────────────────────────────────────────────────
   * 8. Sticky header shrink on scroll
   * ───────────────────────────────────────────────────────────────────────── */
  (function stickyHeaderShrink() {
    var header = document.querySelector('header.header_main');
    if (!header) return;

    var lastY = 0;
    window.addEventListener('scroll', function () {
      var y = window.scrollY;
      if (y > 80) {
        header.classList.add('header-compact');
      } else {
        header.classList.remove('header-compact');
      }
      if (y > lastY + 14 && y > 220) {
        header.classList.add('header-hidden');
      } else if (y < lastY - 6) {
        header.classList.remove('header-hidden');
      }
      lastY = y;
    }, { passive: true });
  })();

  /* ─────────────────────────────────────────────────────────────────────────
   * 9. Number counter animation
   * ───────────────────────────────────────────────────────────────────────── */
  (function counterAnimation() {
    if (!('IntersectionObserver' in window)) return;

    var counters = document.querySelectorAll('.dashboard_overview_item .number, .count-up');
    if (counters.length === 0) return;

    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        var raw = parseFloat(el.textContent.replace(/[^0-9.]/g, '')) || 0;
        if (raw === 0) return;
        var prefix = (el.textContent.match(/^[^0-9]*/) || [''])[0];
        var suffix = (el.textContent.match(/[^0-9.]*$/) || [''])[0];
        var start = performance.now();
        var duration = 900;

        function step(now) {
          var t = Math.min((now - start) / duration, 1);
          var ease = 1 - Math.pow(1 - t, 3);
          el.textContent = prefix + (raw < 10 ? (ease * raw).toFixed(1) : Math.round(ease * raw)) + suffix;
          if (t < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
        obs.unobserve(el);
      });
    }, { threshold: 0.5 });

    counters.forEach(function (el) { obs.observe(el); });
  })();

  /* ─────────────────────────────────────────────────────────────────────────
   * 10. Skeleton loader for cart
   * ───────────────────────────────────────────────────────────────────────── */
  (function skeletonCart() {
    var cartList = document.querySelector('[mini-cart-list]');
    if (!cartList) return;

    var obs = new MutationObserver(function () {
      cartList.querySelectorAll('.skeleton-item').forEach(function (s) { s.remove(); });
    });
    obs.observe(cartList, { childList: true });
  })();

})();
