/* Чистая логика без работы с экраном: разбор таблицы, цены, расчёт, отслеживание, ответы на вопросы. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KapLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Разбор CSV с поддержкой кавычек и переводов строк внутри ячеек
  function parseCSV(text) {
    var rows = [], row = [], cell = '', inQ = false, i, c;
    text = String(text || '').replace(/^﻿/, '');
    for (i = 0; i < text.length; i++) {
      c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else { inQ = false; }
        } else { cell += c; }
      } else if (c === '"') { inQ = true; }
      else if (c === ',' || c === ';') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c !== '\r') { cell += c; }
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); });
  }

  function rowsToObjects(rows) {
    if (!rows.length) return [];
    var head = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });
    return rows.slice(1).map(function (r) {
      var o = {};
      head.forEach(function (h, i) { o[h] = r[i] === undefined ? '' : r[i]; });
      return o;
    });
  }

  function normalizeStatus(s) {
    var t = String(s === undefined || s === null ? '' : s).trim().toLowerCase();
    if (['in', 'в наличии', 'есть', 'да', '1', 'true'].indexOf(t) !== -1) return 'in';
    if (['low', 'мало', 'заканчивается', 'осталось мало'].indexOf(t) !== -1) return 'low';
    return 'out'; // всё непонятное считаем «нет в наличии», чтобы не обещать лишнего
  }

  function normalizeCategory(c) {
    var t = String(c || '').trim().toLowerCase();
    if (/жидк|liquid/.test(t)) return 'liquid';
    if (/расход|part|испар|картридж/.test(t)) return 'part';
    if (/устр|device|pod/.test(t)) return 'device';
    return 'other';
  }

  function parsePrice(p) {
    if (typeof p === 'number') return isFinite(p) && p >= 0 ? p : null;
    var t = String(p === undefined || p === null ? '' : p).replace(/[\s ₽рубРУБ.]+$/g, '').replace(/[\s ]/g, '').replace(',', '.');
    if (t === '') return null;
    var n = Number(t);
    return isFinite(n) && n >= 0 ? n : null;
  }

  function isTrue(v) {
    if (v === true) return true;
    return ['1', 'true', 'да', 'yes', 'new', 'новое', 'новинка'].indexOf(String(v === undefined || v === null ? '' : v).trim().toLowerCase()) !== -1;
  }

  function normalizeProduct(raw, i) {
    var name = String(raw && raw.name !== undefined ? raw.name : '').trim();
    if (!name) return null;
    var id = String(raw.id !== undefined && String(raw.id).trim() !== '' ? raw.id : 'p' + (i + 1)).trim();
    return {
      id: id,
      name: name,
      sub: String(raw.sub || '').trim(),
      category: normalizeCategory(raw.category),
      price: parsePrice(raw.price),
      status: normalizeStatus(raw.status),
      isNew: isTrue(raw.new !== undefined ? raw.new : raw.isnew)
    };
  }

  function normalizeAll(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (raw, i) {
      var p = normalizeProduct(raw, i);
      if (!p || seen[p.id]) return;
      seen[p.id] = true;
      out.push(p);
    });
    return out;
  }

  function formatPrice(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';
  }

  function pluralPositions(n) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return n + ' позиция';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return n + ' позиции';
    return n + ' позиций';
  }

  // cart: { id: qty }. Считаем только позиции, которые ещё есть в каталоге и имеют цену.
  function calcTotal(cart, products) {
    var byId = {}, positions = 0, units = 0, total = 0;
    products.forEach(function (p) { byId[p.id] = p; });
    Object.keys(cart || {}).forEach(function (id) {
      var q = Math.floor(Number(cart[id]));
      var p = byId[id];
      if (!p || !(q > 0)) return;
      positions += 1;
      units += q;
      if (p.price !== null) total += p.price * q;
    });
    return { positions: positions, units: units, total: total };
  }

  // watch: { id: true }. «Появилось» — позиция, за которой следили, снова не «нет в наличии».
  function watchReady(watch, products) {
    var ready = [];
    products.forEach(function (p) {
      if (watch && watch[p.id] && p.status !== 'out') ready.push(p.id);
    });
    return ready;
  }

  function filterProducts(products, f) {
    var q = String((f && f.q) || '').trim().toLowerCase();
    return products.filter(function (p) {
      if (f && f.cat && f.cat !== 'all' && p.category !== f.cat) return false;
      if (f && f.onlyNew && !p.isNew) return false;
      if (q && (p.name + ' ' + p.sub).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  function faqAnswer(question, faq, vars) {
    var q = String(question || '').trim().toLowerCase();
    if (!q) return null;
    for (var i = 0; i < (faq || []).length; i++) {
      var e = faq[i];
      for (var j = 0; j < e.keys.length; j++) {
        if (q.indexOf(String(e.keys[j]).toLowerCase()) !== -1) {
          return String(e.answer).replace(/\{(\w+)\}/g, function (m, k) {
            return vars && vars[k] !== undefined ? vars[k] : m;
          });
        }
      }
    }
    return null;
  }

  return {
    parseCSV: parseCSV, rowsToObjects: rowsToObjects, normalizeStatus: normalizeStatus,
    normalizeCategory: normalizeCategory, parsePrice: parsePrice, normalizeProduct: normalizeProduct,
    normalizeAll: normalizeAll, formatPrice: formatPrice, pluralPositions: pluralPositions,
    calcTotal: calcTotal, watchReady: watchReady, filterProducts: filterProducts, faqAnswer: faqAnswer
  };
});
