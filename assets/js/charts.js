/* Bağımlılıksız SVG grafik motoru: çizgi, halka, çubuk ve ısı haritası.

   Grafikler kapsayıcının genişliğine göre yeniden çizilir; renkler CSS
   değişkenlerinden geldiği için tema değişince otomatik uyum sağlar. */

import { h, isNum, onResize, fmtDateShort, colorAt } from './util.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    el.setAttribute(k, v);
  }
  return el;
}

/** Okunabilir eksen adımları üretir (1, 2, 2.5, 5, 10 katları). */
function niceTicks(min, max, count = 5) {
  if (!isNum(min) || !isNum(max)) return [];
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const first = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = first; v <= max + step * 0.001; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

/* --------------------------------------------------------------- çizgi grafik */

/**
 * @param {HTMLElement} container
 * @param {object} cfg
 *   dates: string[]  - x ekseni (ISO)
 *   series: [{ name, values:number[], color, dashed, fill }]
 *   height: px, yFormat: (v)=>string, valueFormat: (v)=>string
 *   baseline: y ekseninde vurgulanacak değer (örn. 100 veya 0)
 */
export function lineChart(container, cfg) {
  const draw = () => renderLine(container, cfg);
  container.classList.add('chart');
  draw();
  onResize(container, draw);
  return draw;
}

function renderLine(container, cfg) {
  const {
    dates = [], series = [], height = 260, yFormat = (v) => String(Math.round(v)),
    valueFormat, baseline = null, legend = true,
  } = cfg;

  const width = Math.max(container.clientWidth || 640, 260);
  const pad = { top: 12, right: 12, bottom: 26, left: 58 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const active = series.filter((s) => s.values?.some(isNum));
  container.replaceChildren();
  if (!dates.length || !active.length) {
    container.append(h('p', { class: 'dim', style: 'padding:24px 0;text-align:center' },
      'Grafik için yeterli veri yok.'));
    return;
  }

  let min = Infinity, max = -Infinity;
  for (const s of active) {
    for (const v of s.values) {
      if (!isNum(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (isNum(baseline)) { min = Math.min(min, baseline); max = Math.max(max, baseline); }
  if (min === max) { min -= 1; max += 1; }
  const padY = (max - min) * 0.06;
  min -= padY; max += padY;

  const n = dates.length;
  const x = (i) => pad.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v) => pad.top + plotH - ((v - min) / (max - min)) * plotH;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`, width: '100%', height,
    preserveAspectRatio: 'none', role: 'img',
  });

  // Yatay ızgara + y etiketleri
  for (const tick of niceTicks(min, max, 5)) {
    const yy = y(tick);
    svg.append(svgEl('line', {
      x1: pad.left, x2: width - pad.right, y1: yy, y2: yy,
      stroke: 'var(--border)', 'stroke-width': 1,
    }));
    const label = svgEl('text', {
      x: pad.left - 8, y: yy + 4, 'text-anchor': 'end',
      fill: 'var(--text-dim)', 'font-size': 11,
    });
    label.textContent = yFormat(tick);
    svg.append(label);
  }

  if (isNum(baseline)) {
    svg.append(svgEl('line', {
      x1: pad.left, x2: width - pad.right, y1: y(baseline), y2: y(baseline),
      stroke: 'var(--text-dim)', 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: .7,
    }));
  }

  // x etiketleri
  const labelCount = Math.max(2, Math.min(6, Math.floor(plotW / 90)));
  for (let k = 0; k < labelCount; k++) {
    const i = Math.round((k / (labelCount - 1)) * (n - 1));
    const t = svgEl('text', {
      x: x(i), y: height - 7,
      'text-anchor': k === 0 ? 'start' : k === labelCount - 1 ? 'end' : 'middle',
      fill: 'var(--text-dim)', 'font-size': 11,
    });
    t.textContent = fmtDateShort(dates[i]);
    svg.append(t);
  }

  // Seriler
  active.forEach((s) => {
    let d = '', open = false;
    const pts = [];
    s.values.forEach((v, i) => {
      if (!isNum(v)) { open = false; return; }
      const px = x(i), py = y(v);
      d += `${open ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`;
      pts.push([px, py]);
      open = true;
    });
    if (s.fill && pts.length > 1) {
      const area = `${d}L${pts[pts.length - 1][0].toFixed(1)} ${(pad.top + plotH).toFixed(1)}`
        + `L${pts[0][0].toFixed(1)} ${(pad.top + plotH).toFixed(1)}Z`;
      svg.append(svgEl('path', { d: area, fill: s.color, opacity: .1 }));
    }
    svg.append(svgEl('path', {
      d, fill: 'none', stroke: s.color, 'stroke-width': s.width || 2,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      'stroke-dasharray': s.dashed ? '5 4' : null,
    }));
  });

  // İmleç
  const cursor = svgEl('line', {
    y1: pad.top, y2: pad.top + plotH, stroke: 'var(--text-dim)',
    'stroke-width': 1, opacity: 0,
  });
  svg.append(cursor);
  const dots = active.map((s) => {
    const c = svgEl('circle', { r: 3.5, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 1.5, opacity: 0 });
    svg.append(c);
    return c;
  });

  container.append(svg);
  const tip = h('div', { class: 'tooltip', style: 'opacity:0' });
  container.append(tip);

  const fmtVal = valueFormat || yFormat;
  const move = (evt) => {
    const rect = svg.getBoundingClientRect();
    const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
    const rel = ((clientX - rect.left) / rect.width) * width;
    let i = Math.round(((rel - pad.left) / plotW) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    const px = x(i);
    cursor.setAttribute('x1', px);
    cursor.setAttribute('x2', px);
    cursor.setAttribute('opacity', .45);

    const rows = [];
    active.forEach((s, k) => {
      const v = s.values[i];
      if (isNum(v)) {
        dots[k].setAttribute('cx', px);
        dots[k].setAttribute('cy', y(v));
        dots[k].setAttribute('opacity', 1);
        rows.push(`<div class="t-row"><span><span class="sw" style="background:${s.color}"></span>${s.name}</span><b>${fmtVal(v, s)}</b></div>`);
      } else {
        dots[k].setAttribute('opacity', 0);
      }
    });
    tip.innerHTML = `<div class="t-date">${fmtDateShort(dates[i])} ${dates[i].slice(0, 4)}</div>${rows.join('')}`;
    tip.style.opacity = 1;
    const leftPx = (px / width) * rect.width;
    tip.style.left = `${Math.max(70, Math.min(rect.width - 70, leftPx))}px`;
    tip.style.top = `${Math.max(46, pad.top + plotH * 0.35)}px`;
  };
  const leave = () => {
    cursor.setAttribute('opacity', 0);
    dots.forEach((d) => d.setAttribute('opacity', 0));
    tip.style.opacity = 0;
  };
  svg.addEventListener('mousemove', move);
  svg.addEventListener('mouseleave', leave);
  svg.addEventListener('touchstart', move, { passive: true });
  svg.addEventListener('touchmove', move, { passive: true });
  svg.addEventListener('touchend', leave);

  if (legend && active.length > 1) {
    container.append(h('div', { class: 'chart-legend' },
      active.map((s) => h('span', { class: 'item' },
        h('span', { class: 'swatch', style: `background:${s.color}` }),
        s.name))));
  }
}

/* ---------------------------------------------------------------- halka grafik */

/**
 * @param {object} cfg items:[{label, value, color}], centerTop, centerBottom
 */
export function donutChart(container, cfg) {
  const draw = () => renderDonut(container, cfg);
  container.classList.add('chart');
  draw();
  onResize(container, draw);
  return draw;
}

function renderDonut(container, cfg) {
  const { items = [], size = 200, thickness = 26, centerTop, centerBottom } = cfg;
  container.replaceChildren();
  const data = items.filter((it) => isNum(it.value) && it.value > 0);
  const total = data.reduce((s, it) => s + it.value, 0);
  if (!data.length || total <= 0) {
    container.append(h('p', { class: 'dim', style: 'padding:20px 0;text-align:center' }, 'Veri yok.'));
    return;
  }

  const r = size / 2 - thickness / 2 - 2;
  const cx = size / 2, cy = size / 2;
  const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, width: '100%', height: 'auto' });

  let angle = -Math.PI / 2;
  data.forEach((it) => {
    const sweep = (it.value / total) * Math.PI * 2;
    const end = angle + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
    // Tam daire tek yayla çizilemez; iki yarıya böl.
    const path = sweep >= Math.PI * 2 - 1e-6
      ? `M${cx - r} ${cy}A${r} ${r} 0 1 1 ${cx + r} ${cy}A${r} ${r} 0 1 1 ${cx - r} ${cy}`
      : `M${x1} ${y1}A${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
    const arc = svgEl('path', {
      d: path, fill: 'none', stroke: it.color, 'stroke-width': thickness,
    });
    const title = svgEl('title');
    title.textContent = `${it.label}: ${((it.value / total) * 100).toFixed(1)}%`;
    arc.append(title);
    svg.append(arc);
    angle = end;
  });

  if (centerTop != null) {
    const t = svgEl('text', {
      x: cx, y: cy - (centerBottom != null ? 2 : -5), 'text-anchor': 'middle',
      fill: 'var(--text)', 'font-size': 17, 'font-weight': 700,
    });
    t.textContent = centerTop;
    svg.append(t);
  }
  if (centerBottom != null) {
    const t = svgEl('text', {
      x: cx, y: cy + 17, 'text-anchor': 'middle', fill: 'var(--text-dim)', 'font-size': 11,
    });
    t.textContent = centerBottom;
    svg.append(t);
  }
  container.append(svg);
}

/** Halka grafik + yanında yüzdeli açıklama listesi üretir. */
export function donutWithLegend(items, { centerTop, centerBottom, format } = {}) {
  const total = items.reduce((s, it) => s + (it.value > 0 ? it.value : 0), 0);
  const chart = h('div', { class: 'chart' });
  const wrap = h('div', { class: 'donut-wrap' },
    chart,
    h('div', { class: 'donut-legend' },
      items.slice(0, 12).map((it) => h('div', { class: 'row' },
        h('span', { class: 'swatch', style: `background:${it.color};width:10px;height:10px;border-radius:3px` }),
        h('span', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, it.label),
        h('span', { class: 'val' },
          format ? format(it.value) : `%${((it.value / total) * 100).toFixed(1)}`)))));
  donutChart(chart, { items, centerTop, centerBottom });
  return wrap;
}

/* ---------------------------------------------------------------- çubuk grafik */

/** Yatay çubuk grafik; pozitif/negatif değerleri sıfır ekseninin iki yanına çizer. */
export function barChart(container, cfg) {
  const draw = () => renderBars(container, cfg);
  container.classList.add('chart');
  draw();
  onResize(container, draw);
  return draw;
}

function renderBars(container, cfg) {
  const { items = [], format = (v) => String(v), rowHeight = 26, labelWidth = 74 } = cfg;
  container.replaceChildren();
  if (!items.length) {
    container.append(h('p', { class: 'dim', style: 'padding:20px 0;text-align:center' }, 'Veri yok.'));
    return;
  }
  const width = Math.max(container.clientWidth || 520, 260);
  const height = items.length * rowHeight + 8;
  const maxAbs = Math.max(...items.map((it) => Math.abs(it.value) || 0), 1e-9);
  const hasNegative = items.some((it) => it.value < 0);
  const plotLeft = labelWidth;
  const plotW = width - labelWidth - 8;
  const zeroX = hasNegative ? plotLeft + plotW / 2 : plotLeft;
  const scale = hasNegative ? (plotW / 2) / maxAbs : plotW / maxAbs;

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height });

  items.forEach((it, i) => {
    const yTop = i * rowHeight + 4;
    const value = isNum(it.value) ? it.value : 0;
    const len = Math.abs(value) * scale;
    const x0 = value >= 0 ? zeroX : zeroX - len;

    svg.append(svgEl('rect', {
      x: x0, y: yTop, width: Math.max(len, 1.5), height: rowHeight - 11,
      rx: 3, fill: it.color || (value >= 0 ? 'var(--up)' : 'var(--down)'),
      opacity: .9,
    }));

    const label = svgEl('text', {
      x: plotLeft - 8, y: yTop + rowHeight / 2 - 1, 'text-anchor': 'end',
      fill: 'var(--text)', 'font-size': 12, 'font-weight': 600,
    });
    label.textContent = it.label;
    svg.append(label);

    const val = svgEl('text', {
      x: value >= 0 ? x0 + len + 6 : x0 - 6, y: yTop + rowHeight / 2 - 1,
      'text-anchor': value >= 0 ? 'start' : 'end',
      fill: 'var(--text-dim)', 'font-size': 11,
    });
    val.textContent = format(value);
    svg.append(val);
  });

  if (hasNegative) {
    svg.append(svgEl('line', {
      x1: zeroX, x2: zeroX, y1: 0, y2: height,
      stroke: 'var(--border)', 'stroke-width': 1,
    }));
  }
  container.append(svg);
}

/* -------------------------------------------------------------- ısı haritası */

/** Korelasyon matrisi tablosu (-1 kırmızı, +1 yeşil). */
export function correlationTable(labels, matrix) {
  const color = (v) => {
    if (!isNum(v)) return 'transparent';
    const a = Math.min(Math.abs(v), 1) * 0.75;
    return v >= 0
      ? `color-mix(in srgb, var(--up) ${a * 100}%, transparent)`
      : `color-mix(in srgb, var(--down) ${a * 100}%, transparent)`;
  };
  const head = h('tr', {}, h('th', {}, ''), labels.map((l) => h('th', { style: 'text-align:center' }, l)));
  const rows = labels.map((rowLabel, i) => h('tr', {},
    h('td', { style: 'font-weight:600' }, rowLabel),
    labels.map((_, j) => h('td', {
      class: 'heat-cell',
      style: `background:${color(matrix[i][j])};text-align:center`,
    }, isNum(matrix[i][j]) ? matrix[i][j].toFixed(2) : '—'))));
  return h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, head), h('tbody', {}, rows)));
}

export { colorAt };
