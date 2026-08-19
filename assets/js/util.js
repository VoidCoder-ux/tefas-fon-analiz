/* Biçimlendirme ve DOM yardımcıları. */

const TL = new Intl.NumberFormat('tr-TR', {
  style: 'currency', currency: 'TRY', maximumFractionDigits: 2,
});
const TL0 = new Intl.NumberFormat('tr-TR', {
  style: 'currency', currency: 'TRY', maximumFractionDigits: 0,
});
const NUM = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
const DATE = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
const DATE_SHORT = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short' });

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Para birimi biçimi. Büyük tutarlarda kuruş gösterilmez. */
export function tl(v, { compact = false } = {}) {
  if (!isNum(v)) return '—';
  if (compact) {
    if (Math.abs(v) >= 1e9) return `₺${NUM.format(v / 1e9)} mlr`;
    if (Math.abs(v) >= 1e6) return `₺${NUM.format(v / 1e6)} mn`;
    return TL0.format(v);
  }
  return (Math.abs(v) >= 100_000 ? TL0 : TL).format(v);
}

/** İşaretli para: +₺1.234,56 / -₺98,00 */
export function tlSigned(v) {
  if (!isNum(v)) return '—';
  return (v > 0 ? '+' : '') + tl(v);
}

export function pct(v, digits = 2) {
  if (!isNum(v)) return '—';
  // Türkçede işaret yüzde imininin önüne gelir: -%1 (%-1 değil).
  const r = Number(v.toFixed(digits));
  return `${r < 0 ? '-' : ''}%${NUM.format(Math.abs(r))}`;
}

export function pctSigned(v, digits = 2) {
  if (!isNum(v)) return '—';
  return (v > 0 ? '+' : v < 0 ? '−' : '') + `%${NUM.format(Math.abs(Number(v.toFixed(digits))))}`;
}

export function num(v, digits = 2) {
  if (!isNum(v)) return '—';
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(v);
}

/** Adet: 6 haneye kadar, sondaki sıfırlar atılır. */
export function units(v) {
  if (!isNum(v)) return '—';
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 6 }).format(v);
}

export function money(v, digits = 6) {
  if (!isNum(v)) return '—';
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: digits }).format(v);
}

export function bigTL(v) {
  if (!isNum(v)) return '—';
  if (Math.abs(v) >= 1e9) return `₺${NUM.format(v / 1e9)} mlr`;
  if (Math.abs(v) >= 1e6) return `₺${NUM.format(v / 1e6)} mn`;
  return tl(v);
}

export const fmtDate = (iso) => (iso ? DATE.format(new Date(iso + 'T00:00:00')) : '—');
export const fmtDateShort = (iso) => (iso ? DATE_SHORT.format(new Date(iso + 'T00:00:00')) : '—');

export const cls = (v) => (!isNum(v) || v === 0 ? '' : v > 0 ? 'up' : 'down');

export const todayISO = () => new Date().toISOString().slice(0, 10);

/** ISO tarihe gün ekler/çıkarır. */
export function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* ------------------------------------------------------------------ DOM */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Etiket + öznitelik + çocuklardan element üretir. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** HTML metninden element üretir (tek kök). */
export function fromHTML(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function toast(message) {
  const root = $('#toastRoot');
  if (!root) return;
  const node = h('div', { class: 'toast', text: message });
  root.append(node);
  setTimeout(() => node.remove(), 2600);
}

/** Basit modal aç; kapatma fonksiyonu döner. */
export function openModal(title, bodyNode, { wide = false } = {}) {
  const root = $('#modalRoot');
  const close = () => { root.hidden = true; root.replaceChildren(); document.body.style.overflow = ''; };
  const modal = h('div', { class: 'modal', style: wide ? 'width:min(1040px,100%)' : null },
    h('div', { class: 'modal-head' },
      h('h2', { text: title }),
      h('button', { class: 'icon-btn', type: 'button', title: 'Kapat', onclick: close }, '✕')),
    bodyNode);
  root.replaceChildren(modal);
  root.hidden = false;
  document.body.style.overflow = 'hidden';
  root.onclick = (e) => { if (e.target === root) close(); };
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });
  return close;
}

/** Onay kutusu (Promise<boolean>). */
export function confirmDialog(title, message, { danger = false, okLabel = 'Onayla' } = {}) {
  return new Promise((resolve) => {
    let close;
    const done = (v) => { close?.(); resolve(v); };
    const body = h('div', { class: 'stack' },
      h('p', { class: 'dim', text: message }),
      h('div', { class: 'btn-row', style: 'justify-content:flex-end' },
        h('button', { class: 'btn', type: 'button', onclick: () => done(false) }, 'Vazgeç'),
        h('button', {
          class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button',
          onclick: () => done(true),
        }, okLabel)));
    close = openModal(title, body);
  });
}

/** Metni dosya olarak indirir. */
export function downloadText(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Grafik renk paleti (CSS değişkenlerinden). */
export const PALETTE = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7', '--c8', '--c9', '--c10']
  .map((v) => `var(${v})`);

export const colorAt = (i) => PALETTE[i % PALETTE.length];

/** Yeniden boyutlandırmada geri çağırır (grafikleri yeniden çizmek için). */
export function onResize(el, fn) {
  if (typeof ResizeObserver === 'undefined') {
    window.addEventListener('resize', fn);
    return;
  }
  const ro = new ResizeObserver(() => fn());
  ro.observe(el);
}

export function debounce(fn, ms = 220) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
