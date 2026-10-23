/* ============================================================
 * Hornetsecurity Report Viewer — UI-Schicht
 * Rendert das Dashboard aus dem PRVCore-Datenmodell.
 * Alle CSV-Inhalte werden ausschließlich per textContent in den
 * DOM geschrieben (kein innerHTML mit Fremddaten).
 * ============================================================ */
(function () {
  'use strict';

  /* ---------- DOM-Helfer ---------- */

  var $ = function (sel) { return document.querySelector(sel); };

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'style') node.style.cssText = attrs[k];
        else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), attrs[k]);
        else node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'text') node.textContent = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    return node;
  }

  /* ---------- Formatierung (de-AT: Tausenderpunkt, Dezimalkomma) ---------- */

  var nfInt = new Intl.NumberFormat('de-AT');
  function fmtInt(n) { return n === null || n === undefined ? '–' : nfInt.format(n); }
  function fmtPct(x, digits) {
    if (x === null || x === undefined || !isFinite(x)) return '–';
    digits = digits === undefined ? 1 : digits;
    return (x * 100).toLocaleString('de-AT', { minimumFractionDigits: digits, maximumFractionDigits: digits }) + ' %';
  }
  function fmtDec(x, digits) {
    if (x === null || x === undefined || !isFinite(x)) return '–';
    return x.toLocaleString('de-AT', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  function fmtDate(d) {
    return d ? d.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–';
  }
  function monthShort(d) {
    return d.toLocaleDateString('de-AT', { month: 'short' }) + ' ' + String(d.getFullYear()).slice(2);
  }
  function monthLong(key) {
    var p = key.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, 1);
    return d.toLocaleDateString('de-AT', { month: 'long', year: 'numeric' });
  }

  /* ---------- Zustand ---------- */

  var currentModel = null;
  var currentMeta = null;
  var CHARTS = []; /* Render-Funktionen für Resize-Neuzeichnung */

  /* ---------- Theme ---------- */

  var THEME_KEY = 'prv-theme';
  var THEME_ORDER = ['auto', 'light', 'dark'];
  var THEME_LABEL = { auto: 'Auto', light: 'Hell', dark: 'Dunkel' };

  function applyTheme(mode) {
    if (mode === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = mode;
    var btn = $('#btn-theme');
    btn.textContent = THEME_LABEL[mode];
    btn.setAttribute('aria-label', 'Farbschema umschalten — aktuell: ' + THEME_LABEL[mode]);
  }
  function initTheme() {
    var saved = 'auto';
    try { saved = localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) { /* egal */ }
    if (THEME_ORDER.indexOf(saved) < 0) saved = 'auto';
    applyTheme(saved);
    $('#btn-theme').addEventListener('click', function () {
      var cur = document.documentElement.dataset.theme || 'auto';
      var next = THEME_ORDER[(THEME_ORDER.indexOf(cur) + 1) % THEME_ORDER.length];
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* egal */ }
    });
  }

  /* ---------- Tooltip ---------- */

  var tooltipEl = null;
  function ttShow(rows, cx, cy) {
    tooltipEl.textContent = '';
    rows.forEach(function (r) {
      if (r.header) {
        tooltipEl.appendChild(el('div', { class: 'tt-title', text: r.header }));
      } else {
        var row = el('div', { class: 'tt-row' });
        if (r.swatch) row.appendChild(el('span', { class: 'tt-key', style: 'background:' + r.swatch }));
        row.appendChild(el('span', { class: 'tt-val', text: r.value }));
        row.appendChild(el('span', { class: 'tt-label', text: r.label }));
        tooltipEl.appendChild(row);
      }
    });
    tooltipEl.hidden = false;
    var rect = tooltipEl.getBoundingClientRect();
    var x = Math.min(cx + 14, window.innerWidth - rect.width - 8);
    var y = Math.min(cy + 14, window.innerHeight - rect.height - 8);
    tooltipEl.style.left = Math.max(4, x) + 'px';
    tooltipEl.style.top = Math.max(4, y) + 'px';
  }
  function ttHide() { if (tooltipEl) tooltipEl.hidden = true; }

  function attachTooltip(target, getRows) {
    function move(e) { ttShow(getRows(), e.clientX, e.clientY); }
    target.addEventListener('pointerenter', move);
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerleave', ttHide);
    target.addEventListener('focus', function () {
      var r = target.getBoundingClientRect();
      ttShow(getRows(), r.left + r.width / 2, r.top);
    });
    target.addEventListener('blur', ttHide);
  }

  /* ---------- Monats-Verlauf (localStorage) ---------- */

  var HISTORY_KEY = 'prv-history-v1';

  function loadHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      var h = raw ? JSON.parse(raw) : {};
      if (!h || typeof h !== 'object' || Array.isArray(h)) return {};
      /* Defekte Einträge überspringen — ein korrupter Verlauf darf das Laden nie blockieren */
      var clean = {};
      Object.keys(h).forEach(function (k) {
        var e = h[k];
        if (e && typeof e === 'object' && !Array.isArray(e)) clean[k] = e;
      });
      return clean;
    } catch (e) { return {}; }
  }
  function saveHistory(h) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch (e) { /* Speicher voll/blockiert — Verlauf ist optional */ }
  }
  function historyUpsert(model) {
    if (!model.reportDate) return null;
    var d = model.reportDate;
    var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    var h = loadHistory();
    h[key] = {
      date: d.toISOString(),
      esi: model.kpi.esi,
      sent: model.kpi.sent,
      reported: model.kpi.reported,
      successful: model.kpi.successful,
      reportRate: model.kpi.reportRate,
      successRate: model.kpi.successRate,
      trainingRate: model.training.completionRate
    };
    saveHistory(h);
    return key;
  }
  function historyEntries() {
    var h = loadHistory();
    return Object.keys(h).sort().map(function (k) {
      return Object.assign({ key: k }, h[k]);
    });
  }
  function prevEntry(key) {
    var prior = historyEntries().filter(function (e) { return e.key < key; });
    return prior.length ? prior[prior.length - 1] : null;
  }

  /* ---------- Diagramm-Bausteine ---------- */

  function niceTicks(maxVal, targetCount) {
    if (maxVal <= 0) maxVal = 1;
    var rough = maxVal / targetCount;
    var mag = Math.pow(10, Math.floor(Math.log10(rough)));
    var norm = rough / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    var top = Math.ceil(maxVal / step) * step;
    var values = [];
    for (var v = 0; v <= top + step / 2; v += step) values.push(v);
    return { max: top, values: values };
  }

  function roundedTopRect(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, h, w / 2));
    var d = 'M' + x + ',' + (y + h) +
      ' L' + x + ',' + (y + r) +
      ' Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
      ' L' + (x + w - r) + ',' + y +
      ' Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) +
      ' L' + (x + w) + ',' + (y + h) + ' Z';
    return svgEl('path', { d: d });
  }

  function legend(series) {
    var lg = el('div', { class: 'legend' });
    series.forEach(function (s) {
      lg.appendChild(el('span', { class: 'legend-item' },
        el('span', { class: 'legend-swatch', style: 'background:' + s.color }),
        s.label));
    });
    return lg;
  }

  /* Gruppierte Säulen (Kategorien × Serien) mit Gitter, Tooltip je Kategorie, Tabellen-Zwilling */
  function groupedColumnChart(opts) {
    var wrap = el('div', { class: 'chart-wrap' });
    function render() {
      ttHide();
      wrap.textContent = '';
      var width = Math.max(300, wrap.clientWidth || 520);
      var height = 235;
      var allVals = [];
      opts.series.forEach(function (s) { allVals = allVals.concat(s.values); });
      var ticks = niceTicks(Math.max.apply(null, allVals.concat([1])), 4);
      var yMax = ticks.max;
      /* padL an der breitesten Tick-Beschriftung ausrichten (z.B. "10.000") */
      var maxTickChars = Math.max.apply(null, ticks.values.map(function (v) { return nfInt.format(v).length; }));
      var padL = 14 + maxTickChars * 6.5, padR = 6, padT = 10, padB = 26;
      var plotW = width - padL - padR, plotH = height - padT - padB;

      var svg = svgEl('svg', { viewBox: '0 0 ' + width + ' ' + height, width: width, height: height, role: 'img', 'aria-label': opts.ariaLabel || '' });

      ticks.values.forEach(function (v) {
        var y = padT + plotH * (1 - v / yMax);
        var line = svgEl('line', { x1: padL, x2: width - padR, y1: y, y2: y });
        line.style.stroke = v === 0 ? 'var(--axis)' : 'var(--grid)';
        line.style.strokeWidth = '1';
        svg.appendChild(line);
        var label = svgEl('text', { x: padL - 6, y: y + 3.5, 'text-anchor': 'end', 'font-size': '11', text: nfInt.format(v) });
        label.style.fill = 'var(--ink-2)';
        svg.appendChild(label);
      });

      var n = opts.categories.length;
      var m = opts.series.length;
      var catW = plotW / n;
      var barW = Math.min(24, Math.max(6, (catW * 0.68 - (m - 1) * 2) / m));
      var groupW = m * barW + (m - 1) * 2;

      opts.categories.forEach(function (cat, ci) {
        var cx = padL + catW * ci + catW / 2;
        var x = cx - groupW / 2;
        opts.series.forEach(function (s) {
          var v = s.values[ci];
          var h = yMax > 0 ? plotH * v / yMax : 0;
          if (h > 0) {
            var bar = roundedTopRect(x, padT + plotH - h, barW, h, 4);
            bar.style.fill = s.color;
            svg.appendChild(bar);
          }
          x += barW + 2;
        });
        var catLabel = svgEl('text', { x: cx, y: height - 8, 'text-anchor': 'middle', 'font-size': '11.5', text: cat });
        catLabel.style.fill = 'var(--ink-2)';
        svg.appendChild(catLabel);
      });

      /* Hover-/Fokus-Bänder: ein Tooltip zeigt alle Serien der Kategorie */
      opts.categories.forEach(function (cat, ci) {
        var hit = svgEl('rect', {
          x: padL + catW * ci, y: padT, width: catW, height: plotH + padB,
          fill: 'transparent', tabindex: '0', role: 'img',
          'aria-label': cat + ': ' + opts.series.map(function (s) { return s.label + ' ' + s.values[ci]; }).join(', ')
        });
        hit.addEventListener('pointerenter', function () { hit.style.fill = 'var(--hover-wash)'; });
        hit.addEventListener('pointerleave', function () { hit.style.fill = 'transparent'; });
        attachTooltip(hit, function () {
          return [{ header: cat }].concat(opts.series.map(function (s) {
            return { swatch: s.color, label: s.label, value: fmtInt(s.values[ci]) };
          }));
        });
        svg.appendChild(hit);
      });

      wrap.appendChild(svg);
    }
    CHARTS.push(render);
    return wrap;
  }

  /* Einzelne Säulenreihe mit Wertbeschriftung auf der Kappe (ohne Gitter) */
  function labeledColumnChart(opts) {
    var wrap = el('div', { class: 'chart-wrap' });
    function render() {
      ttHide();
      wrap.textContent = '';
      var width = Math.max(300, wrap.clientWidth || 520);
      var height = 235;
      var padL = 8, padR = 8, padT = 26, padB = 26;
      var plotW = width - padL - padR, plotH = height - padT - padB;
      var maxV = Math.max.apply(null, opts.values.concat([1]));
      var svg = svgEl('svg', { viewBox: '0 0 ' + width + ' ' + height, width: width, height: height, role: 'img', 'aria-label': opts.ariaLabel || '' });

      var baseline = svgEl('line', { x1: padL, x2: width - padR, y1: padT + plotH, y2: padT + plotH });
      baseline.style.stroke = 'var(--axis)';
      baseline.style.strokeWidth = '1';
      svg.appendChild(baseline);

      var n = opts.categories.length;
      var catW = plotW / n;
      var barW = Math.min(24, catW * 0.5);

      opts.categories.forEach(function (cat, ci) {
        var v = opts.values[ci];
        var h = plotH * v / maxV;
        var cx = padL + catW * ci + catW / 2;
        if (h > 0) {
          var bar = roundedTopRect(cx - barW / 2, padT + plotH - h, barW, h, 4);
          bar.style.fill = opts.colors ? opts.colors[ci] : 'var(--accent)';
          svg.appendChild(bar);
        }
        var val = svgEl('text', { x: cx, y: padT + plotH - h - 6, 'text-anchor': 'middle', 'font-size': '12', 'font-weight': '600', text: nfInt.format(v) });
        val.style.fill = 'var(--ink-2)';
        svg.appendChild(val);
        var catLabel = svgEl('text', { x: cx, y: height - 8, 'text-anchor': 'middle', 'font-size': '11.5', text: cat });
        catLabel.style.fill = 'var(--ink-2)';
        svg.appendChild(catLabel);

        var hit = svgEl('rect', { x: padL + catW * ci, y: padT, width: catW, height: plotH + padB, fill: 'transparent', tabindex: '0', role: 'img', 'aria-label': cat + ': ' + v });
        hit.addEventListener('pointerenter', function () { hit.style.fill = 'var(--hover-wash)'; });
        hit.addEventListener('pointerleave', function () { hit.style.fill = 'transparent'; });
        attachTooltip(hit, function () {
          return [{ header: cat }, { label: opts.valueLabel || '', value: fmtInt(v), swatch: opts.colors ? opts.colors[ci] : 'var(--accent)' }];
        });
        svg.appendChild(hit);
      });

      wrap.appendChild(svg);
    }
    CHARTS.push(render);
    return wrap;
  }

  /* Horizontaler gestapelter Balken (Anteile) */
  function stackedBar(segments) {
    var total = segments.reduce(function (a, s) { return a + s.value; }, 0);
    var bar = el('div', { class: 'stack', role: 'img', 'aria-label': segments.map(function (s) { return s.label + ': ' + s.value; }).join(', ') });
    if (total === 0) {
      bar.appendChild(el('div', { class: 'stack-seg', style: 'flex:1;background:var(--grid)' }));
      return bar;
    }
    segments.forEach(function (s) {
      if (s.value <= 0) return;
      var frac = s.value / total;
      var seg = el('div', { class: 'stack-seg', style: 'flex:' + frac + ' 0 0;background:' + s.color, tabindex: '0', role: 'img', 'aria-label': s.label + ': ' + fmtInt(s.value) + ' (' + fmtPct(frac) + ')' });
      if (frac > 0.14) {
        seg.appendChild(el('span', { text: fmtInt(s.value), style: 'color:' + (s.ink || '#fff') }));
      }
      attachTooltip(seg, function () {
        return [{ header: s.label }, { label: 'Module (' + fmtPct(frac) + ')', value: fmtInt(s.value), swatch: s.color }];
      });
      bar.appendChild(seg);
    });
    return bar;
  }

  /* Kleines Liniendiagramm für den Monats-Verlauf */
  function lineChart(opts) {
    var wrap = el('div', { class: 'chart-wrap' });
    function render() {
      ttHide();
      wrap.textContent = '';
      var pts = opts.points;
      if (!pts.length) return;
      var width = Math.max(220, wrap.clientWidth || 260);
      var height = 110;
      /* padR an der Breite des Endwert-Labels ausrichten (z.B. "100,0 %") */
      var padR = Math.max(44, 14 + pts[pts.length - 1].display.length * 7);
      var padL = 8, padT = 12, padB = 20;
      var plotW = width - padL - padR, plotH = height - padT - padB;
      var yMax = opts.yMax !== undefined ? opts.yMax : niceTicks(Math.max.apply(null, pts.map(function (p) { return p.y; }).concat([0.001])), 3).max;
      var svg = svgEl('svg', { viewBox: '0 0 ' + width + ' ' + height, width: width, height: height, role: 'img', 'aria-label': opts.ariaLabel || '' });

      var baseline = svgEl('line', { x1: padL, x2: width - padR, y1: padT + plotH, y2: padT + plotH });
      baseline.style.stroke = 'var(--grid)';
      svg.appendChild(baseline);

      function px(i) { return pts.length === 1 ? padL + plotW / 2 : padL + plotW * i / (pts.length - 1); }
      function py(v) { return padT + plotH * (1 - (yMax > 0 ? v / yMax : 0)); }

      var d = pts.map(function (p, i) { return (i === 0 ? 'M' : 'L') + px(i).toFixed(1) + ',' + py(p.y).toFixed(1); }).join(' ');
      var path = svgEl('path', { d: d, fill: 'none', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
      path.style.stroke = 'var(--accent)';
      svg.appendChild(path);

      pts.forEach(function (p, i) {
        var dot = svgEl('circle', { cx: px(i), cy: py(p.y), r: 4 });
        dot.style.fill = 'var(--accent)';
        dot.style.stroke = 'var(--surface)';
        dot.style.strokeWidth = '2';
        svg.appendChild(dot);
        var hit = svgEl('circle', { cx: px(i), cy: py(p.y), r: 13, fill: 'transparent', tabindex: '0', role: 'img', 'aria-label': p.label + ': ' + p.display });
        attachTooltip(hit, function () {
          return [{ header: p.label }, { label: opts.valueLabel || '', value: p.display, swatch: 'var(--accent)' }];
        });
        svg.appendChild(hit);
      });

      /* Endwert-Beschriftung */
      var last = pts[pts.length - 1];
      var endLabel = svgEl('text', { x: px(pts.length - 1) + 8, y: py(last.y) + 4, 'font-size': '12', 'font-weight': '600', text: last.display });
      endLabel.style.fill = 'var(--ink-2)';
      svg.appendChild(endLabel);

      /* X-Beschriftung: erster + letzter Monat */
      var first = svgEl('text', { x: padL, y: height - 5, 'font-size': '10.5', text: pts[0].label });
      first.style.fill = 'var(--ink-2)';
      svg.appendChild(first);
      if (pts.length > 1) {
        var lastX = svgEl('text', { x: px(pts.length - 1), y: height - 5, 'text-anchor': 'end', 'font-size': '10.5', text: last.label });
        lastX.style.fill = 'var(--ink-2)';
        svg.appendChild(lastX);
      }

      wrap.appendChild(svg);
    }
    CHARTS.push(render);
    return wrap;
  }

  function meter(fraction) {
    var m = el('div', { class: 'meter' });
    var f = el('div', { class: 'meter-fill' });
    f.style.width = (fraction === null || fraction === undefined ? 0 : Math.max(0, Math.min(1, fraction)) * 100) + '%';
    m.appendChild(f);
    return m;
  }

  /* Tabellen-Zwilling für Diagramme (Barrierefreiheit) */
  function tableTwin(headers, rows) {
    var table = el('table', { class: 'data' });
    var thead = el('thead');
    var trh = el('tr');
    headers.forEach(function (h, i) { trh.appendChild(el('th', { class: (i > 0 ? 'num ' : '') + 'no-sort', scope: 'col', text: h })); });
    thead.appendChild(trh);
    table.appendChild(thead);
    var tbody = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr');
      r.forEach(function (v, i) { tr.appendChild(el('td', { class: i > 0 ? 'num' : '', text: String(v) })); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return el('details', { class: 'table-twin' }, el('summary', { text: 'Daten als Tabelle anzeigen' }), table);
  }

  /* ---------- Sortierbare, filterbare Datentabelle ---------- */

  function dataTable(cfg) {
    var root = el('div', { class: 'table-block' });
    var sortKey = cfg.defaultSort ? cfg.defaultSort.key : null;
    var sortDir = cfg.defaultSort ? cfg.defaultSort.dir : 'desc';
    var query = '';
    var filterState = {};

    var ROW_CAP = 500;
    var showAll = false;
    var searchTimer = null;

    var toolbar = el('div', { class: 'table-toolbar' });
    if (cfg.searchPlaceholder) {
      toolbar.appendChild(el('input', {
        type: 'search', placeholder: cfg.searchPlaceholder, 'aria-label': cfg.searchPlaceholder,
        oninput: function (e) {
          var v = e.target.value;
          clearTimeout(searchTimer);
          searchTimer = setTimeout(function () { query = v.trim().toLowerCase(); rebuild(); }, 150);
        }
      }));
    }
    (cfg.filters || []).forEach(function (f) {
      var sel = el('select', {
        'aria-label': f.label,
        onchange: function (e) { filterState[f.key] = e.target.value; rebuild(); }
      });
      sel.appendChild(el('option', { value: '', text: f.label + ': alle' }));
      f.options.forEach(function (o) { sel.appendChild(el('option', { value: o.value, text: o.label })); });
      toolbar.appendChild(sel);
    });
    var countEl = el('span', { class: 'table-count' });
    toolbar.appendChild(countEl);
    root.appendChild(toolbar);

    var scroller = el('div', { class: 'table-scroll' });
    root.appendChild(scroller);

    function colByKey(key) {
      return cfg.columns.find(function (c) { return c.key === key; });
    }

    function sortVal(col, row) {
      if (col.sortVal) return col.sortVal(row);
      return row[col.key];
    }

    function rebuild() {
      var rows = cfg.rows.slice();
      if (query && cfg.searchText) {
        rows = rows.filter(function (r) { return cfg.searchText(r).toLowerCase().indexOf(query) >= 0; });
      }
      (cfg.filters || []).forEach(function (f) {
        var v = filterState[f.key];
        if (v) rows = rows.filter(function (r) { return f.test(r, v); });
      });
      if (sortKey) {
        var col = colByKey(sortKey);
        if (col) {
          rows.sort(function (a, b) {
            var va = sortVal(col, a), vb = sortVal(col, b);
            var cmp;
            if (typeof va === 'number' && typeof vb === 'number') {
              var na = isFinite(va) ? va : -Infinity, nb = isFinite(vb) ? vb : -Infinity;
              cmp = na - nb;
            } else {
              cmp = String(va).localeCompare(String(vb), 'de');
            }
            if (cmp !== 0) return sortDir === 'asc' ? cmp : -cmp;
            /* Tiebreaker hat eine feste, sinnvolle Richtung — nicht mitnegieren */
            return cfg.tiebreak ? cfg.tiebreak(a, b) : 0;
          });
        }
      }

      var capped = !showAll && rows.length > ROW_CAP;
      var displayRows = capped ? rows.slice(0, ROW_CAP) : rows;
      countEl.textContent = fmtInt(rows.length) + ' von ' + fmtInt(cfg.rows.length) + ' ' + (cfg.itemName || 'Einträgen');

      /* Fokus auf sortiertem Spaltenkopf über den Neuaufbau retten */
      var focusKey = null;
      var active = document.activeElement;
      if (active && active.tagName === 'TH' && scroller.contains(active)) focusKey = active.getAttribute('data-key');

      scroller.textContent = '';
      var table = el('table', { class: 'data' });
      var thead = el('thead');
      var trh = el('tr');
      cfg.columns.forEach(function (c) {
        var th = el('th', {
          scope: 'col',
          class: c.numeric ? 'num' : '',
          'data-key': c.key,
          'aria-sort': sortKey === c.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none',
          onclick: function () {
            if (sortKey === c.key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
            else { sortKey = c.key; sortDir = c.numeric ? 'desc' : 'asc'; }
            rebuild();
          },
          onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); th.click(); } },
          tabindex: '0'
        }, c.label);
        if (sortKey === c.key) th.appendChild(el('span', { class: 'arrow', 'aria-hidden': 'true', text: sortDir === 'asc' ? ' ▲' : ' ▼' }));
        trh.appendChild(th);
      });
      thead.appendChild(trh);
      table.appendChild(thead);

      var tbody = el('tbody');
      displayRows.forEach(function (r) {
        var tr = el('tr');
        if (cfg.rowClass) {
          var cls = cfg.rowClass(r);
          if (cls) tr.className = cls;
        }
        cfg.columns.forEach(function (c) {
          var td = el('td', { class: c.numeric ? 'num' : '' });
          var content = c.render ? c.render(r) : String(r[c.key] === undefined ? '' : r[c.key]);
          if (typeof content === 'string') td.textContent = content;
          else if (content) td.appendChild(content);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      scroller.appendChild(table);

      if (capped) {
        scroller.appendChild(el('p', { class: 'row-cap-note' },
          'Aus Performance-Gründen werden nur die ersten ' + fmtInt(ROW_CAP) + ' Zeilen angezeigt. ',
          el('button', { class: 'link-btn', onclick: function () { showAll = true; rebuild(); } },
            'Alle ' + fmtInt(rows.length) + ' Zeilen anzeigen')));
      }

      if (focusKey) {
        var nth = scroller.querySelector('th[data-key="' + focusKey + '"]');
        if (nth) nth.focus();
      }
    }

    rebuild();
    return root;
  }

  /* ---------- Kleinteile ---------- */

  function levelBadge(level) {
    if (!level || level < 1 || level > 5) {
      return el('span', { class: 'badge', style: 'background:var(--grid);color:var(--ink-2)', text: '–' });
    }
    return el('span', {
      class: 'badge',
      style: 'background:var(--lvl' + level + ');color:var(--lvl' + level + '-ink)',
      text: 'Level ' + level
    });
  }

  function rateBar(fraction, color) {
    var wrap = el('div', { class: 'rate' });
    var track = el('div', { class: 'rate-track' });
    var fill = el('div', { class: 'rate-fill' });
    fill.style.background = color;
    fill.style.width = (fraction === null || fraction === undefined ? 0 : Math.max(0, Math.min(1, fraction)) * 100) + '%';
    track.appendChild(fill);
    wrap.appendChild(track);
    wrap.appendChild(el('span', { class: 'rate-num', text: fmtPct(fraction) }));
    return wrap;
  }

  function factorPills(factors) {
    var wrap = el('span');
    factors.forEach(function (f) {
      wrap.appendChild(el('span', { class: 'pill', text: PRVCore.factorLabel(f) }));
    });
    if (!factors.length) wrap.appendChild(el('span', { class: 'cell-muted', text: '–' }));
    return wrap;
  }

  function card(title, note) {
    var c = el('section', { class: 'card' });
    var head = el('div', { class: 'card-head' }, el('h3', { text: title }));
    if (note) head.appendChild(el('span', { class: 'card-note', text: note }));
    c.appendChild(head);
    return c;
  }

  /* ---------- KPI-Kacheln ---------- */

  function tile(label, valueNode, subNode) {
    var t = el('div', { class: 'tile' });
    t.appendChild(el('p', { class: 'tile-label', text: label }));
    t.appendChild(valueNode);
    if (subNode) t.appendChild(subNode);
    return t;
  }

  function statusLine(color, text) {
    var s = el('div', { class: 'tile-status' });
    s.appendChild(el('span', { class: 'status-dot', style: 'background:' + color }));
    s.appendChild(el('span', { text: text }));
    return s;
  }

  function renderKpis(model, historyKey) {
    var grid = el('section', { class: 'kpi-grid', 'aria-label': 'Kennzahlen' });
    var kpi = model.kpi;

    /* ESI */
    var esiTile = el('div', { class: 'tile' });
    esiTile.appendChild(el('p', { class: 'tile-label', text: 'Security-Index (ESI)' }));
    var esiVal = el('div', { class: 'tile-value' }, kpi.esi === null ? '–' : nfInt.format(kpi.esi), el('span', { class: 'unit', text: ' / 100' }));
    esiTile.appendChild(esiVal);
    esiTile.appendChild(meter(kpi.esi === null ? null : kpi.esi / 100));
    var prev = historyKey ? prevEntry(historyKey) : null;
    if (prev && prev.esi !== null && kpi.esi !== null) {
      var diff = kpi.esi - prev.esi;
      var cls = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
      var arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '●';
      var txt = arrow + ' ' + (diff > 0 ? '+' : '') + nfInt.format(diff) + ' ggü. ' + monthLong(prev.key);
      esiTile.appendChild(el('p', { class: 'delta ' + cls, text: txt }));
    } else {
      esiTile.appendChild(el('p', { class: 'tile-sub', text: 'Ziel: möglichst nahe an 100' }));
    }
    grid.appendChild(esiTile);

    /* Simulierte Angriffe */
    grid.appendChild(tile('Simulierte Angriffe',
      el('div', { class: 'tile-value', text: fmtInt(kpi.sent) }),
      el('p', { class: 'tile-sub', text: 'an ' + fmtInt(model.employees) + ' Mitarbeiter · Ø ' + fmtDec(model.employees > 0 ? kpi.sent / model.employees : null, 1) + ' pro Person' })
    ));

    /* Erfolgreiche Angriffe */
    var okTile = tile('Erfolgreiche Angriffe',
      el('div', { class: 'tile-value' + (kpi.successful > 0 ? ' cell-crit' : ''), text: fmtInt(kpi.successful) }),
      el('p', { class: 'tile-sub', text: 'Erfolgsquote ' + fmtPct(kpi.successRate) })
    );
    okTile.insertBefore(
      kpi.successful === 0
        ? statusLine('var(--good)', 'Keine Kompromittierung')
        : statusLine('var(--critical)', 'Handlungsbedarf'),
      okTile.lastChild
    );
    grid.appendChild(okTile);

    /* Gemeldete Angriffe */
    grid.appendChild(tile('Gemeldete Angriffe',
      el('div', { class: 'tile-value', text: fmtInt(kpi.reported) }),
      el('p', { class: 'tile-sub', text: 'Meldequote ' + fmtPct(kpi.reportRate) })
    ));

    /* Interaktionen */
    var interactions = kpi.clicked + kpi.logins + kpi.filesOpened + kpi.macros;
    grid.appendChild(tile('Riskante Interaktionen',
      el('div', { class: 'tile-value', text: fmtInt(interactions) }),
      el('p', { class: 'tile-sub', text: 'Klicks ' + fmtInt(kpi.clicked) + ' · Logins ' + fmtInt(kpi.logins) + ' · Dateien ' + fmtInt(kpi.filesOpened) + ' · Makros ' + fmtInt(kpi.macros) })
    ));

    /* E-Training */
    var tr = model.training;
    var trTile = el('div', { class: 'tile' });
    trTile.appendChild(el('p', { class: 'tile-label', text: 'E-Training abgeschlossen' }));
    trTile.appendChild(el('div', { class: 'tile-value', text: tr.completionRate === null ? '–' : fmtPct(tr.completionRate, 0) }));
    trTile.appendChild(meter(tr.completionRate));
    trTile.appendChild(el('p', { class: 'tile-sub', text: fmtInt(tr.completed) + ' von ' + fmtInt(tr.total) + ' zugewiesenen Modulen' }));
    grid.appendChild(trTile);

    return grid;
  }

  /* ---------- Karten ---------- */

  function renderLevelAttacksCard(model) {
    var c = card('Angriffe nach Mitarbeiter-Level', 'Level 1 (Einsteiger) bis 5 (Profi)');
    var series = [
      { label: 'Gesendet', color: 'var(--s-sent)', values: model.levels.map(function (l) { return l.sent; }) },
      { label: 'Gemeldet', color: 'var(--s-reported)', values: model.levels.map(function (l) { return l.reported; }) },
      { label: 'Erfolgreich', color: 'var(--s-success)', values: model.levels.map(function (l) { return l.successful; }) }
    ];
    c.appendChild(legend(series.map(function (s) { return { label: s.label, color: s.color }; })));
    c.appendChild(groupedColumnChart({
      categories: model.levels.map(function (l) { return 'Level ' + l.level; }),
      series: series,
      ariaLabel: 'Säulendiagramm: gesendete, gemeldete und erfolgreiche Angriffe je Level'
    }));
    c.appendChild(tableTwin(
      ['Level', 'Gesendet', 'Gemeldet', 'Erfolgreich'],
      model.levels.map(function (l) { return ['Level ' + l.level, fmtInt(l.sent), fmtInt(l.reported), fmtInt(l.successful)]; })
    ));
    return c;
  }

  function renderLevelEmployeesCard(model) {
    var c = card('Mitarbeiter nach Level', 'Stufe im Awareness-Programm');
    c.appendChild(labeledColumnChart({
      categories: model.levels.map(function (l) { return 'Level ' + l.level; }),
      values: model.levels.map(function (l) { return l.employees; }),
      colors: model.levels.map(function (l) { return 'var(--lvl' + l.level + ')'; }),
      valueLabel: 'Mitarbeiter',
      ariaLabel: 'Säulendiagramm: Anzahl Mitarbeiter je Level'
    }));
    c.appendChild(tableTwin(
      ['Level', 'Mitarbeiter'],
      model.levels.map(function (l) { return ['Level ' + l.level, fmtInt(l.employees)]; })
    ));
    return c;
  }

  function renderTrainingCard(model) {
    var tr = model.training;
    var c = card('E-Training-Status', fmtInt(tr.total) + ' zugewiesene Module gesamt');
    var segs = [
      { label: 'Abgeschlossen', value: tr.completed, color: 'var(--good)', ink: '#0b0b0b' },
      { label: 'Gestartet', value: tr.started, color: 'var(--warning)', ink: '#0b0b0b' },
      { label: 'Nicht gestartet', value: tr.notStarted, color: 'var(--serious)', ink: '#0b0b0b' }
    ];
    c.appendChild(stackedBar(segs));
    c.appendChild(legend(segs.map(function (s) {
      return { label: s.label + ' (' + fmtInt(s.value) + ')', color: s.color };
    })));
    c.appendChild(tableTwin(
      ['Status', 'Module'],
      segs.map(function (s) { return [s.label, fmtInt(s.value)]; })
    ));
    return c;
  }

  function renderTrendCard() {
    var entries = historyEntries();
    if (entries.length < 2) return null;
    var c = card('Monats-Verlauf', entries.length + ' Reports auf diesem Rechner gespeichert');
    var grid = el('div', { class: 'trend-grid' });

    /* Monate ohne Wert (z.B. fehlendes ESI) auslassen statt als 0 zu plotten */
    function points(fn, fmt) {
      var pts = [];
      entries.forEach(function (e) {
        var v = fn(e);
        if (v === null || v === undefined || typeof v !== 'number' || !isFinite(v)) return;
        var d = new Date(e.date);
        pts.push({ label: isNaN(d) ? String(e.key) : monthShort(d), y: v, display: fmt(v) });
      });
      return pts;
    }

    var tiles = [
      { title: 'Security-Index (ESI)', pts: points(function (e) { return e.esi; }, function (v) { return v === null ? '–' : nfInt.format(v); }), yMax: 100, valueLabel: 'ESI' },
      { title: 'Meldequote', pts: points(function (e) { return e.reportRate === null ? null : e.reportRate * 100; }, function (v) { return v === null ? '–' : fmtDec(v, 1) + ' %'; }), yMax: undefined, valueLabel: 'Meldequote' },
      { title: 'Erfolgsquote (Angriffe)', pts: points(function (e) { return e.successRate === null ? null : e.successRate * 100; }, function (v) { return v === null ? '–' : fmtDec(v, 1) + ' %'; }), yMax: undefined, valueLabel: 'Erfolgsquote' }
    ];
    tiles.forEach(function (t) {
      var tileEl = el('div', { class: 'trend-tile' });
      tileEl.appendChild(el('h4', { text: t.title }));
      if (t.pts.length >= 2) {
        tileEl.appendChild(lineChart({ points: t.pts, yMax: t.yMax, valueLabel: t.valueLabel, ariaLabel: 'Liniendiagramm: ' + t.title + ' über die Monate' }));
      } else {
        tileEl.appendChild(el('p', { class: 'card-note', text: 'Noch zu wenige Datenpunkte.' }));
      }
      grid.appendChild(tileEl);
    });
    c.appendChild(grid);

    c.appendChild(tableTwin(
      ['Monat', 'ESI', 'Meldequote', 'Erfolgsquote'],
      entries.map(function (e) {
        return [
          monthLong(String(e.key)),
          typeof e.esi === 'number' ? nfInt.format(e.esi) : '–',
          typeof e.reportRate === 'number' ? fmtPct(e.reportRate) : '–',
          typeof e.successRate === 'number' ? fmtPct(e.successRate) : '–'
        ];
      })
    ));
    return c;
  }

  function renderFactorsCard(model) {
    if (!model.factors.length) return null;
    var c = card('Psychologische Faktoren', 'Ein Szenario kann mehrere Faktoren nutzen — Summen überschneiden sich');
    var maxSent = Math.max.apply(null, model.factors.map(function (f) { return f.sent; }).concat([1]));
    c.appendChild(dataTable({
      rows: model.factors,
      itemName: 'Faktoren',
      defaultSort: { key: 'sent', dir: 'desc' },
      tiebreak: function (a, b) { return a.label.localeCompare(b.label, 'de'); },
      columns: [
        { key: 'label', label: 'Faktor' },
        { key: 'scenarios', label: 'Szenarien', numeric: true, render: function (r) { return fmtInt(r.scenarios); } },
        {
          key: 'sent', label: 'Gesendet', numeric: true,
          render: function (r) { return rateBarNum(r.sent, maxSent); }
        },
        { key: 'reported', label: 'Gemeldet', numeric: true, render: function (r) { return fmtInt(r.reported); } },
        { key: 'reportRate', label: 'Meldequote', sortVal: function (r) { return r.reportRate === null ? -1 : r.reportRate; }, render: function (r) { return rateBar(r.reportRate, 'var(--s-reported)'); } },
        {
          key: 'successful', label: 'Erfolgreich', numeric: true,
          render: function (r) { return el('span', { class: r.successful > 0 ? 'cell-crit' : '', text: fmtInt(r.successful) }); }
        }
      ]
    }));
    return c;
  }

  /* Balken + Zahl für absolute Werte (skaliert am Maximum) */
  function rateBarNum(value, max) {
    var wrap = el('div', { class: 'rate' });
    var track = el('div', { class: 'rate-track' });
    var fill = el('div', { class: 'rate-fill' });
    fill.style.background = 'var(--s-sent)';
    fill.style.width = (max > 0 ? value / max * 100 : 0) + '%';
    track.appendChild(fill);
    wrap.appendChild(track);
    wrap.appendChild(el('span', { class: 'rate-num', text: fmtInt(value) }));
    return wrap;
  }

  function renderScenariosCard(model) {
    if (!model.scenarios.length) return null;
    var c = card('Phishing-Szenarien', 'Level = Schwierigkeitsgrad des Szenarios');
    c.classList.add('card-table');

    var types = Array.from(new Set(model.scenarios.map(function (s) { return s.exploitType; }))).sort();
    var levels = Array.from(new Set(model.scenarios.map(function (s) { return s.level; }))).sort();

    var hasInteractions = model.scenarios.some(function (s) { return s.clicked + s.logins + s.filesOpened + s.macros > 0; });

    var columns = [
      { key: 'description', label: 'Szenario', render: function (r) { return el('span', { text: r.description, title: '#' + r.id }); } },
      { key: 'exploitType', label: 'Typ', render: function (r) { return PRVCore.exploitLabel(r.exploitType); } },
      { key: 'level', label: 'Level', numeric: true, render: function (r) { return levelBadge(r.level); } },
      { key: 'factors', label: 'Faktoren', sortVal: function (r) { return r.factors.length; }, render: function (r) { return factorPills(r.factors); } },
      { key: 'sent', label: 'Gesendet', numeric: true, render: function (r) { return fmtInt(r.sent); } },
      { key: 'reported', label: 'Gemeldet', numeric: true, render: function (r) { return fmtInt(r.reported); } },
      { key: 'reportRate', label: 'Meldequote', sortVal: function (r) { return r.reportRate; }, render: function (r) { return rateBar(r.reportRate, 'var(--s-reported)'); } },
      {
        key: 'successful', label: 'Erfolgreich', numeric: true,
        render: function (r) { return el('span', { class: r.successful > 0 ? 'cell-crit' : '', text: fmtInt(r.successful) }); }
      }
    ];
    if (hasInteractions) {
      columns.splice(7, 0, {
        key: 'interactions', label: 'Interaktionen', numeric: true,
        sortVal: function (r) { return r.clicked + r.logins + r.filesOpened + r.macros; },
        render: function (r) {
          var total = r.clicked + r.logins + r.filesOpened + r.macros;
          var detail = 'Klicks ' + r.clicked + ' · Logins ' + r.logins + ' · Dateien ' + r.filesOpened + ' · Makros ' + r.macros;
          var span = el('span', { title: detail, text: fmtInt(total) });
          if (total > 0) {
            span.setAttribute('tabindex', '0');
            span.setAttribute('aria-label', fmtInt(total) + ' Interaktionen: ' + detail);
            attachTooltip(span, function () {
              return [{ header: 'Interaktionen' },
                { label: 'Klicks', value: fmtInt(r.clicked) },
                { label: 'Logins', value: fmtInt(r.logins) },
                { label: 'Dateien geöffnet', value: fmtInt(r.filesOpened) },
                { label: 'Makros ausgeführt', value: fmtInt(r.macros) }];
            });
          }
          return span;
        }
      });
    }

    c.appendChild(dataTable({
      rows: model.scenarios,
      itemName: 'Szenarien',
      searchPlaceholder: 'Szenario suchen …',
      searchText: function (r) { return r.description + ' ' + PRVCore.exploitLabel(r.exploitType) + ' ' + r.factors.map(PRVCore.factorLabel).join(' '); },
      filters: [
        { key: 'type', label: 'Typ', options: types.map(function (t) { return { value: t, label: PRVCore.exploitLabel(t) }; }), test: function (r, v) { return r.exploitType === v; } },
        { key: 'level', label: 'Level', options: levels.map(function (l) { return { value: String(l), label: 'Level ' + l }; }), test: function (r, v) { return String(r.level) === v; } }
      ],
      defaultSort: { key: 'successful', dir: 'desc' },
      tiebreak: function (a, b) { return b.sent - a.sent || a.description.localeCompare(b.description, 'de'); },
      rowClass: function (r) { return r.successful > 0 ? 'row-crit' : ''; },
      columns: columns
    }));
    return c;
  }

  function renderUsersCard(model) {
    if (!model.users.length) return null;
    var c = card('Mitarbeiter-Übersicht', 'Level = Stufe im Awareness-Programm');
    c.classList.add('card-table');

    var levels = Array.from(new Set(model.users.map(function (u) { return u.level; }))).sort();

    function successTitle(u) {
      if (!u.successfulScenarios.length) return '';
      return 'Erfolgreiche Szenarien: ' + u.successfulScenarios.map(function (id) {
        var s = model.scenarioById.get(String(id));
        return s ? s.description : '#' + id;
      }).join(' · ');
    }

    c.appendChild(dataTable({
      rows: model.users,
      itemName: 'Mitarbeitern',
      searchPlaceholder: 'E-Mail suchen …',
      searchText: function (r) { return r.email; },
      filters: [
        { key: 'level', label: 'Level', options: levels.map(function (l) { return { value: String(l), label: 'Level ' + l }; }), test: function (r, v) { return String(r.level) === v; } }
      ],
      defaultSort: { key: 'successful', dir: 'desc' },
      tiebreak: function (a, b) { return b.reported - a.reported || a.email.localeCompare(b.email, 'de'); },
      rowClass: function (r) { return r.successful > 0 ? 'row-crit' : ''; },
      columns: [
        { key: 'email', label: 'E-Mail' },
        { key: 'level', label: 'Level', numeric: true, render: function (r) { return levelBadge(r.level); } },
        { key: 'sent', label: 'Gesendet', numeric: true, render: function (r) { return fmtInt(r.sent); } },
        { key: 'reported', label: 'Gemeldet', numeric: true, render: function (r) { return fmtInt(r.reported); } },
        {
          key: 'reportRate', label: 'Meldequote',
          sortVal: function (r) { return r.sent > 0 ? r.reported / r.sent : -1; },
          render: function (r) { return rateBar(r.sent > 0 ? r.reported / r.sent : null, 'var(--s-reported)'); }
        },
        {
          key: 'successful', label: 'Erfolgreich', numeric: true,
          render: function (r) {
            var t = successTitle(r);
            var span = el('span', { class: r.successful > 0 ? 'cell-crit' : '', title: t, text: fmtInt(r.successful) });
            if (r.successfulScenarios.length) {
              span.setAttribute('tabindex', '0');
              span.setAttribute('aria-label', fmtInt(r.successful) + ' erfolgreiche Angriffe. ' + t);
              attachTooltip(span, function () {
                return [{ header: 'Erfolgreiche Szenarien' }].concat(r.successfulScenarios.map(function (id) {
                  var s = model.scenarioById.get(String(id));
                  return { label: s ? s.description : '#' + id, value: '' };
                }));
              });
            }
            return span;
          }
        },
        {
          key: 'training', label: 'E-Training',
          sortVal: function (r) {
            var total = r.trainingsCompleted + r.trainingsStarted + r.trainingsNotStarted;
            return total > 0 ? r.trainingsCompleted / total : -1;
          },
          render: function (r) {
            var total = r.trainingsCompleted + r.trainingsStarted + r.trainingsNotStarted;
            var detail = 'Abgeschlossen ' + r.trainingsCompleted + ' · Gestartet ' + r.trainingsStarted + ' · Nicht gestartet ' + r.trainingsNotStarted;
            var wrap = el('div', { class: 'train-cell', title: detail, tabindex: '0', 'aria-label': 'E-Training: ' + detail });
            attachTooltip(wrap, function () {
              return [{ header: 'E-Training' },
                { label: 'Abgeschlossen', value: fmtInt(r.trainingsCompleted), swatch: 'var(--good)' },
                { label: 'Gestartet', value: fmtInt(r.trainingsStarted), swatch: 'var(--warning)' },
                { label: 'Nicht gestartet', value: fmtInt(r.trainingsNotStarted), swatch: 'var(--serious)' }];
            });
            var mini = el('div', { class: 'mini-stack' });
            [[r.trainingsCompleted, 'var(--good)'], [r.trainingsStarted, 'var(--warning)'], [r.trainingsNotStarted, 'var(--serious)']].forEach(function (seg) {
              if (seg[0] > 0 && total > 0) {
                var i = el('i');
                i.style.flex = String(seg[0] / total);
                i.style.background = seg[1];
                mini.appendChild(i);
              }
            });
            if (total === 0) { var g = el('i'); g.style.flex = '1'; g.style.background = 'var(--grid)'; mini.appendChild(g); }
            wrap.appendChild(mini);
            wrap.appendChild(el('span', { class: 'rate-num', text: total > 0 ? fmtPct(r.trainingsCompleted / total, 0) : '–' }));
            return wrap;
          }
        }
      ]
    }));
    return c;
  }

  function renderGroupsCard(model) {
    if (model.groups.length < 2) return null;
    var c = card('Gruppen');
    c.classList.add('card-table');
    c.appendChild(dataTable({
      rows: model.groups,
      itemName: 'Gruppen',
      defaultSort: { key: 'size', dir: 'desc' },
      columns: [
        { key: 'name', label: 'Gruppe' },
        { key: 'size', label: 'Mitarbeiter', numeric: true, render: function (r) { return fmtInt(r.size); } },
        { key: 'esi', label: 'ESI', numeric: true, sortVal: function (r) { return r.esi === null ? -1 : r.esi; }, render: function (r) { return r.esi === null ? '–' : fmtInt(r.esi); } },
        { key: 'sent', label: 'Gesendet', numeric: true, render: function (r) { return fmtInt(r.sent); } },
        { key: 'reported', label: 'Gemeldet', numeric: true, render: function (r) { return fmtInt(r.reported); } },
        {
          key: 'reportRate', label: 'Meldequote',
          sortVal: function (r) { return r.sent > 0 ? r.reported / r.sent : -1; },
          render: function (r) { return rateBar(r.sent > 0 ? r.reported / r.sent : null, 'var(--s-reported)'); }
        },
        {
          key: 'successful', label: 'Erfolgreich', numeric: true,
          render: function (r) { return el('span', { class: r.successful > 0 ? 'cell-crit' : '', text: fmtInt(r.successful) }); }
        }
      ]
    }));
    return c;
  }

  /* ---------- Report zusammensetzen ---------- */

  function renderReport(model, meta) {
    currentModel = model;
    currentMeta = meta;
    var historyKey = historyUpsert(model);

    $('#drop-view').hidden = true;
    $('#report-view').hidden = false;
    $('#header-actions').hidden = false;
    $('#error-panel').hidden = true;
    $('#btn-clear-history').hidden = historyEntries().length === 0;

    var subtitleParts = [];
    if (model.reportDate) subtitleParts.push('Datenstand: ' + fmtDate(model.reportDate));
    if (meta && meta.fileName) subtitleParts.push(meta.fileName);
    subtitleParts.push(fmtInt(model.employees) + ' Mitarbeiter');
    if (model.groups.length) subtitleParts.push(fmtInt(model.groups.length) + (model.groups.length === 1 ? ' Gruppe' : ' Gruppen'));
    $('#report-subtitle').textContent = subtitleParts.join(' · ');
    if (model.reportDate) {
      document.title = 'Phishing-Report ' + fmtDate(model.reportDate);
    }

    var warnBox = $('#report-warnings');
    warnBox.textContent = '';
    model.missing.forEach(function (m) {
      warnBox.appendChild(el('span', { class: 'warn-badge', text: '⚠ Datei fehlt: ' + m }));
    });
    model.warnings.forEach(function (w) {
      warnBox.appendChild(el('span', { class: 'warn-badge', text: '⚠ ' + w }));
    });
    if (model.duplicates && model.duplicates.length) {
      warnBox.appendChild(el('span', { class: 'warn-badge', text: '⚠ doppelt vorhanden, ignoriert: ' + model.duplicates.join(', ') }));
    }
    if (model.unknown.length) {
      warnBox.appendChild(el('span', { class: 'warn-badge', text: 'ℹ ignoriert: ' + model.unknown.join(', ') }));
    }

    CHARTS.length = 0;
    var content = $('#report-content');
    content.textContent = '';

    content.appendChild(renderKpis(model, historyKey));

    var grid = el('div', { class: 'cards-grid' });
    grid.appendChild(renderLevelAttacksCard(model));
    grid.appendChild(renderLevelEmployeesCard(model));
    grid.appendChild(renderTrainingCard(model));
    var trend = renderTrendCard();
    if (trend) grid.appendChild(trend);
    content.appendChild(grid);

    [renderFactorsCard(model), renderScenariosCard(model), renderUsersCard(model), renderGroupsCard(model)].forEach(function (cardEl) {
      if (cardEl) content.appendChild(cardEl);
    });

    window.scrollTo(0, 0);
    /* setTimeout statt requestAnimationFrame: rAF feuert in versteckten Tabs nicht */
    setTimeout(function () { CHARTS.forEach(function (r) { r(); }); }, 0);
  }

  /* Resize: Diagramme neu zeichnen */
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { CHARTS.forEach(function (r) { r(); }); }, 150);
  });

  /* ---------- Datei-Verarbeitung ---------- */

  function showError(err) {
    console.error(err);
    var panel = $('#error-panel');
    panel.textContent = 'Der Report konnte nicht geladen werden.\n' + (err && err.message ? err.message : String(err));
    panel.hidden = false;
    $('#drop-view').hidden = false;
    $('#report-view').hidden = true;
    $('#back-link').hidden = !currentModel;
  }

  async function handleFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    try {
      var raw = [];
      var zips = files.filter(function (f) { return /\.zip$/i.test(f.name); });
      var csvs = files.filter(function (f) { return /\.csv$/i.test(f.name); });
      var fileName;
      if (zips.length) {
        var buf = await zips[0].arrayBuffer();
        raw = await PRVCore.unzip(buf);
        fileName = zips[0].name;
      } else if (csvs.length) {
        raw = await Promise.all(csvs.map(async function (f) {
          return { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()), date: f.lastModified ? new Date(f.lastModified) : null };
        }));
        fileName = csvs.length + ' CSV-Dateien';
      } else {
        throw new Error('Bitte eine ZIP-Datei oder die CSV-Dateien des Reports ablegen (erhalten: ' + files.map(function (f) { return f.name; }).join(', ') + ').');
      }

      var ident = PRVCore.identifyFiles(raw.map(function (r) {
        return { name: r.name, text: PRVCore.decodeText(r.bytes), date: r.date };
      }));

      if (Object.keys(ident.found).length === 0) {
        throw new Error('Keine der erwarteten CSV-Dateien gefunden (company_statistics, group_statistics, user_statistics, phishing_scenario_statistics).\nEnthalten war: ' + raw.map(function (r) { return r.name; }).join(', '));
      }

      var model = PRVCore.buildModel({
        company: ident.found.company,
        groups: ident.found.groups,
        users: ident.found.users,
        scenarios: ident.found.scenarios,
        reportDate: ident.newestDate,
        missing: ident.missing,
        unknown: ident.unknown,
        duplicates: ident.duplicates
      });

      renderReport(model, { fileName: fileName });
    } catch (err) {
      showError(err);
    }
  }

  /* ---------- Drag & Drop, Dateiauswahl ---------- */

  function initDropzone() {
    var dz = $('#dropzone');
    var input = $('#file-input');
    var overlay = $('#drop-overlay');
    var dragDepth = 0;

    dz.addEventListener('click', function () { input.click(); });
    dz.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    input.addEventListener('change', function () {
      handleFiles(input.files);
      input.value = '';
    });

    /* Nur auf Datei-Drags reagieren — Text-/Element-Drags (z.B. markierter
     * Tabellentext ins Suchfeld) dürfen weder Overlay noch preventDefault auslösen. */
    function hasFiles(e) {
      return !!(e.dataTransfer && e.dataTransfer.types &&
        Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0);
    }

    window.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('dragenter', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      document.body.classList.add('dragging');
      if (!$('#report-view').hidden) overlay.hidden = false;
    });
    window.addEventListener('dragleave', function (e) {
      if (!hasFiles(e)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        document.body.classList.remove('dragging');
        overlay.hidden = true;
      }
    });
    window.addEventListener('drop', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      document.body.classList.remove('dragging');
      overlay.hidden = true;
      if (e.dataTransfer.files && e.dataTransfer.files.length) {
        handleFiles(e.dataTransfer.files);
      }
    });
  }

  function initButtons() {
    $('#btn-new').addEventListener('click', function () {
      $('#report-view').hidden = true;
      $('#drop-view').hidden = false;
      $('#error-panel').hidden = true;
      $('#back-link').hidden = !currentModel;
    });
    $('#btn-back').addEventListener('click', function () {
      if (!currentModel) return;
      $('#drop-view').hidden = true;
      $('#report-view').hidden = false;
      setTimeout(function () { CHARTS.forEach(function (r) { r(); }); }, 0);
    });
    $('#btn-print').addEventListener('click', function () { window.print(); });
    $('#btn-clear-history').addEventListener('click', function () {
      if (confirm('Gespeicherten Monats-Verlauf wirklich löschen? Der aktuell angezeigte Report bleibt erhalten.')) {
        try { localStorage.removeItem(HISTORY_KEY); } catch (e) { /* egal */ }
        if (currentModel) renderReport(currentModel, currentMeta);
      }
    });
  }

  /* ---------- Start ---------- */

  document.addEventListener('DOMContentLoaded', function () {
    tooltipEl = $('#tooltip');
    initTheme();
    initDropzone();
    initButtons();
    $('#btn-clear-history').hidden = historyEntries().length === 0;
    /* WCAG 1.4.13: Tooltip per Escape schließbar */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') ttHide();
    });
  });

  /* Test-Hook für automatisierte Prüfungen */
  window.PRV = {
    version: '__VERSION__',
    core: typeof PRVCore !== 'undefined' ? PRVCore : null,
    loadFile: function (file) { return handleFiles([file]); },
    state: function () { return currentModel; },
    historyEntries: historyEntries
  };
})();
