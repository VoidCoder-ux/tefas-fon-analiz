/* Fonlar: TEFAS'taki tüm fonlarda arama, filtreleme, karşılaştırma ve fon detayı. */

import {
  h, tl, bigTL, pct, pctSigned, money, num, cls, isNum, colorAt, debounce, openModal, fmtDate,
  addDays,
} from '../util.js';
import { DB, loadHistory, lastIndex, indexForDate } from '../data.js';
import { lineChart, donutWithLegend } from '../charts.js';
import { sectionCard, sortableTable, RANGES } from './common.js';

const PAGE_SIZE = 60;

/** Tek bir fonun detay penceresi: fiyat grafiği, getiriler, varlık dağılımı. */
export async function showFundDetail(code, ctx) {
  const fund = DB.byCode.get(code);
  if (!fund) return;

  const chartBox = h('div', { class: 'chart' });
  const body = h('div', { class: 'stack' });
  const close = openModal(`${fund.code} · ${fund.name}`, body, { wide: true });

  const stat = (label, value, klass) => h('div', { class: 'card kpi' },
    h('div', { class: 'kpi-label', text: label }),
    h('div', { class: `kpi-value ${klass || ''}`, style: 'font-size:1.15rem', text: value }));

  body.append(h('div', { class: 'grid grid-kpi' },
    stat('Son Fiyat', money(fund.price)),
    stat('Günlük', pctSigned(fund.chg), cls(fund.chg)),
    stat('1 Yıl', pctSigned(fund.ret?.['1y'], 1), cls(fund.ret?.['1y'])),
    stat('Oynaklık', isNum(fund.vol) ? pct(fund.vol, 1) : '—'),
    stat('Maks. Düşüş', isNum(fund.mdd) ? pct(fund.mdd, 1) : '—', 'down')));

  let rangeKey = '1y';
  const head = h('div', { class: 'card-head' },
    h('div', {}, h('h3', {}, 'Fiyat Geçmişi'),
      h('span', { class: 'sub' }, `Son veri: ${fmtDate(fund.date)}`)),
    h('div', { class: 'seg' }, RANGES.map((r) => h('button', {
      type: 'button', 'aria-pressed': r.key === rangeKey ? 'true' : 'false',
      onclick: (e) => {
        rangeKey = r.key;
        e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => {
          b.setAttribute('aria-pressed', String(b === e.currentTarget));
        });
        draw();
      },
    }, r.label))));

  body.append(h('section', { class: 'card' }, head, chartBox));

  const hist = await loadHistory(code);
  const end = lastIndex();

  function draw() {
    const days = RANGES.find((r) => r.key === rangeKey)?.days ?? 0;
    // Aralık takvim gününe göre verilir; iş günü indeksine çevirmek gerekir.
    const from = days
      ? Math.max(hist.i, Math.max(0, indexForDate(addDays(DB.calendar[end], -days))))
      : hist.i;
    const dates = [], values = [];
    for (let i = from; i <= end; i++) {
      dates.push(DB.calendar[i]);
      const k = i - hist.i;
      values.push(k >= 0 && k < hist.p.length ? hist.p[k] : null);
    }
    lineChart(chartBox, {
      dates, height: 260, legend: false,
      yFormat: (v) => num(v, 2),
      valueFormat: (v) => `${money(v)} ₺`,
      series: [{ name: fund.code, values, color: 'var(--accent)', fill: true }],
    });
  }
  draw();

  const returnsRow = h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ['1 Hafta', '1 Ay', '3 Ay', '6 Ay', '1 Yıl', '3 Yıl']
      .map((l) => h('th', { style: 'text-align:center' }, l)))),
    h('tbody', {}, h('tr', {}, ['1h', '1a', '3a', '6a', '1y', '3y'].map((k) => h('td', {
      class: cls(fund.ret?.[k]), style: 'text-align:center',
    }, pctSigned(fund.ret?.[k], 1)))))));

  body.append(sectionCard('Dönemsel Getiriler', null, returnsRow));

  const allocItems = Object.entries(fund.alloc || {})
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], i) => ({ label, value, color: colorAt(i) }));

  const info = h('div', { class: 'grid grid-2' },
    allocItems.length
      ? sectionCard('Varlık Dağılımı', 'Fonun portföyü', donutWithLegend(allocItems, {
        centerTop: `${allocItems.length}`, centerBottom: 'varlık sınıfı',
        format: (v) => `%${v.toFixed(1)}`,
      }))
      : null,
    sectionCard('Fon Bilgileri', null,
      h('div', { class: 'table-wrap' }, h('table', {}, h('tbody', {},
        h('tr', {}, h('td', {}, 'Kategori'), h('td', {}, fund.cat)),
        h('tr', {}, h('td', {}, 'Tip'), h('td', {},
          { YAT: 'Yatırım Fonu', EMK: 'Emeklilik Fonu', BYF: 'Borsa Yatırım Fonu' }[fund.kind] || fund.kind)),
        h('tr', {}, h('td', {}, 'Portföy Büyüklüğü'), h('td', {}, bigTL(fund.size))),
        h('tr', {}, h('td', {}, 'Yatırımcı Sayısı'), h('td', {},
          isNum(fund.inv) ? new Intl.NumberFormat('tr-TR').format(fund.inv) : '—')),
        h('tr', {}, h('td', {}, 'TEFAS Sayfası'), h('td', {},
          h('a', {
            href: `https://www.tefas.gov.tr/FonAnaliz.aspx?FonKod=${encodeURIComponent(fund.code)}`,
            target: '_blank', rel: 'noopener noreferrer', style: 'color:var(--accent)',
          }, 'aç ↗'))))))));

  body.append(info);
  body.append(h('div', { class: 'btn-row', style: 'justify-content:flex-end' },
    h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Kapat'),
    h('button', {
      class: 'btn btn-primary', type: 'button',
      onclick: () => { close(); ctx.navigate('islemler', { code }); },
    }, 'Bu fona işlem ekle')));
}

