// ==UserScript==
// @name         جستجوی کامل محصولات اسنپ‌فود
// @namespace    https://github.com/
// @version      1.5.0
// @description  جمع‌آوری و جستجو میان تمام محصولات صفحات اسنپ‌فود، بدون محدودیت صفحه‌بندی
// @author       Snappfood Party Search contributors
// @license      MIT
// @match        https://snappfood.ir/*
// @match        https://*.snappfood.ir/*
// @icon         https://superapp.snappfood.ir/favicon.ico
// @downloadURL  https://raw.githubusercontent.com/hedieh-hj/snappfood-product-search/main/snappfood-party-search.user.js
// @updateURL    https://raw.githubusercontent.com/hedieh-hj/snappfood-product-search/main/snappfood-party-search.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self || document.getElementById('sfps-root')) return;

  const CONFIG = {
    cardSelector: 'a[href*="/product-details/"], a[href*="/product/"]',
    scrollContainerSelector: '#main-container',
    stepRatio: 0.72,
    waitAfterScrollMs: 420,
    stableRoundsToFinish: 7,
    maxRounds: 700,
  };

  const state = {
    products: new Map(),
    collecting: false,
    locating: false,
    cancelled: false,
    query: '',
  };

  const fa = new Intl.NumberFormat('fa-IR');
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (value = '') => value
    .toLocaleLowerCase('fa')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\u200c\u200f\u202a-\u202e]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  function productId(url) {
    try {
      const parsed = new URL(url, location.href);
      const numericId = parsed.pathname.match(/\/(?:product-details|product)\/(?:[^/]+\/)?(\d+)/)?.[1];
      return numericId || `${parsed.pathname}${parsed.search}`;
    } catch {
      return url;
    }
  }

  function uniqueLines(text) {
    const seen = new Set();
    return text.split('\n').map((line) => line.trim()).filter((line) => {
      if (!line || seen.has(line)) return false;
      seen.add(line);
      return true;
    });
  }

  function readCard(anchor) {
    const lines = uniqueLines(anchor.innerText || anchor.textContent || '');
    const ratingIndex = lines.findIndex((line) => /^[۰-۹0-9](?:[٫.][۰-۹0-9])?$/.test(line));
    const discount = lines.find((line) => /^[٪%]\s*[۰-۹0-9]+/.test(line)) || '';
    const priceLines = lines.filter((line) => /^[۰-۹0-9][۰-۹0-9٬,]*$/.test(line));
    const timeIndex = lines.findIndex((line) => /دقیقه/.test(line));
    const freeDelivery = lines.find((line) => /ارسال\s*رایگان/.test(line));
    const deliveryNumber = timeIndex > 1
      ? [...lines.slice(0, timeIndex - 1)].reverse().find((line) => /^[۰-۹0-9][۰-۹0-9٬,]*$/.test(line))
      : '';
    const url = new URL(anchor.href, location.href).href;

    return {
      id: productId(url),
      url,
      title: lines[0] || 'محصول بدون نام',
      vendor: ratingIndex >= 0 ? (lines[ratingIndex + 1] || '') : '',
      rating: ratingIndex >= 0 ? lines[ratingIndex] : '',
      discount,
      price: priceLines.at(-1) || '',
      delivery: freeDelivery ? 'رایگان' : deliveryNumber || '',
      text: lines.join(' · '),
      searchable: normalize(lines.join(' ')),
    };
  }

  function pageProductAnchors() {
    return [...document.querySelectorAll(CONFIG.cardSelector)]
      .filter((anchor) => !anchor.closest('#sfps-root'));
  }

  function collectVisibleCards() {
    let added = 0;
    pageProductAnchors().forEach((anchor) => {
      const product = readCard(anchor);
      if (!state.products.has(product.id)) added += 1;
      state.products.set(product.id, product);
    });
    return added;
  }

  function expectedCount() {
    const match = document.body.innerText.match(/([۰-۹0-9٬,]+)\s*محصول/);
    if (!match) return null;
    return Number(match[1].replace(/[٬,]/g, '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  }

  function getScrollContainer() {
    const preferred = document.querySelector(CONFIG.scrollContainerSelector);
    if (preferred && preferred.scrollHeight > preferred.clientHeight + 10) return preferred;

    return [...document.querySelectorAll('main, section, div')].find((el) => {
        const style = getComputedStyle(el);
        return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 100;
      }) || document.scrollingElement;
  }

  function setStatus(text, kind = '') {
    const status = document.querySelector('#sfps-status');
    if (!status) return;
    status.textContent = text;
    status.dataset.kind = kind;
  }

  function updateCounter(expected = expectedCount()) {
    const counter = document.querySelector('#sfps-counter');
    if (!counter) return;
    counter.textContent = expected
      ? `${fa.format(state.products.size)} از ${fa.format(expected)}`
      : `${fa.format(state.products.size)} محصول`;
  }

  async function collectAll() {
    if (state.collecting) return;
    const scroller = getScrollContainer();
    if (!scroller) {
      setStatus('لیست محصولات پیدا نشد؛ صفحه را یک‌بار تازه‌سازی کنید.', 'error');
      return;
    }

    state.collecting = true;
    state.cancelled = false;
    const originalTop = scroller.scrollTop;
    const expected = expectedCount();
    let stableRounds = 0;
    let previousSize = -1;

    document.querySelector('#sfps-load').hidden = true;
    document.querySelector('#sfps-stop').hidden = false;
    setStatus('در حال جمع‌آوری؛ لطفاً این صفحه را باز نگه دارید…', 'loading');

    try {
      scroller.scrollTop = 0;
      await sleep(CONFIG.waitAfterScrollMs);

      for (let round = 0; round < CONFIG.maxRounds && !state.cancelled; round += 1) {
        collectVisibleCards();
        updateCounter(expected);
        renderResults();

        if (expected && state.products.size >= expected) break;
        stableRounds = state.products.size === previousSize ? stableRounds + 1 : 0;
        previousSize = state.products.size;

        const beforeTop = scroller.scrollTop;
        const nearBottom = beforeTop + scroller.clientHeight >= scroller.scrollHeight - 8;
        if (nearBottom && stableRounds >= CONFIG.stableRoundsToFinish) break;

        scroller.scrollTop = Math.min(
          beforeTop + Math.max(220, scroller.clientHeight * CONFIG.stepRatio),
          scroller.scrollHeight,
        );
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        await sleep(CONFIG.waitAfterScrollMs);
      }

      collectVisibleCards();
      updateCounter(expected);
      const incomplete = expected && state.products.size < expected;
      setStatus(
        state.cancelled
          ? 'جمع‌آوری متوقف شد؛ نتایج فعلی قابل جستجو هستند.'
          : incomplete
            ? `جمع‌آوری متوقف شد؛ ${fa.format(state.products.size)} محصول در دسترس بود.`
            : 'همهٔ محصولات در دسترس، آمادهٔ جستجو هستند.',
        incomplete ? 'warning' : 'success',
      );
    } catch (error) {
      console.error('[Snappfood Party Search]', error);
      setStatus('هنگام خواندن لیست خطایی رخ داد. دوباره تلاش کنید.', 'error');
    } finally {
      scroller.scrollTop = Math.min(originalTop, scroller.scrollHeight);
      state.collecting = false;
      const loadButton = document.querySelector('#sfps-load');
      const stopButton = document.querySelector('#sfps-stop');
      if (loadButton) {
        loadButton.hidden = false;
        loadButton.textContent = 'بارگذاری دوباره';
      }
      if (stopButton) stopButton.hidden = true;
      renderResults();
    }
  }

  function findVisibleProduct(id) {
    return pageProductAnchors()
      .find((anchor) => productId(anchor.href) === id);
  }

  async function scrollToProduct(id) {
    if (state.locating || state.collecting) return;
    const scroller = getScrollContainer();
    if (!scroller) return;

    state.locating = true;
    togglePanel(false);
    let stableRounds = 0;
    let previousTop = -1;

    try {
      scroller.scrollTop = 0;
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      await sleep(CONFIG.waitAfterScrollMs);

      for (let round = 0; round < CONFIG.maxRounds; round += 1) {
        const target = findVisibleProduct(id);
        if (target) {
          const visibleCard = target.closest('div') || target;
          visibleCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
          visibleCard.classList.add('sfps-page-target');
          setTimeout(() => visibleCard.classList.remove('sfps-page-target'), 3200);
          return;
        }

        const beforeTop = scroller.scrollTop;
        stableRounds = beforeTop === previousTop ? stableRounds + 1 : 0;
        previousTop = beforeTop;
        if (stableRounds >= CONFIG.stableRoundsToFinish) break;

        scroller.scrollTop = Math.min(
          beforeTop + Math.max(180, scroller.clientHeight * 0.58),
          scroller.scrollHeight,
        );
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        await sleep(CONFIG.waitAfterScrollMs);
      }

      togglePanel(true);
      setStatus('محصول در نسخهٔ فعلی لیست پیدا نشد؛ ممکن است موجودی تغییر کرده باشد.', 'warning');
    } finally {
      state.locating = false;
    }
  }

  function escapeHtml(value) {
    return value.replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[char]);
  }

  function renderResults() {
    const list = document.querySelector('#sfps-results');
    if (!list) return;
    const needle = normalize(state.query);
    const products = needle
      ? [...state.products.values()].filter((product) => product.searchable.includes(needle))
      : [];

    document.querySelector('#sfps-found').textContent = `${fa.format(products.length)} نتیجه`;
    if (!needle) {
      list.innerHTML = '<div class="sfps-empty">نام غذا یا رستوران را در کادر بالا بنویسید.</div>';
      return;
    }
    if (!products.length) {
      list.innerHTML = `<div class="sfps-empty">${state.products.size ? 'محصولی با این عبارت پیدا نشد.' : 'ابتدا «بارگذاری همه» را بزنید.'}</div>`;
      return;
    }

    list.innerHTML = products.map((product) => `
      <article class="sfps-card" data-product-id="${escapeHtml(product.id)}" role="button" tabindex="0" title="نمایش این محصول در لیست اصلی">
        <strong>${escapeHtml(product.title)}</strong>
        ${product.vendor ? `<span class="sfps-vendor">${escapeHtml(product.vendor)}</span>` : ''}
        <span class="sfps-meta">
          ${product.discount ? `<b>${escapeHtml(product.discount)} تخفیف</b>` : ''}
          ${product.price ? `<span>${escapeHtml(product.price)} تومان</span>` : ''}
          ${product.rating ? `<span>★ ${escapeHtml(product.rating)}</span>` : ''}
        </span>
        <span class="sfps-card-footer">
          <span class="sfps-delivery">پیک: ${product.delivery ? `${escapeHtml(product.delivery)}${product.delivery === 'رایگان' ? '' : ' تومان'}` : 'نامشخص'}</span>
          <a class="sfps-open" href="${escapeHtml(product.url)}" target="_blank" rel="noopener noreferrer">بازکردن محصول ↗</a>
        </span>
      </article>`).join('');
  }

  function togglePanel(force) {
    const panel = document.querySelector('#sfps-panel');
    const open = typeof force === 'boolean' ? force : !panel.classList.contains('sfps-open');
    panel.classList.toggle('sfps-open', open);
    document.querySelector('#sfps-launcher').setAttribute('aria-expanded', String(open));
    if (open) {
      setTimeout(() => document.querySelector('#sfps-search')?.focus(), 50);
      if (!state.products.size && !state.collecting) collectAll();
    }
  }

  function mount() {
    const root = document.createElement('div');
    root.id = 'sfps-root';
    root.dataset.pageKey = `${location.pathname}${location.search}`;
    root.dir = 'rtl';
    root.innerHTML = `
      <button id="sfps-launcher" type="button" aria-label="جستجوی همه محصولات" aria-expanded="false">⌕<span>جستجوی همه</span></button>
      <section id="sfps-panel" role="dialog" aria-label="جستجوی کامل محصولات اسنپ‌فود">
        <header>
          <div><strong>جستجوی کامل محصولات</strong><small id="sfps-counter">۰ محصول</small></div>
          <button id="sfps-close" type="button" aria-label="بستن">×</button>
        </header>
        <div class="sfps-search-wrap">
          <input id="sfps-search" type="search" autocomplete="off" placeholder="نام غذا یا رستوران…" aria-label="عبارت جستجو">
          <span id="sfps-found">۰ نتیجه</span>
        </div>
        <div class="sfps-actions">
          <button id="sfps-load" type="button">بارگذاری همه</button>
          <button id="sfps-stop" type="button" hidden>توقف</button>
          <span id="sfps-status">آمادهٔ جمع‌آوری محصولات</span>
        </div>
        <div id="sfps-results" aria-live="polite"></div>
        <footer>
          <span>میانبر: <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd></span>
          <a href="https://github.com/hedieh-hj/snappfood-product-search" target="_blank" rel="noopener noreferrer">ساخته‌شده با ♥ توسط هدیه جمیلی</a>
        </footer>
      </section>`;
    document.body.appendChild(root);

    document.querySelector('#sfps-launcher').addEventListener('click', () => togglePanel());
    document.querySelector('#sfps-close').addEventListener('click', () => togglePanel(false));
    document.querySelector('#sfps-load').addEventListener('click', collectAll);
    document.querySelector('#sfps-stop').addEventListener('click', () => { state.cancelled = true; });
    document.querySelector('#sfps-search').addEventListener('input', (event) => {
      state.query = event.target.value;
      renderResults();
    });
    document.querySelector('#sfps-results').addEventListener('click', (event) => {
      if (event.target.closest('.sfps-open')) return;
      const card = event.target.closest('.sfps-card');
      if (card) scrollToProduct(card.dataset.productId);
    });
    document.querySelector('#sfps-results').addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.sfps-card')) {
        event.preventDefault();
        scrollToProduct(event.target.dataset.productId);
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        togglePanel(true);
      }
      if (event.key === 'Escape' && document.querySelector('#sfps-panel').classList.contains('sfps-open')) {
        togglePanel(false);
      }
    });

    collectVisibleCards();
    updateCounter();
    renderResults();
  }

  const style = document.createElement('style');
  style.textContent = `
    #sfps-root, #sfps-root * { box-sizing: border-box; font-family: Vazirmatn, IRANSans, Tahoma, sans-serif; }
    #sfps-launcher { position: fixed; z-index: 2147483645; left: 18px; bottom: 82px; height: 48px; padding: 0 16px; border: 0; border-radius: 24px; background: #ff00a6; color: #fff; box-shadow: 0 8px 28px #7800504d; cursor: pointer; font-size: 25px; display: flex; align-items: center; gap: 7px; }
    #sfps-launcher span { font-size: 13px; font-weight: 700; }
    #sfps-panel { position: fixed; z-index: 2147483646; inset: 0 0 0 auto; width: min(430px, 100vw); height: 100dvh; background: #f8f8fa; color: #292929; box-shadow: -12px 0 42px #0003; transform: translateX(105%); transition: transform .22s ease; display: grid; grid-template-rows: auto auto auto 1fr auto; direction: rtl; }
    #sfps-panel.sfps-open { transform: translateX(0); }
    #sfps-panel header { background: #fff; padding: 17px 18px 14px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #eee; }
    #sfps-panel header div { display: grid; gap: 4px; }
    #sfps-panel header strong { font-size: 16px; }
    #sfps-panel header small { color: #777; }
    #sfps-close { width: 36px; height: 36px; border: 0; border-radius: 50%; background: #f2f2f2; font-size: 25px; cursor: pointer; }
    .sfps-search-wrap { position: relative; padding: 14px 16px 8px; }
    #sfps-search { width: 100%; height: 46px; border: 1px solid #ddd; border-radius: 12px; background: #fff; padding: 0 14px 0 88px; outline: none; font-size: 15px; color: #222; }
    #sfps-search:focus { border-color: #ff00a6; box-shadow: 0 0 0 3px #ff00a618; }
    #sfps-found { position: absolute; left: 28px; top: 29px; color: #777; font-size: 12px; }
    .sfps-actions { padding: 4px 16px 10px; display: flex; gap: 8px; align-items: center; min-height: 48px; }
    .sfps-actions button { border: 0; border-radius: 9px; padding: 8px 11px; color: #fff; background: #ff00a6; cursor: pointer; white-space: nowrap; }
    #sfps-stop { background: #d33; }
    #sfps-status { font-size: 11px; color: #666; line-height: 1.6; }
    #sfps-status[data-kind="success"] { color: #168448; }
    #sfps-status[data-kind="warning"] { color: #a55a00; }
    #sfps-status[data-kind="error"] { color: #c42a2a; }
    #sfps-results { overflow-y: auto; padding: 4px 12px 14px; overscroll-behavior: contain; }
    .sfps-card { display: grid; gap: 6px; margin: 8px 0; padding: 13px 14px; border: 1px solid #ececf0; border-radius: 13px; background: #fff; color: inherit; box-shadow: 0 2px 8px #0000000a; cursor: pointer; }
    .sfps-card:hover, .sfps-card:focus { border-color: #ff00a666; transform: translateY(-1px); outline: none; }
    .sfps-card strong { font-size: 14px; line-height: 1.6; }
    .sfps-vendor { color: #666; font-size: 12px; }
    .sfps-meta { display: flex; gap: 11px; align-items: center; font-size: 12px; color: #555; }
    .sfps-meta b { color: #ff00a6; }
    .sfps-card-footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding-top: 6px; border-top: 1px solid #f0f0f2; font-size: 11px; }
    .sfps-delivery { color: #555; }
    .sfps-open { padding: 6px 9px; border-radius: 7px; background: #fff0fa; color: #d6008c; text-decoration: none; font-weight: 700; }
    .sfps-page-target { outline: 4px solid #ff00a6 !important; outline-offset: 5px; border-radius: 12px; animation: sfps-pulse .7s ease 3; }
    @keyframes sfps-pulse { 50% { outline-color: #ff00a633; } }
    .sfps-empty { text-align: center; color: #777; padding: 55px 15px; line-height: 2; }
    #sfps-panel footer { padding: 8px; text-align: center; color: #888; background: #fff; font-size: 11px; border-top: 1px solid #eee; display: flex; justify-content: center; align-items: center; gap: 12px; flex-wrap: wrap; }
    #sfps-panel footer a { color: #d6008c; text-decoration: none; font-weight: 700; }
    #sfps-panel footer a:hover { text-decoration: underline; }
    #sfps-panel kbd { border: 1px solid #ccc; background: #f5f5f5; border-radius: 4px; padding: 1px 4px; direction: ltr; display: inline-block; }
    @media (max-width: 520px) { #sfps-launcher span { display: none; } #sfps-launcher { width: 48px; padding: 0; justify-content: center; } }
    @media (prefers-reduced-motion: reduce) { #sfps-panel { transition: none; } }
  `;
  document.head.appendChild(style);

  function syncWithPage() {
    const hasProducts = pageProductAnchors().length > 0;
    let root = document.querySelector('#sfps-root');
    const pageKey = `${location.pathname}${location.search}`;

    if (root && root.dataset.pageKey !== pageKey) {
      state.cancelled = true;
      state.products.clear();
      state.query = '';
      root.remove();
      root = null;
    }

    if (hasProducts && !root) {
      mount();
      return;
    }

    if (root) root.hidden = !hasProducts && !state.collecting;
  }

  function startDiscovery() {
    syncWithPage();
    let timer;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(syncWithPage, 250);
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.body) startDiscovery();
  else window.addEventListener('DOMContentLoaded', startDiscovery, { once: true });
})();
