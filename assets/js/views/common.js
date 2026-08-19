/* Görünümlerin paylaştığı küçük bileşenler. */

import { h, cls, isNum } from '../util.js';
import { searchFunds } from '../data.js';

/** Üstteki büyük sayı kartı. */
export function kpiCard({ label, value, sub, subClass, valueClass, hint }) {
  return h('div', { class: 'card kpi' },
    h('div', { class: 'kpi-label', text: label }),
    h('div', { class: `kpi-value ${valueClass || ''}`, text: value }),
    sub != null ? h('div', { class: `kpi-sub ${subClass || ''}`, text: sub }) : null,
    hint ? h('div', { class: 'kpi-hint', text: hint }) : null);
}

/** Kâr/zarar için otomatik renklendiren kart. */
export function plCard({ label, amount, pct, hint, formatMoney, formatPct }) {
  return kpiCard({
    label,
    value: formatMoney(amount),
    valueClass: cls(amount),
    sub: isNum(pct) ? formatPct(pct) : null,
    subClass: cls(pct),
    hint,
  });
}

export function sectionCard(title, sub, ...children) {
  return h('section', { class: 'card' },
    title ? h('div', { class: 'card-head' },
      h('h2', { text: title }),
      sub ? h('span', { class: 'sub', text: sub }) : null) : null,
    ...children);
}

export function emptyState(title, message, actionLabel, onAction) {
  return h('div', { class: 'card empty' },
    h('h3', { text: title }),
    h('p', { text: message }),
    actionLabel ? h('button', { class: 'btn btn-primary', type: 'button', onclick: onAction },
      actionLabel) : null);
}

export const RANGES = [
  { key: '1a', label: '1A', days: 30 },
  { key: '3a', label: '3A', days: 90 },
  { key: '6a', label: '6A', days: 180 },
  { key: '1y', label: '1Y', days: 365 },
  { key: '3y', label: '3Y', days: 1095 },
  { key: 'all', label: 'Tümü', days: 0 },
];

/** Zaman aralığı seçici (segment butonları). */
export function rangeSelector(currentKey, onChange) {
  const seg = h('div', { class: 'seg' });
  for (const r of RANGES) {
    seg.append(h('button', {
      type: 'button',
      'aria-pressed': r.key === currentKey ? 'true' : 'false',
      onclick: () => onChange(r),
    }, r.label));
  }
  return seg;
}

/**
 * Fon kodu/adı için otomatik tamamlama.
 * @returns {{wrap: HTMLElement, input: HTMLInputElement, get: ()=>string}}
 */
export function fundPicker({ value = '', placeholder = 'Fon kodu veya adı', onPick } = {}) {
  const input = h('input', {
    type: 'text', value, placeholder, autocomplete: 'off', spellcheck: 'false',
    style: 'width:100%;text-transform:uppercase',
  });
  const list = h('div', { class: 'ac-list', hidden: true });
  const wrap = h('div', { class: 'autocomplete' }, input, list);
  let items = [], cursor = -1;

  const close = () => { list.hidden = true; cursor = -1; };

  const choose = (fund) => {
    input.value = fund.code;
    close();
    onPick?.(fund);
  };

  const render = () => {
    list.replaceChildren();
    if (!items.length) { close(); return; }
    items.forEach((f, i) => {
      list.append(h('div', {
        class: 'ac-item', 'aria-selected': i === cursor ? 'true' : 'false',
        onmousedown: (e) => { e.preventDefault(); choose(f); },
      },
      h('span', { class: 'code-chip', text: f.code }),
      h('span', { class: 'ac-name', text: f.name })));
    });
    list.hidden = false;
  };

  input.addEventListener('input', () => {
    input.value = input.value.toLocaleUpperCase('tr');
    items = searchFunds(input.value, 10);
    cursor = -1;
    render();
  });
  input.addEventListener('focus', () => {
    if (input.value) { items = searchFunds(input.value, 10); render(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (list.hidden || !items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); cursor = (cursor + 1) % items.length; render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cursor = (cursor - 1 + items.length) % items.length; render(); }
    else if (e.key === 'Enter') {
      if (cursor >= 0) { e.preventDefault(); choose(items[cursor]); }
      else if (items.length === 1) { e.preventDefault(); choose(items[0]); }
    } else if (e.key === 'Escape') close();
  });

  return { wrap, input, get: () => input.value.trim().toLocaleUpperCase('tr') };
}

/** Basit sıralanabilir tablo oluşturur. */
export function sortableTable({ columns, rows, initialSort, rowKey, onRowClick }) {
  let sortKey = initialSort?.key ?? columns[0].key;
  let sortDir = initialSort?.dir ?? 'desc';

  const table = h('table');
  const thead = h('thead');
  const tbody = h('tbody');
  table.append(thead, tbody);

  const renderHead = () => {
    thead.replaceChildren(h('tr', {}, columns.map((c) => h('th', {
      class: c.sortable === false ? '' : 'sortable',
      style: c.align ? `text-align:${c.align}` : null,
      title: c.title || null,
      onclick: c.sortable === false ? null : () => {
        if (sortKey === c.key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        else { sortKey = c.key; sortDir = c.defaultDir || 'desc'; }
        renderHead(); renderBody();
      },
    }, c.label + (sortKey === c.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '')))));
  };

  const renderBody = () => {
    const col = columns.find((c) => c.key === sortKey);
    const sorted = rows.slice().sort((a, b) => {
      const va = col?.sortValue ? col.sortValue(a) : a[sortKey];
      const vb = col?.sortValue ? col.sortValue(b) : b[sortKey];
      const na = isNum(va), nb = isNum(vb);
      if (na && nb) return sortDir === 'asc' ? va - vb : vb - va;
      if (na !== nb) return na ? -1 : 1;                       // sayısal olmayanlar sona
      const sa = String(va ?? ''), sb = String(vb ?? '');
      return sortDir === 'asc' ? sa.localeCompare(sb, 'tr') : sb.localeCompare(sa, 'tr');
    });
    tbody.replaceChildren(...sorted.map((row) => {
      const tr = h('tr', {
        class: onRowClick ? 'row-link' : null,
        dataset: rowKey ? { key: rowKey(row) } : undefined,
        onclick: onRowClick ? (e) => {
          if (e.target.closest('button')) return;
          onRowClick(row);
        } : null,
      }, columns.map((c) => {
        const cell = c.render ? c.render(row) : row[c.key];
        return h('td', {
          class: c.cellClass ? c.cellClass(row) : null,
          style: c.align ? `text-align:${c.align}` : null,
        }, cell instanceof Node ? cell : String(cell ?? '—'));
      }));
      return tr;
    }));
  };

  renderHead();
  renderBody();
  return { element: h('div', { class: 'table-wrap' }, table), refresh: renderBody };
}