export function renderFonlar(ctx) {
  const root = h('div', { class: 'stack' });
  const categories = [...new Set(DB.funds.map((f) => f.cat))].sort((a, b) => a.localeCompare(b, 'tr'));
  const kinds = [...new Set(DB.funds.map((f) => f.kind))];

  const state = { query: '', cat: '', kind: '', limit: PAGE_SIZE, onlyMine: false };
  const mine = new Set((ctx.analysis?.open || []).map((x) => x.code));

  const search = h('input', {
    type: 'search', placeholder: 'Fon kodu veya ünvan ara…', style: 'min-width:220px;flex:1 1 240px',
  });
  const catSel = h('select', {},
    h('option', { value: '' }, 'Tüm kategoriler'),
    categories.map((c) => h('option', { value: c }, c)));
  const kindSel = h('select', {},
    h('option', { value: '' }, 'Tüm tipler'),
    kinds.map((k) => h('option', { value: k },
      { YAT: 'Yatırım', EMK: 'Emeklilik', BYF: 'Borsa Yatırım' }[k] || k)));
  const mineBtn = h('button', { class: 'btn', type: 'button', 'aria-pressed': 'false' },
    'Sadece portföyüm');

  const tableBox = h('div');
  const countLabel = h('span', { class: 'sub' });

  const apply = () => {
    const q = state.query.toLocaleUpperCase('tr');
    let rows = DB.funds.filter((f) => {
      if (state.onlyMine && !mine.has(f.code)) return false;
      if (state.cat && f.cat !== state.cat) return false;
      if (state.kind && f.kind !== state.kind) return false;
      if (!q) return true;
      return f.code.includes(q) || f.name.toLocaleUpperCase('tr').includes(q);
    });
    const total = rows.length;
    rows = rows.slice(0, state.limit);
    countLabel.textContent = `${total} fon eşleşti · ${rows.length} tanesi listeleniyor`;

    const table = sortableTable({
      initialSort: { key: 'size', dir: 'desc' },
      onRowClick: (row) => showFundDetail(row.code, ctx),
      rows,
      columns: [
        {
          key: 'code', label: 'Kod', defaultDir: 'asc',
          render: (f) => h('span', {},
            h('span', { class: 'code-chip' }, f.code),
            mine.has(f.code) ? h('span', { class: 'pill up', style: 'margin-left:6px' }, 'portföyümde') : null),
        },
        {
          key: 'name', label: 'Ünvan', defaultDir: 'asc', align: 'left',
          render: (f) => h('span', { title: f.name }, f.name),
          cellClass: () => 'name',
        },
        { key: 'cat', label: 'Kategori', defaultDir: 'asc', align: 'left' },
        { key: 'price', label: 'Fiyat', render: (f) => money(f.price, 4) },
        { key: 'chg', label: 'Günlük', render: (f) => h('span', { class: cls(f.chg) }, pctSigned(f.chg)) },
        {
          key: 'r1a', label: '1 Ay', sortValue: (f) => f.ret?.['1a'],
          render: (f) => h('span', { class: cls(f.ret?.['1a']) }, pctSigned(f.ret?.['1a'], 1)),
        },
        {
          key: 'r1y', label: '1 Yıl', sortValue: (f) => f.ret?.['1y'],
          render: (f) => h('span', { class: cls(f.ret?.['1y']) }, pctSigned(f.ret?.['1y'], 1)),
        },
        {
          key: 'r3y', label: '3 Yıl', sortValue: (f) => f.ret?.['3y'],
          render: (f) => h('span', { class: cls(f.ret?.['3y']) }, pctSigned(f.ret?.['3y'], 1)),
        },
        { key: 'vol', label: 'Oynaklık', render: (f) => (isNum(f.vol) ? pct(f.vol, 1) : '—') },
        {
          key: 'mdd', label: 'Maks. Düşüş',
          render: (f) => h('span', { class: isNum(f.mdd) ? 'down' : '' }, isNum(f.mdd) ? pct(f.mdd, 1) : '—'),
        },
        { key: 'size', label: 'Büyüklük', render: (f) => bigTL(f.size) },
      ],
    });

    const more = total > rows.length
      ? h('div', { style: 'text-align:center;margin-top:12px' },
        h('button', {
          class: 'btn', type: 'button',
          onclick: () => { state.limit += PAGE_SIZE * 3; apply(); },
        }, `Daha fazla göster (${total - rows.length} kaldı)`))
      : null;

    tableBox.replaceChildren(table.element, more || h('span'));
  };

  search.addEventListener('input', debounce(() => {
    state.query = search.value.trim();
    state.limit = PAGE_SIZE;
    apply();
  }, 200));
  catSel.addEventListener('change', () => { state.cat = catSel.value; state.limit = PAGE_SIZE; apply(); });
  kindSel.addEventListener('change', () => { state.kind = kindSel.value; state.limit = PAGE_SIZE; apply(); });
  mineBtn.addEventListener('click', () => {
    state.onlyMine = !state.onlyMine;
    mineBtn.setAttribute('aria-pressed', String(state.onlyMine));
    mineBtn.style.background = state.onlyMine ? 'var(--accent-soft)' : '';
    state.limit = PAGE_SIZE;
    apply();
  });

  root.append(h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', {}, 'Tüm Fonlar'), countLabel)),
    h('div', {
      style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center',
    }, search, catSel, kindSel, mine.size ? mineBtn : null),
    tableBox));

  apply();
  return root;
}
