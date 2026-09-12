// ==UserScript==
// @name         جستجوی کامل محصولات اسنپ‌فود
// @namespace    https://github.com/
// @version      1.10.3
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
    stepRatio: 0.82,
    waitAfterScrollMs: 300,
    progressTimeoutMs: 4000,
    stableRoundsToFinish: 3,
    maxRounds: 700,
  };

  const state = {
    products: new Map(),
    collecting: false,
    cancelled: false,
    query: '',
    apiMode: false,
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
    const renderedText = anchor.innerText || '';
    const completeText = anchor.textContent || '';
    const lines = uniqueLines(renderedText || completeText);
    const ratingIndex = lines.findIndex((line) => /^[۰-۹0-9](?:[٫.][۰-۹0-9])?$/.test(line));
    const discount = lines.find((line) => /^[٪%]\s*[۰-۹0-9]+/.test(line)) || '';
    const priceLines = lines.filter((line) => /^[۰-۹0-9][۰-۹0-9٬,]*$/.test(line));
    const timeIndex = lines.findIndex((line) => /دقیقه/.test(line));
    const freeDelivery = /رایگان/.test(`${renderedText}\n${completeText}`);
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
      if (!state.products.has(product.id)) {
        product.order = state.products.size;
        added += 1;
      } else {
        product.order = state.products.get(product.id).order;
      }
      state.products.set(product.id, product);
    });
    return added;
  }

  function partyApiUrl() {
    const observed = performance.getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((url) => /\/search\/api\/v[24]\/food-party/.test(url));
    if (observed) return new URL(observed);

    const dealProjectListId = new URLSearchParams(location.search).get('dealProjectListId');
    if (!dealProjectListId) return null;
    const cookies = Object.fromEntries(document.cookie.split('; ').map((item) => {
      const separator = item.indexOf('=');
      return separator < 0 ? [item, ''] : [item.slice(0, separator), item.slice(separator + 1)];
    }));
    const url = new URL('https://snappfood.ir/search/api/v4/food-party');
    url.searchParams.set('deal_project_list_id', dealProjectListId);
    if (cookies.lat) url.searchParams.set('lat', cookies.lat);
    if (cookies.long) url.searchParams.set('long', cookies.long);
    return url;
  }

  function unwrapPartyPayload(value) {
    if (!value || typeof value !== 'object') return null;
    if (Array.isArray(value.products) && ('total_count' in value || 'dealProjectCode' in value)) return value;
    for (const key of ['data', 'result']) {
      const found = unwrapPartyPayload(value[key]);
      if (found) return found;
    }
    return null;
  }

  function ecoApiUrl() {
    if (!/^\/eco\/?$/.test(location.pathname)) return null;
    const observed = performance.getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((url) => /\/search\/api\/v1\/eco-food\/product-list/.test(url));
    if (observed) return new URL(observed);

    const url = new URL('https://snappfood.ir/search/api/v1/eco-food/product-list');
    const pageParams = new URLSearchParams(location.search);
    const cookies = Object.fromEntries(document.cookie.split('; ').map((item) => {
      const separator = item.indexOf('=');
      return separator < 0 ? [item, ''] : [item.slice(0, separator), item.slice(separator + 1)];
    }));

    // Shared Eco/carousel links already contain the location and active filters.
    // Prefer those values over cookies so the same link works after a fresh load.
    for (const key of ['lat', 'long', 'filters', 'mode', 'updateChannels']) {
      const value = pageParams.get(key);
      if (value) url.searchParams.set(key, value);
    }
    if (!url.searchParams.has('lat') && cookies.lat) url.searchParams.set('lat', cookies.lat);
    if (!url.searchParams.has('long') && cookies.long) url.searchParams.set('long', cookies.long);

    const addressId = pageParams.get('addressId')
      || cookies.addressId
      || cookies.selectedAddressId;
    if (addressId) url.searchParams.set('addressId', addressId);

    const superType = pageParams.get('superType');
    if (superType) {
      const parsedSuperType = Number(superType);
      url.searchParams.set(
        'superType',
        Number.isFinite(parsedSuperType) ? JSON.stringify([parsedSuperType]) : superType,
      );
    }
    return url;
  }

  function unwrapEcoPayload(value) {
    if (!value || typeof value !== 'object') return null;
    if (Array.isArray(value.finalResult)) return value;
    for (const key of ['data', 'result']) {
      const found = unwrapEcoPayload(value[key]);
      if (found) return found;
    }
    return null;
  }

  function ecoReviewUrl(itemId, ecoBaseUrl) {
    const observed = performance.getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((url) => /\/mobile\/v3\/restaurant\/productReviews/.test(url));
    let url;
    try {
      url = observed
        ? new URL(observed)
        : new URL('https://snappfood.ir/mobile/v3/restaurant/productReviews');
    } catch {
      url = new URL('https://snappfood.ir/mobile/v3/restaurant/productReviews');
    }
    const pageParams = new URLSearchParams(location.search);
    const lat = ecoBaseUrl?.searchParams.get('lat') || pageParams.get('lat');
    const long = ecoBaseUrl?.searchParams.get('long') || pageParams.get('long');
    if (lat) url.searchParams.set('lat', lat);
    if (long) url.searchParams.set('long', long);
    url.searchParams.set('optionalClient', 'SUPERAPP');
    url.searchParams.set('client', 'SUPERAPP');
    url.searchParams.set('deviceType', 'SUPERAPP');
    url.searchParams.set('appVersion', '6.0.0');
    url.searchParams.set('Bonyan', 'true');
    url.searchParams.set('variationIds', itemId);
    url.searchParams.set('page', '0');
    url.searchParams.set('pageSize', '10');
    return url.href;
  }

  function ecoProduct(raw, order, originalHref, exactHrefs, ecoBaseUrl) {
    const item = raw.data || raw;
    const vendor = item.vendor || {};
    const responseHref = item.href || item.url || item.link || item.deepLink || item.deep_link || '';
    const itemId = String(item.productVariationId || item.variationId || item.id);
    let url = exactHrefs.get(itemId) || '';
    try {
      if (!url && responseHref) url = new URL(responseHref, location.origin).href;
    } catch {
      url = '';
    }
    if (!url && originalHref) {
      url = productHrefFromOriginal(
        {
          ...item,
          id: itemId,
          vendorId: item.vendorId ?? vendor.id,
          vendorCode: item.vendorCode ?? vendor.vendorCode ?? vendor.vendor_code,
        },
        {
          superType: item.superType
            ?? vendor.superTypeId
            ?? vendor.vendor_super_type_id,
        },
        originalHref,
      );
    }
    if (!url && itemId) url = ecoReviewUrl(itemId, ecoBaseUrl);
    const title = item.title || item.productTitle || 'محصول بدون نام';
    const vendorName = vendor.title || item.vendorTitle || item.vendorName || '';
    const discountRatio = Number(item.discountRatio || item.discount || 0);
    const price = item.final_price ?? item.finalPrice ?? (
      discountRatio ? Math.round(Number(item.price) * (100 - discountRatio) / 100) : item.price
    );
    return {
      id: itemId,
      url,
      title,
      vendor: vendorName,
      rating: item.normalized_rating ?? item.rating ?? '',
      discount: discountRatio ? `%${discountRatio}` : '',
      price: price == null ? '' : String(price),
      delivery: '',
      stock: item.stock == null ? Number.NaN : Number(item.stock),
      text: `${title} · ${vendorName}`,
      searchable: normalize(`${title} ${vendorName}`),
      source: 'eco',
      order,
    };
  }

  async function fetchEcoPage(baseUrl, page, pageSize) {
    const url = new URL(baseUrl);
    url.searchParams.set('page', String(page));
    url.searchParams.set('page_size', String(pageSize));
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) throw new Error(`Eco API returned ${response.status}`);
    const payload = unwrapEcoPayload(await response.json());
    if (!payload) throw new Error('Eco API response was not recognized');
    return payload;
  }

  async function collectAllViaEcoApi() {
    const baseUrl = ecoApiUrl();
    if (!baseUrl) return false;
    // Eco's list response does not consistently expose a navigable product
    // URL. Preserve the exact route generated by Snappfood itself and use it
    // as a template for products that are not currently rendered on screen.
    const originalAnchors = pageProductAnchors();
    const originalHref = originalAnchors[0]?.href || '';
    const exactHrefs = new Map(originalAnchors.map((anchor) => [productId(anchor.href), anchor.href]));
    // Search across every Eco vendor type, regardless of the tab encoded in
    // the shared page URL or the request initially made by the website.
    baseUrl.searchParams.delete('superType');
    const requestedPageSize = 500;
    const first = await fetchEcoPage(baseUrl, 0, requestedPageSize);
    const firstProducts = first.finalResult || [];
    const total = Number(first.count ?? first.total) || firstProducts.length;
    if (!firstProducts.length) return false;
    state.products.clear();
    firstProducts.forEach((raw) => {
      const product = ecoProduct(raw, state.products.size, originalHref, exactHrefs, baseUrl);
      state.products.set(product.id, product);
    });
    state.apiMode = true;
    updateCounter(total);
    return true;
  }

  function productHrefFromOriginal(raw, party, originalHref) {
    if (!originalHref) return '';
    try {
      const url = new URL(originalHref, location.href);
      const segments = url.pathname.split('/');
      // Snappfood reads the product id from the second-to-last path segment.
      const productSegment = segments.length - 2;
      if (productSegment < 0) return '';
      segments[productSegment] = encodeURIComponent(String(raw.id));
      url.pathname = segments.join('/');

      const replacements = {
        vendorid: raw.vendorId,
        vendorcode: raw.vendorCode,
        code: raw.vendorCode,
        supertype: party.superType,
        dealprojectcode: raw.deal_project_code,
        dealprojectlistid: party.dealProjectListId,
        dealprojectid: raw.deal_project_id,
      };
      [...url.searchParams.keys()].forEach((key) => {
        const value = replacements[key.toLowerCase()];
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      });
      return url.href;
    } catch {
      return '';
    }
  }

  function apiProduct(raw, order, party, originalHref, exactHrefs, renderedProducts, proFreeDelivery) {
    const variationId = String(raw.productVariationId || raw.id);
    const originalDelivery = raw.deliveryFee ?? raw.delivery_fee;
    const finalDelivery = raw.deliveryFeeAfterDiscount
      ?? raw.delivery_fee_after_discount
      ?? raw.discountedDeliveryFee;
    // Prefer the final payable fee whenever the response provides it. Do not
    // depend on isDeliveryFeeHasDiscount, which is not present consistently.
    const delivery = finalDelivery !== undefined && finalDelivery !== null && finalDelivery !== ''
      ? finalDelivery
      : originalDelivery;
    const discountedPrice = raw.discountRatio
      ? Math.round(Number(raw.price) * (100 - Number(raw.discountRatio)) / 100)
      : Number(raw.price);
    const title = raw.productVariationTitle || raw.title || 'محصول بدون نام';
    const vendor = raw.vendorTitle || raw.vendorName || '';
    const renderedProduct = renderedProducts.get(String(raw.id)) || renderedProducts.get(variationId);
    const proDelivery = delivery !== undefined && delivery !== null && delivery !== ''
      && Number.isFinite(Number(delivery))
      ? Math.max(0, Number(delivery) - 35000)
      : null;
    const deliveryLabel = renderedProduct?.delivery
      || (proFreeDelivery && (raw.is_pro || raw.isPro) && proDelivery !== null
        ? (proDelivery === 0 ? 'رایگان' : String(proDelivery))
        : '')
      || (Number(delivery) === 0 ? 'رایگان' : (delivery == null ? '' : String(delivery)));
    const exactHref = exactHrefs.get(String(raw.id)) || exactHrefs.get(variationId) || '';
    const url = exactHref || productHrefFromOriginal(raw, party, originalHref);
    const searchable = normalize(`${title} ${vendor}`);
    return {
      id: variationId,
      variationId,
      url,
      title,
      vendor,
      rating: raw.rating == null ? '' : String(Math.round(Number(raw.rating) * 5) / 10),
      discount: raw.discountRatio ? `%${raw.discountRatio}` : '',
      price: discountedPrice ? String(discountedPrice) : '',
      delivery: deliveryLabel,
      stock: Number(raw.stock),
      text: `${title} · ${vendor}`,
      searchable,
      order,
    };
  }

  async function fetchPartyPage(baseUrl, page, pageSize) {
    const url = new URL(baseUrl);
    url.searchParams.set('page', String(page));
    url.searchParams.set('page_size', String(pageSize));
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) throw new Error(`Party API returned ${response.status}`);
    const payload = unwrapPartyPayload(await response.json());
    if (!payload) throw new Error('Party API response was not recognized');
    return payload;
  }

  async function collectAllViaPartyApi() {
    const baseUrl = partyApiUrl();
    if (!baseUrl) return false;

    // Use the exact href format rendered by the current Snappfood page. This
    // preserves route names, trailing slashes and query-key casing as-is.
    const originalAnchors = pageProductAnchors();
    const originalHref = originalAnchors[0]?.href || '';
    const exactHrefs = new Map(originalAnchors.map((anchor) => [productId(anchor.href), anchor.href]));
    const renderedProducts = new Map(originalAnchors.map((anchor) => {
      const product = readCard(anchor);
      return [product.id, product];
    }));
    const proFreeDelivery = originalAnchors.some((anchor) => {
      const text = `${anchor.innerText || ''}\n${anchor.textContent || ''}`;
      return /رایگان/.test(text) && /\bPro\b/i.test(text);
    });
    if (!originalHref) return false;

    // A huge page_size is server-controlled and may be rejected or silently capped.
    // 500 reduces round trips substantially while still avoiding an unbounded MAXINT request.
    const requestedPageSize = 500;
    const first = await fetchPartyPage(baseUrl, 0, requestedPageSize);
    const firstProducts = first.products || [];
    if (!firstProducts.length) return false;
    const total = Number(first.total_count) || firstProducts.length;
    const effectivePageSize = firstProducts.length;
    const pageCount = Math.ceil(total / effectivePageSize);
    const remainingPages = await Promise.all(
      Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => (
        fetchPartyPage(baseUrl, index + 1, requestedPageSize)
      )),
    );
    const rawProducts = [first, ...remainingPages].flatMap((page) => page.products || []);
    state.products.clear();
    rawProducts.forEach((raw) => {
      const product = apiProduct(
        raw,
        state.products.size,
        first,
        originalHref,
        exactHrefs,
        renderedProducts,
        proFreeDelivery,
      );
      state.products.set(product.id, product);
    });
    state.apiMode = true;
    updateCounter(total);
    return true;
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

  function moveScroller(scroller, top) {
    const safeTop = Math.max(0, top);
    if (typeof scroller.scrollTo === 'function') scroller.scrollTo({ top: safeTop, behavior: 'auto' });
    else scroller.scrollTop = safeTop;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
  }

  async function sweepToBottom(scroller) {
    let previousTop = -1;
    for (let step = 0; step < 250 && !state.cancelled; step += 1) {
      collectVisibleCards();
      const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      if (scroller.scrollTop >= maxTop - 4 || scroller.scrollTop === previousTop) break;
      previousTop = scroller.scrollTop;
      moveScroller(scroller, Math.min(
        scroller.scrollTop + Math.max(140, scroller.clientHeight * 0.45),
        maxTop,
      ));
      await sleep(90);
    }
    collectVisibleCards();
  }

  function findLoadMoreButton() {
    return [...document.querySelectorAll('button')].find((button) => (
      !button.closest('#sfps-root')
      && /(?:نمایش|مشاهده|بارگذاری).*بیشتر|بیشتر/.test(normalize(button.innerText))
      && !button.disabled
    ));
  }

  async function waitForProgress(scroller, previousSize, previousHeight) {
    const deadline = Date.now() + CONFIG.progressTimeoutMs;
    while (Date.now() < deadline && !state.cancelled) {
      await sleep(120);
      collectVisibleCards();
      updateCounter();
      if (state.products.size > previousSize || scroller.scrollHeight > previousHeight) return true;
    }
    return false;
  }

  async function requestNextProducts(scroller) {
    const previousSize = state.products.size;
    const previousHeight = scroller.scrollHeight;
    await sweepToBottom(scroller);
    const loadMore = findLoadMoreButton();

    if (loadMore) loadMore.click();
    const lastAnchor = pageProductAnchors().at(-1);
    const lastCard = lastAnchor && visualCardElement(lastAnchor);
    if (lastCard) lastCard.scrollIntoView({ block: 'end', behavior: 'auto' });
    moveScroller(scroller, Math.max(0, scroller.scrollHeight - scroller.clientHeight));

    if (await waitForProgress(scroller, previousSize, previousHeight)) return true;

    // Some infinite lists only react after leaving and re-entering the bottom threshold.
    moveScroller(scroller, Math.max(0, scroller.scrollHeight - scroller.clientHeight - 180));
    await sleep(180);
    moveScroller(scroller, Math.max(0, scroller.scrollHeight - scroller.clientHeight));
    return waitForProgress(scroller, previousSize, previousHeight);
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
    state.products.clear();
    const originalTop = scroller.scrollTop;
    const expected = expectedCount();
    let stableRounds = 0;

    document.querySelector('#sfps-load').hidden = true;
    document.querySelector('#sfps-stop').hidden = false;
    setStatus('در حال جمع‌آوری؛ لطفاً این صفحه را باز نگه دارید…', 'loading');

    try {
      setStatus('در حال دریافت مستقیم فهرست محصولات…', 'loading');
      try {
        if (await collectAllViaEcoApi()) {
          setStatus('همهٔ محصولات Eco دریافت شدند و آمادهٔ جستجو هستند.', 'success');
          return;
        }
        if (await collectAllViaPartyApi()) {
          setStatus('همهٔ محصولات از API دریافت شدند و آمادهٔ جستجو هستند.', 'success');
          return;
        }
      } catch (apiError) {
        console.warn('[Snappfood Party Search] API fallback:', apiError);
        state.apiMode = false;
        setStatus('دریافت مستقیم ممکن نشد؛ در حال خواندن خود صفحه…', 'warning');
      }

      moveScroller(scroller, 0);
      await sleep(CONFIG.waitAfterScrollMs);
      await sweepToBottom(scroller);

      for (let round = 0; round < CONFIG.maxRounds && !state.cancelled; round += 1) {
        collectVisibleCards();
        updateCounter(expected);
        renderResults();

        if (expected && state.products.size >= expected) break;
        const progressed = await requestNextProducts(scroller);
        stableRounds = progressed ? 0 : stableRounds + 1;
        if (stableRounds >= CONFIG.stableRoundsToFinish) break;
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
      moveScroller(scroller, Math.min(originalTop, scroller.scrollHeight));
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

  function visualCardElement(anchor) {
    let element = anchor;
    while (element.parentElement && element.parentElement !== document.body) {
      const rect = element.getBoundingClientRect();
      if (rect.height >= 70 && rect.width >= 180) return element;
      element = element.parentElement;
    }
    return anchor;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
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

    list.innerHTML = products.map((product) => {
      const unavailable = product.stock === 0;
      const productUrl = product.url || (
        product.source === 'eco' ? ecoReviewUrl(product.id, ecoApiUrl()) : ''
      );
      const clickable = Boolean(productUrl) && !unavailable;
      const tag = clickable ? 'a' : 'article';
      const linkAttributes = clickable
        ? `href="${escapeHtml(productUrl)}" title="بازکردن اطلاعات محصول"`
        : `aria-disabled="true" title="${unavailable ? 'این محصول ناموجود است' : 'لینک محصول در پاسخ اسنپ‌فود موجود نیست'}"`;
      return `
      <${tag} class="sfps-card${clickable ? '' : ' sfps-card-disabled'}${unavailable ? ' sfps-card-unavailable' : ''}" ${linkAttributes}>
        <span class="sfps-card-title"><strong>${escapeHtml(product.title)}</strong>${unavailable ? '<b class="sfps-unavailable-badge">ناموجود</b>' : ''}</span>
        ${product.vendor ? `<span class="sfps-vendor">${escapeHtml(product.vendor)}</span>` : ''}
        <span class="sfps-meta">
          ${product.discount ? `<b>${escapeHtml(product.discount)} تخفیف</b>` : ''}
          ${product.price ? `<span>${escapeHtml(product.price)} تومان</span>` : ''}
          ${product.rating ? `<span>★ ${escapeHtml(product.rating)}</span>` : ''}
        </span>
        <span class="sfps-card-footer">
          <span class="sfps-card-link">${unavailable ? 'اتمام موجودی' : (productUrl ? 'مشاهده محصول ←' : 'لینک محصول موجود نیست')}</span>
        </span>
      </${tag}>`;
    }).join('');
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
          <a href="https://github.com/hedieh-hj" target="_blank" rel="noopener noreferrer">توسعه‌یافته توسط @hedieh-hj</a>
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
    .sfps-card { display: grid; gap: 6px; margin: 8px 0; padding: 13px 14px; border: 1px solid #ececf0; border-radius: 13px; background: #fff; color: inherit; box-shadow: 0 2px 8px #0000000a; cursor: pointer; text-decoration: none; }
    .sfps-card:hover, .sfps-card:focus { border-color: #ff00a666; transform: translateY(-1px); outline: none; }
    .sfps-card strong { font-size: 14px; line-height: 1.6; }
    .sfps-card-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .sfps-unavailable-badge { flex: 0 0 auto; padding: 3px 8px; border-radius: 999px; background: #eeeeef; color: #777; font-size: 10px; }
    .sfps-vendor { color: #666; font-size: 12px; }
    .sfps-meta { display: flex; gap: 11px; align-items: center; font-size: 12px; color: #555; }
    .sfps-meta b { color: #ff00a6; }
    .sfps-card-footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding-top: 6px; border-top: 1px solid #f0f0f2; font-size: 11px; }
    .sfps-card-link { color: #d6008c; font-weight: 700; }
    .sfps-card-disabled { cursor: default; opacity: .72; }
    .sfps-card-disabled .sfps-card-link { color: #888; }
    .sfps-card-unavailable { background: #f1f1f3; border-color: #dedee2; box-shadow: none; filter: grayscale(.35); }
    .sfps-card-unavailable:hover, .sfps-card-unavailable:focus { border-color: #dedee2; transform: none; }
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
    const hasProducts = pageProductAnchors().length > 0 || /^\/eco\/?$/.test(location.pathname);
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
