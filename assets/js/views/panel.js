/* Panel: portföyün özeti - toplam değer, günlük ve toplam kazanç, pozisyonlar. */

import { h, tl, tlSigned, pct, pctSigned, units as fmtUnits, money, cls, isNum, fmtDate }
  from '../util.js';
import { DB } from '../data.js';
import { lineChart } from '../charts.js';
import { sliceLastDays } from '../portfolio.js';
import { kpiCard, plCard, sectionCard, emptyState, rangeSelector, sortableTable } from './common.js';

/**
 * Fon TEFAS'ta fiyat yayımlamayı bırakmış mı?
 * Kapanan fonlarda son bilinen fiyat sonsuza kadar taşınır; kullanıcı donmuş
 * bir değere baktığını bilmeli.
 */
const DURMUS_GUN_ESIGI = 7;

function fiyatiDurmus(holding) {
  if (!holding.lastPriceDate || !DB.meta.lastDataDate) return false;
  const fark = (new Date(DB.meta.lastDataDate) - new Date(holding.lastPriceDate)) / 86400000;
  return fark > DURMUS_GUN_ESIGI;
}

export function renderPanel(ctx) {
  const { analysis, navigate } = ctx;
  const { totals, open, closed, series } = analysis;

  if (!open.length && !closed.length) {
    return emptyState(
      'Henüz işlem yok',
      'Portföyünü görmek için önce fon alım işlemlerini gir. Fon kodunu ve tarihi seçince '
      + 'birim fiyat TEFAS verisinden otomatik doldurulur.',
      'İlk işlemi ekle',
      () => navigate('islemler'),
    );
  }

  const root = h('div', { class: 'stack' });

  /* ------------------------------------------------------------------ KPI'lar */

  root.append(h('div', { class: 'grid grid-kpi' },
    kpiCard({
      label: 'Toplam Değer',
      value: tl(totals.value),
      sub: `${totals.fundCount} fon · ${fmtDate(totals.lastDate)}`,
    }),
    plCard({
      label: 'Günlük Kazanç',
      amount: totals.dayPL,
      pct: totals.dayPct,
      formatMoney: tlSigned,
      formatPct: pctSigned,
      hint: `${fmtDate(totals.prevDate)} kapanışına göre`,
    }),
    plCard({
      label: 'Toplam Kazanç',
      amount: totals.totalPL,
      pct: totals.totalPct,
      formatMoney: tlSigned,
      formatPct: pctSigned,
      hint: totals.realized !== 0
        ? `${tlSigned(totals.unrealized)} açık · ${tlSigned(totals.realized)} gerçekleşmiş`
        : 'Tümü açık pozisyonlardan',
    }),
    kpiCard({
      label: 'Net Yatırılan',
      value: tl(totals.netInvested),
      sub: 'Alımlar − satışlar (masraflar dahil)',
    }),
    kpiCard({
      label: 'Yıllık Getiri (XIRR)',
      value: isNum(analysis.xirr) ? pctSigned(analysis.xirr, 1) : '—',
      valueClass: cls(analysis.xirr),
      sub: 'Para ağırlıklı yıllık bileşik getiri',
      hint: !isNum(analysis.xirr)
        ? 'Hesap için en az birkaç haftalık geçmiş gerekir'
        : (series.dates.length < 90
          ? 'Kısa geçmişten yıllıklandırıldı - oynak olabilir'
          : null),
    })));

  /* ------------------------------------------------------ portföy değeri grafiği */

  let rangeKey = '6a';
  const chartBox = h('div', { class: 'chart' });

  const drawChart = () => {
    const range = { '1a': 30, '3a': 90, '6a': 180, '1y': 365, '3y': 1095, all: 0 }[rangeKey];
    const v = sliceLastDays(series.dates, series.value, range);
    const inv = sliceLastDays(series.dates, series.invested, range);
    lineChart(chartBox, {
      dates: v.dates,
      height: 280,
      yFormat: (x) => tl(x, { compact: true }),
      valueFormat: (x) => tl(x),
      series: [
        { name: 'Portföy değeri', values: v.values, color: 'var(--accent)', fill: true },
        { name: 'Yatırılan anapara', values: inv.values, color: 'var(--text-dim)', dashed: true, width: 1.5 },
      ],
    });
  };

  const head = h('div', { class: 'card-head' },
    h('div', {},
      h('h2', {}, 'Portföy Değeri'),
      h('span', { class: 'sub' }, 'Kesikli çizgi yatırdığın net anaparadır; aradaki fark kazancındır.')),
    rangeSelector(rangeKey, (r) => {
      rangeKey = r.key;
      head.querySelectorAll('.seg button').forEach((b) => {
        b.setAttribute('aria-pressed', b.textContent === r.label ? 'true' : 'false');
      });
      drawChart();
    }));

  root.append(h('section', { class: 'card' }, head, chartBox));
  drawChart();

  /* ---------------------------------------------------------------- pozisyonlar */

  if (open.length) {
    const table = sortableTable({
      initialSort: { key: 'value', dir: 'desc' },
      onRowClick: (row) => ctx.showFund(row.code),
      columns: [
        {
          key: 'code', label: 'Fon', defaultDir: 'asc',
          render: (r) => h('div', { style: 'display:flex;flex-direction:column;gap:2px' },
            h('span', {}, h('span', { class: 'code-chip' }, r.code),
              r.missingPrice ? h('span', { class: 'pill', style: 'margin-left:6px' }, 'fiyat yok') : null,
              fiyatiDurmus(r) ? h('span', { class: 'pill down', style: 'margin-left:6px' }, 'fiyat durmuş') : null),
            h('span', { class: 'dim', style: 'font-size:.76rem;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, r.name)),
        },
        { key: 'units', label: 'Adet', render: (r) => fmtUnits(r.units) },
        { key: 'avgCost', label: 'Ort. Maliyet', render: (r) => money(r.avgCost) },
        { key: 'price', label: 'Güncel Fiyat', render: (r) => money(r.price) },
        {
          key: 'dayPct', label: 'Günlük',
          render: (r) => h('span', { class: cls(r.dayPct) },
            `${pctSigned(r.dayPct)}${isNum(r.dayPL) && r.dayPL !== 0 ? ` · ${tlSigned(r.dayPL)}` : ''}`),
        },
        { key: 'value', label: 'Değer', render: (r) => tl(r.value) },
        {
          key: 'unrealized', label: 'Kâr / Zarar',
          render: (r) => h('span', { class: cls(r.unrealized) },
            `${tlSigned(r.unrealized)} (${pctSigned(r.unrealizedPct)})`),
        },
        { key: 'weight', label: 'Ağırlık', render: (r) => pct(r.weight, 1) },
      ],
      rows: open,
    });

    root.append(sectionCard('Pozisyonlar', `${open.length} açık fon · satır tıklanabilir`,
      table.element));
  }

  if (closed.length) {
    const rows = closed.map((c) => h('tr', {},
      h('td', {}, h('span', { class: 'code-chip' }, c.code)),
      h('td', { class: 'name', style: 'text-align:left' }, c.name),
      h('td', {}, tl(c.bought)),
      h('td', {}, tl(c.sold)),
      h('td', { class: cls(c.realized) }, tlSigned(c.realized))));

    root.append(sectionCard('Kapanmış Pozisyonlar', 'Tamamı satılmış fonlar',
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, 'Fon'), h('th', { style: 'text-align:left' }, 'Ünvan'),
          h('th', {}, 'Alım Tutarı'), h('th', {}, 'Satış Tutarı'),
          h('th', {}, 'Gerçekleşen K/Z'))),
        h('tbody', {}, rows)))));
  }

  if (analysis.preRange) {
    root.append(h('div', { class: 'notice' },
      `Bazı işlemlerin ${fmtDate(series.dates[0])} tarihinden eski. TEFAS'tan `
      + 'yalnızca son 3 yılın fiyatları alındığı için grafikler bu tarihten '
      + 'itibaren çiziliyor; maliyet ve toplam kazanç hesapların gerçek alım '
      + 'fiyatlarınla yapılıyor, etkilenmiyor.'));
  }

  const durmus = open.filter(fiyatiDurmus);
  if (durmus.length) {
    root.append(h('div', { class: 'notice warn' },
      `${durmus.map((x) => `${x.code} (son fiyat ${fmtDate(x.lastPriceDate)})`).join(', ')} `
      + 'için TEFAS bir süredir yeni fiyat yayımlamıyor - fon kapanmış olabilir. '
      + 'Bu pozisyonların değeri son bilinen fiyattan hesaplanıyor, yani güncel değil.'));
  }

  const oversold = analysis.holdings.filter((x) => x.oversold);
  if (oversold.length) {
    root.append(h('div', { class: 'notice warn' },
      `Dikkat: ${oversold.map((x) => x.code).join(', ')} için elde olandan fazla satış girilmiş. `
      + 'Fazla kısım yok sayıldı - İşlemler sekmesinden kontrol et.'));
  }

  return root;
}
