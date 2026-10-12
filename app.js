/* Витрина «Капибара»: показ наличия, расчёт суммы, отслеживание. Заказы не принимаются. */
(function () {
  'use strict';

  var L = window.KapLogic;
  var CFG = window.APP_CONFIG || {};
  function tgApp() { return window.Telegram && window.Telegram.WebApp; }

  var products = [];   // линейки (карточки каталога)
  var items = [];      // плоский список для расчёта и слежения (каждый вкус отдельно)
  var openId = null;   // открытая карточка линейки
  var onlyInStock = false;
  var catScroll = 0;
  var filter = { cat: 'all', onlyNew: false, q: '' };
  var cart = {};
  var watch = {};
  var currentView = 'catalog';
  var toastTimer = null;

  // ---------- хранилище (только на устройстве человека) ----------
  function lsGet(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* хранилище недоступно — работаем без него */ }
  }

  // ---------- мелкие помощники ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function byId(id) {
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  }
  function lineById(id) {
    for (var i = 0; i < products.length; i++) if (products[i].id === id) return products[i];
    return null;
  }

  var STATUS_TEXT = { 'in': 'В наличии', low: 'Мало', out: 'Нет в наличии' };

  var PALETTE = [
    'linear-gradient(135deg, #5b2a86 0%, #d0447b 100%)',
    'linear-gradient(135deg, #e8a317 0%, #f0642a 100%)',
    'linear-gradient(135deg, #14707a 0%, #5fd0b8 100%)',
    'linear-gradient(135deg, #e8453c 0%, #f7b733 100%)',
    'linear-gradient(135deg, #2e2a7a 0%, #8f5bd6 100%)'
  ];
  var STEEL = 'linear-gradient(135deg, #3b3f46 0%, #7a828e 100%)';

  function tileBg(p) {
    if (p.category !== 'liquid' && p.category !== 'hookah') return STEEL;
    var h = 0;
    for (var i = 0; i < p.name.length; i++) h = (h + p.name.charCodeAt(i)) % 997;
    return PALETTE[h % PALETTE.length];
  }

  // Иконки — наши константы, поэтому innerHTML безопасен
  var ICONS = {
    liquid: '<svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5c3.2 4 5.5 6.8 5.5 9.8a5.5 5.5 0 0 1-11 0c0-3 2.3-5.8 5.5-9.8z"/><path d="M9.5 14a2.6 2.6 0 0 0 2.5 2.4"/></svg>',
    hookah: '<svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v3M9.5 6h5M9.5 6L7 13.5a5 5 0 0 0 10 0L14.5 6M8 20h8"/></svg>',
    part: '<svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3"/><path d="M12 4.5V9M12 15v4.5M4.5 12H9M15 12h4.5"/></svg>',
    device: '<svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="3" width="8" height="18" rx="3"/><path d="M11 6.5h2M12 17.5h.01"/></svg>',
    other: '<svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/></svg>',
    plus: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    bell: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 17h12l-1.5-2.2V10.5a4.5 4.5 0 0 0-9 0v4.3L6 17z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
    chev: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
    x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  function toast(text) {
    var t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 1800);
  }

  function openLink(url) {
    if (!url) return;
    var tg = tgApp();
    try {
      if (tg && /^https:\/\/t\.me\//.test(url) && tg.openTelegramLink) { tg.openTelegramLink(url); return; }
      if (tg && tg.openLink) { tg.openLink(url); return; }
    } catch (e) { /* ниже запасной вариант */ }
    window.open(url, '_blank', 'noopener');
  }

  // ---------- экраны ----------
  function show(name) {
    if (currentView === 'catalog' && name !== 'catalog') catScroll = window.scrollY || 0;
    currentView = name;
    var views = document.querySelectorAll('[data-view]');
    for (var i = 0; i < views.length; i++) views[i].hidden = views[i].getAttribute('data-view') !== name;
    $('dock').hidden = name !== 'catalog';
    if (name === 'calc') renderCalc();
    if (name === 'watch') renderWatch();
    if (name === 'product') renderProduct();
    window.scrollTo(0, name === 'catalog' ? catScroll : 0);
    try {
      var tg = tgApp();
      if (tg && tg.BackButton) { if (name === 'catalog') tg.BackButton.hide(); else tg.BackButton.show(); }
    } catch (e) { /* не критично */ }
  }

  // ---------- каталог ----------
  function renderCatalog() {
    var grid = $('grid');
    clear(grid);
    var list = L.filterProducts(products, filter);
    $('empty').hidden = list.length > 0 || products.length === 0;

    list.forEach(function (p) {
      var card = el('article', 'card is-link');
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', 'Открыть: ' + p.name);
      card.addEventListener('click', function () { openProduct(p.id); });
      card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProduct(p.id); } });

      var tile = el('div', 'tile');
      tile.style.background = tileBg(p);
      if (p.img) {
        var ph = el('img', 'tile-img');
        ph.alt = '';
        ph.loading = 'lazy';
        ph.onload = function () { tile.classList.add('has-img'); };
        ph.onerror = function () { if (ph.parentNode) ph.parentNode.removeChild(ph); };
        ph.src = p.img;
        tile.appendChild(ph);
      }
      var icon = el('span');
      icon.innerHTML = ICONS[p.category] || ICONS.other;
      tile.appendChild(icon);
      var st = el('div', 'status s-' + p.status);
      st.appendChild(el('span', 'dot'));
      st.appendChild(el('span', '', STATUS_TEXT[p.status]));
      tile.appendChild(st);
      if (p.isNew) tile.appendChild(el('div', 'tag-new', 'Новое'));
      card.appendChild(tile);

      var body = el('div', 'card-body');
      body.appendChild(el('div', 'card-name', p.name));
      if (p.sub) body.appendChild(el('div', 'card-sub', p.sub));
      if (p.flavors.length) body.appendChild(el('div', 'card-sub card-count', 'Вкусов в наличии: ' + (p.counts['in'] + p.counts.low) + ' из ' + p.counts.total));
      var foot = el('div', 'card-foot');
      foot.appendChild(el('div', 'price' + (p.price === null ? ' price-none' : ''), p.price === null ? 'Цена в магазине' : L.formatPrice(p.price)));

      if (p.flavors.length) {
        var go = el('span', 'round round-go');
        go.innerHTML = ICONS.chev;
        foot.appendChild(go);
      } else if (p.status === 'out') {
        var w = el('button', 'round round-watch');
        w.type = 'button';
        var on = !!watch[p.id];
        w.setAttribute('aria-pressed', on ? 'true' : 'false');
        w.setAttribute('aria-label', on ? 'Не следить: ' + p.name : 'Следить за наличием: ' + p.name);
        w.innerHTML = ICONS.bell;
        w.addEventListener('click', function (e) { e.stopPropagation(); toggleWatch(p.id); });
        foot.appendChild(w);
      } else {
        var a = el('button', 'round round-add');
        a.type = 'button';
        a.setAttribute('aria-label', 'Добавить в расчёт: ' + p.name);
        a.innerHTML = ICONS.plus;
        a.addEventListener('click', function (e) { e.stopPropagation(); addToCart(p.id); });
        foot.appendChild(a);
      }
      body.appendChild(foot);
      card.appendChild(body);
      grid.appendChild(card);
    });
  }

  // ---------- карточка линейки ----------
  function openProduct(id) {
    openId = id;
    onlyInStock = false;
    show('product');
  }

  function buildProductView() {
    var main = el('main', 'view');
    main.id = 'view-product';
    main.setAttribute('data-view', 'product');
    main.hidden = true;
    main.innerHTML =
      '<header class="hero hero-page">' +
        '<button class="back" type="button" data-go="catalog">' + ICONS.chev.replace('<path d="M9 5l7 7-7 7"/>', '<path d="M15 5l-7 7 7 7"/>') + '<span>Каталог</span></button>' +
        '<h2 class="page-title" id="pr-name"></h2>' +
        '<p class="hero-sub" id="pr-sub"></p>' +
      '</header>' +
      '<div class="detail-img" id="pr-img" hidden></div>' +
      '<div class="detail">' +
        '<p class="detail-desc" id="pr-desc"></p>' +
        '<div class="detail-tools">' +
          '<span class="muted small" id="pr-count"></span>' +
          '<button id="pr-only" class="chip-btn chip-sm" type="button" aria-pressed="false">Только в наличии</button>' +
        '</div>' +
      '</div>' +
      '<div id="pr-list" class="list list-tight"></div>' +
      '<p id="pr-empty" class="empty muted" hidden>Нет вкусов в наличии.</p>' +
      '<div class="spacer spacer-lg"></div>' +
      '<footer class="sheet">' +
        '<button id="pr-calc" class="btn btn-primary" type="button">Мой расчёт</button>' +
        '<p class="muted small center">Цены ориентировочные, актуальные уточняйте в магазине. Только для лиц старше 18 лет.</p>' +
      '</footer>';
    return main;
  }

  function renderProduct() {
    var p = lineById(openId);
    if (!p) { show('catalog'); return; }
    $('pr-name').textContent = p.name;
    $('pr-sub').textContent = p.sub;
    var box = $('pr-img');
    clear(box);
    box.hidden = true;
    if (p.img) {
      var im = el('img');
      im.alt = p.name;
      im.onload = function () { box.hidden = false; };
      im.onerror = function () { box.hidden = true; };
      im.src = p.img;
      box.appendChild(im);
    }
    var d = $('pr-desc');
    d.textContent = p.desc;
    d.hidden = !p.desc;
    $('pr-count').textContent = p.flavors.length
      ? 'Вкусов в наличии: ' + (p.counts['in'] + p.counts.low) + ' из ' + p.counts.total
      : (STATUS_TEXT[p.status] + (p.price === null ? '' : ' · ' + L.formatPrice(p.price)));
    var only = $('pr-only');
    only.hidden = !p.flavors.length;
    only.setAttribute('aria-pressed', onlyInStock ? 'true' : 'false');

    var list = $('pr-list');
    clear(list);
    var rows = p.flavors.length
      ? items.filter(function (it) { return it.parentId === p.id; })
      : [p];
    var shown = 0;
    rows.forEach(function (it) {
      if (onlyInStock && it.status === 'out') return;
      shown++;
      var row = el('div', 'row');
      var th = el('div', 'thumb');
      th.style.background = tileBg(it);
      row.appendChild(th);
      var main = el('div', 'row-main');
      var s = el('div', 'row-status s-' + it.status);
      var dot = el('span', 'dot');
      dot.style.background = it.status === 'in' ? 'var(--ok)' : (it.status === 'low' ? 'var(--low)' : 'var(--out)');
      s.appendChild(dot);
      s.appendChild(el('span', '', STATUS_TEXT[it.status]));
      main.appendChild(s);
      main.appendChild(el('div', 'row-name', p.flavors.length ? it.name : p.name));
      if (it.price !== null) main.appendChild(el('div', 'row-price', L.formatPrice(it.price)));
      row.appendChild(main);

      if (it.status === 'out') {
        var w = el('button', 'round round-watch');
        w.type = 'button';
        var on = !!watch[it.id];
        w.setAttribute('aria-pressed', on ? 'true' : 'false');
        w.setAttribute('aria-label', (on ? 'Не следить: ' : 'Следить за наличием: ') + it.name);
        w.innerHTML = ICONS.bell;
        w.addEventListener('click', function () { toggleWatch(it.id); });
        row.appendChild(w);
      } else {
        var a = el('button', 'round round-add');
        a.type = 'button';
        a.setAttribute('aria-label', 'Добавить в расчёт: ' + it.name);
        a.innerHTML = ICONS.plus;
        a.addEventListener('click', function () { addToCart(it.id); });
        row.appendChild(a);
        if (cart[it.id]) row.appendChild(el('div', 'in-cart', '× ' + cart[it.id]));
      }
      list.appendChild(row);
    });
    $('pr-empty').hidden = shown > 0;
    updateProductBar();
  }

  function updateProductBar() {
    var b = $('pr-calc');
    if (!b) return;
    var t = L.calcTotal(cart, items);
    b.textContent = t.positions ? 'Мой расчёт · ' + L.pluralPositions(t.positions) + ' · ' + L.formatPrice(t.total) : 'Мой расчёт (пока пусто)';
  }

  function refreshOpen() {
    if (currentView === 'product') renderProduct();
  }

  // ---------- расчёт ----------
  function saveCart() { lsSet('kap.cart', cart); }

  function addToCart(id) {
    var p = byId(id);
    if (!p || p.status === 'out') return;
    cart[id] = Math.min(99, (cart[id] || 0) + 1);
    saveCart();
    updateDock();
    refreshOpen();
    toast('Добавлено в расчёт');
  }

  function changeQty(id, delta) {
    var q = (cart[id] || 0) + delta;
    if (q <= 0) delete cart[id]; else cart[id] = Math.min(99, q);
    saveCart();
    renderCalc();
    updateDock();
  }

  function updateDock() {
    var t = L.calcTotal(cart, items);
    updateProductBar();
    $('dock-count').textContent = L.pluralPositions(t.positions);
    $('dock-sum').textContent = L.formatPrice(t.total);
  }

  function renderCalc() {
    var list = $('calc-list');
    clear(list);
    var shown = 0;
    Object.keys(cart).forEach(function (id) {
      var p = byId(id);
      if (!p) return;
      shown++;
      var row = el('div', 'row');
      var th = el('div', 'thumb');
      th.style.background = tileBg(p);
      row.appendChild(th);
      var main = el('div', 'row-main');
      main.appendChild(el('div', 'row-name', p.name));
      if (p.sub) main.appendChild(el('div', 'row-sub', p.sub));
      main.appendChild(el('div', 'row-price', L.formatPrice(p.price)));
      row.appendChild(main);

      var stp = el('div', 'stepper');
      var minus = el('button', 'step', '−');
      minus.type = 'button';
      minus.setAttribute('aria-label', 'Меньше: ' + p.name);
      minus.addEventListener('click', function () { changeQty(id, -1); });
      var plus = el('button', 'step step-plus', '+');
      plus.type = 'button';
      plus.setAttribute('aria-label', 'Больше: ' + p.name);
      plus.addEventListener('click', function () { changeQty(id, 1); });
      stp.appendChild(minus);
      stp.appendChild(el('div', 'qty', String(cart[id])));
      stp.appendChild(plus);
      row.appendChild(stp);
      list.appendChild(row);
    });
    $('calc-empty').hidden = shown > 0;
    var t = L.calcTotal(cart, items);
    $('calc-count').textContent = L.pluralPositions(t.positions);
    $('calc-total').textContent = L.formatPrice(t.total);
  }

  // ---------- отслеживание ----------
  function saveWatch() { lsSet('kap.watch', watch); }

  function toggleWatch(id) {
    if (watch[id]) {
      delete watch[id];
      toast('Больше не слежу');
    } else {
      watch[id] = true;
      toast('Слежу. Отметка появится в разделе с колокольчиком');
    }
    saveWatch();
    renderCatalog();
    refreshOpen();
    updateBadge();
  }

  function updateBadge() {
    var n = L.watchReady(watch, items).length;
    var b = $('watch-badge');
    b.hidden = n === 0;
    b.textContent = String(n);
  }

  function renderWatch() {
    var list = $('watch-list');
    clear(list);
    var ready = {};
    L.watchReady(watch, items).forEach(function (id) { ready[id] = true; });
    var ids = Object.keys(watch);
    $('watch-empty').hidden = ids.length > 0;

    ids.forEach(function (id) {
      var p = byId(id);
      var row = el('div', 'row' + (ready[id] ? ' is-ready' : ''));
      var th = el('div', 'thumb');
      th.style.background = p ? tileBg(p) : STEEL;
      row.appendChild(th);
      var main = el('div', 'row-main');
      main.appendChild(el('div', 'row-name', p ? p.name : 'Позиции больше нет в каталоге'));
      if (p && p.sub) main.appendChild(el('div', 'row-sub', p.sub));
      if (p) {
        var s = el('div', 'row-status s-' + (ready[id] ? 'in' : 'out'));
        s.appendChild(el('span', 'dot'));
        s.lastChild.style.background = ready[id] ? 'var(--ok)' : 'var(--out)';
        s.appendChild(el('span', '', ready[id] ? 'Появилось в наличии' : 'Нет в наличии'));
        main.appendChild(s);
      }
      row.appendChild(main);
      var x = el('button', 'x-btn');
      x.type = 'button';
      x.setAttribute('aria-label', 'Перестать следить');
      x.innerHTML = ICONS.x;
      x.addEventListener('click', function () {
        delete watch[id];
        saveWatch();
        renderWatch();
        renderCatalog();
        refreshOpen();
        updateBadge();
      });
      row.appendChild(x);
      list.appendChild(row);
    });
  }

  // ---------- контакты ----------
  function renderContact() {
    $('c-address').textContent = CFG.ADDRESS || '';
    $('c-hours').textContent = CFG.HOURS || '';
    $('c-tg').textContent = CFG.SELLER_TG ? '@' + CFG.SELLER_TG : '—';
    $('btn-write').hidden = !CFG.SELLER_TG;
    $('btn-call').hidden = !CFG.PHONE;
    $('btn-map').hidden = !CFG.MAP_URL;
  }

  function setupContact() {
    $('btn-write').addEventListener('click', function () { openLink('https://t.me/' + encodeURIComponent(CFG.SELLER_TG)); });
    $('btn-call').addEventListener('click', function () { window.location.href = 'tel:' + String(CFG.PHONE).replace(/[^\d+]/g, ''); });
    $('btn-map').addEventListener('click', function () { openLink(CFG.MAP_URL); });
    $('faq-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var q = $('faq-q').value;
      var ans = L.faqAnswer(q, CFG.FAQ, { ADDRESS: CFG.ADDRESS || '', HOURS: CFG.HOURS || '' });
      var out = $('faq-answer');
      if (!String(q).trim()) { out.hidden = true; return; }
      out.textContent = ans || 'Не нашёл ответ. Напишите продавцу — кнопка ниже.';
      out.hidden = false;
    });
  }

  // ---------- загрузка товаров ----------
  function loadProducts() {
    function fromJson() {
      return fetch('data/products.json', { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(L.normalizeAll);
    }
    if (CFG.SHEET_CSV_URL) {
      return fetch(CFG.SHEET_CSV_URL, { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (t) {
          var list = L.normalizeAll(L.rowsToObjects(L.parseCSV(t)));
          if (!list.length) throw new Error('пустая таблица');
          return list;
        })
        .catch(fromJson);
    }
    return fromJson();
  }

  // ---------- запуск ----------
  // Категория «Кальян» и экран карточки добавляются здесь, чтобы не трогать index.html
  function injectUi() {
    var cats = $('cats');
    if (cats && !cats.querySelector('[data-cat="hookah"]')) {
      var b = el('button', 'cat');
      b.type = 'button';
      b.setAttribute('data-cat', 'hookah');
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML = ICONS.hookah.replace(/width="46" height="46"/, 'width="22" height="22"').replace(/stroke="#fff"/, 'stroke="currentColor"').replace('stroke-width="1.5"', 'stroke-width="1.8"') + '<span>Кальян</span>';
      var after = cats.querySelector('[data-cat="liquid"]');
      cats.insertBefore(b, after ? after.nextSibling : null);
    }
    var contact = $('view-contact');
    contact.parentNode.insertBefore(buildProductView(), contact.nextSibling);
    $('pr-only').addEventListener('click', function () { onlyInStock = !onlyInStock; renderProduct(); });
    $('pr-calc').addEventListener('click', function () { show('calc'); });
  }

  function bindUi() {
    var cats = document.querySelectorAll('.cat');
    Array.prototype.forEach.call(cats, function (b) {
      b.addEventListener('click', function () {
        filter.cat = b.getAttribute('data-cat');
        Array.prototype.forEach.call(cats, function (x) {
          var on = x === b;
          x.classList.toggle('is-active', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        renderCatalog();
      });
    });
    $('toggle-new').addEventListener('click', function () {
      filter.onlyNew = !filter.onlyNew;
      this.setAttribute('aria-pressed', filter.onlyNew ? 'true' : 'false');
      renderCatalog();
    });
    $('q').addEventListener('input', function () { filter.q = this.value; renderCatalog(); });

    Array.prototype.forEach.call(document.querySelectorAll('[data-go]'), function (b) {
      b.addEventListener('click', function () { show(b.getAttribute('data-go')); });
    });
    $('open-watch').addEventListener('click', function () { show('watch'); });
    $('open-calc').addEventListener('click', function () { show('calc'); });
    $('open-contact').addEventListener('click', function () { show('contact'); });
    $('calc-clear').addEventListener('click', function () {
      cart = {};
      saveCart();
      renderCalc();
      updateDock();
    });
  }

  function brandUi() {
    var name = CFG.SHOP_NAME || 'Капибара';
    document.title = name + ' — наличие';
    Array.prototype.forEach.call(document.querySelectorAll('[data-shop-name]'), function (n) { n.textContent = name; });
    var letter = name.charAt(0).toUpperCase();
    Array.prototype.forEach.call(document.querySelectorAll('[data-logo]'), function (box) {
      box.firstChild.textContent = letter;
      var img = document.createElement('img');
      img.alt = '';
      img.onerror = function () { if (img.parentNode) img.parentNode.removeChild(img); };
      img.src = 'logo.png';
      box.appendChild(img);
    });
    $('shop-address').textContent = CFG.ADDRESS || '';
  }

  function startApp() {
    $('gate').hidden = true;
    $('app').hidden = false;
    show('catalog');
    loadProducts().then(function (list) {
      products = list;
      items = L.expandItems(products);
      // убираем из расчёта и слежения позиции, которых больше нет, но слежение сохраняем только для существующих
      Object.keys(cart).forEach(function (id) { if (!byId(id)) delete cart[id]; });
      saveCart();
      renderCatalog();
      updateDock();
      updateBadge();
    }).catch(function () {
      $('load-error').hidden = false;
    });
  }

  // Скрипт Telegram грузим фоном: если telegram.org недоступен, витрина всё равно открывается сразу
  var tgReady = false;
  function setupTelegram() {
    var tg = tgApp();
    if (!tg || tgReady) return;
    tgReady = true;
    try {
      tg.ready();
      tg.expand();
      tg.setHeaderColor('#140d09');
      tg.setBackgroundColor('#140d09');
      if (tg.BackButton) {
        tg.BackButton.onClick(function () { show('catalog'); });
        if (currentView !== 'catalog') tg.BackButton.show();
      }
    } catch (e) { /* не критично */ }
  }

  function loadTelegramSdk() {
    if (tgApp()) { setupTelegram(); return; }
    try {
      var s = document.createElement('script');
      s.src = 'https://telegram.org/js/telegram-web-app.js';
      s.async = true;
      s.onload = setupTelegram;
      s.onerror = function () { /* вне Telegram или без доступа — работаем без него */ };
      document.head.appendChild(s);
    } catch (e) { /* не критично */ }
  }

  function init() {
    loadTelegramSdk();
    cart = lsGet('kap.cart', {});
    watch = lsGet('kap.watch', {});
    brandUi();
    renderContact();
    setupContact();
    injectUi();
    bindUi();

    $('gate-yes').addEventListener('click', function () { lsSet('kap.age', true); startApp(); });
    $('gate-no').addEventListener('click', function () { $('gate-denied').hidden = false; });

    if (lsGet('kap.age', false)) startApp();
  }

  init();
})();
