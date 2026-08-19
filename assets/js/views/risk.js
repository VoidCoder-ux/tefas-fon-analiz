/* Risk: oynaklık, Sharpe, maksimum düşüş ve fonlar arası korelasyon. */

import { h, pct, pctSigned, num, cls, isNum } from '../util.js';
import { DB, cachedHistory, priceAtIndex, lastIndex } from '../data.js';
import { lineChart, correlationTable } from '../charts.js';
import { riskSummary, dailyReturns, correlation } from '../portfolio.js';
import { settings, setSetting } from '../store.js';
import { kpiCard, sectionCard, emptyState } from './common.js';

/** Seriden düşüş (drawdown) yüzdeleri üretir. */
function drawdownSeries(values) {
  let peak = -Infinity;
  return values.map((v) => {
    if (!isNum(v) || v <= 0) return null;
    peak = Math.max(peak, v);
    return (v / peak - 1) * 100;
  });
}

export function renderRisk(ctx) {
  const { analysis, navigate } = ctx;
  const { series, open } = analysis;

  if (series.dates.length < 10) {
    return emptyState('Risk analizi için daha fazla geçmiş gerekiyor',
      'En az birkaç haftalık işlem geçmişi oluştuğunda oynaklık, Sharpe oranı ve '
      + 'maksimum düşüş burada hesaplanır.',
      'İşlem ekle', () => navigate('islemler'));
  }

  const root = h('div', { class: 'stack' });
  const riskFree = Number(settings().riskFree) || 0;
  const summary = riskSummary(series.twr, series.dates, riskFree);

  /* -------------------------------------------------------------------- KPI'lar */

  root.append(h('div', { class: 'grid grid-kpi' },
    kpiCard({
      label: 'Yıllık Oynaklık',
      value: isNum(summary.vol) ? pct(summary.vol, 1) : '—',
      sub: summary.vol > 25 ? 'Yüksek dalgalanma' : summary.vol > 12 ? 'Orta' : 'Düşük',
      hint: 'Günlük getirilerin standart sapması, yıllığa çevrilmiş',
    }),
    kpiCard({
      label: 'Sharpe Oranı',
      value: isNum(summary.sharpe) ? num(summary.sharpe, 2) : '—',
      valueClass: cls(summary.sharpe),
      sub: `Risksiz getiri %${num(riskFree, 0)} varsayıldı`,
      hint: 'Aldığın risk başına düşen fazla getiri; 1 üzeri iyi kabul edilir',
    }),
    kpiCard({
      label: 'Maksimum Düşüş',
      value: isNum(summary.maxDD) ? pct(summary.maxDD, 1) : '—',
      valueClass: 'down',
      sub: 'Zirveden en derin geri çekilme',
    }),
    kpiCard({
      label: 'Yıllık Getiri (TWR)',
      value: isNum(summary.annual) ? pctSigned(summary.annual, 1) : '—',
      valueClass: cls(summary.annual),
      sub: `${Math.round(summary.days)} günlük geçmişten`,
      hint: summary.days < 180
        ? 'Kısa geçmiş - yıllıklandırılmış değerler oynak olabilir'
        : null,
    }),
    kpiCard({
      label: 'Kazançlı Gün Oranı',
      value: isNum(summary.positiveDays) ? pct(summary.positiveDays, 0) : '—',
      sub: isNum(summary.best)
        ? `En iyi ${pctSigned(summary.best, 1)} · en kötü ${pctSigned(summary.worst, 1)}`
        : null,
    })));

  /* --------------------------------------------------------- risksiz getiri ayarı */

  const rfInput = h('input', {
    type: 'number', value: String(riskFree), min: '0', max: '200', step: '1',
    style: 'width:90px',
  });
  rfInput.addEventListener('change', () => {
    setSetting('riskFree', Number(rfInput.value) || 0);
    ctx.refresh();
  });

  root.append(sectionCard(null, null,
    h('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' },
      h('label', { class: 'dim', style: 'font-size:.86rem' },
        'Sharpe hesabında kullanılacak risksiz yıllık getiri (%):'),
      rfInput,
      h('span', { class: 'dim', style: 'font-size:.78rem' },
        'Genelde mevduat veya para piyasası fonu getirisi kullanılır.'))));

  /* ----------------------------------------------------------------- düşüş grafiği */

  const ddBox = h('div', { class: 'chart' });
  root.append(sectionCard('Zirveden Düşüş (Drawdown)',
    'Portföyün en yüksek değerine göre ne kadar geride olduğu', ddBox));
  lineChart(ddBox, {
    dates: series.dates,
    height: 220,
    baseline: 0,
    yFormat: (v) => pct(v, 0),
    valueFormat: (v) => pct(v, 2),
    series: [{
      name: 'Düşüş', values: drawdownSeries(series.twr),
      color: 'var(--down)', fill: true,
    }],
    legend: false,
  });

  /* --------------------------------------------------------------- korelasyon */

  const codes = open.filter((x) => x.value > 0).map((x) => x.code).slice(0, 12);
  if (codes.length >= 2) {
    const end = lastIndex();
    const start = Math.max(0, end - 260);
    const returnsByCode = codes.map((code) => {
      const hist = cachedHistory(code);
      const prices = [];
      for (let i = start; i <= end; i++) prices.push(priceAtIndex(hist, i));
      return dailyReturns(prices);
    });

    const matrix = codes.map((_, i) => codes.map((__, j) => (
      i === j ? 1 : correlation(returnsByCode[i], returnsByCode[j])
    )));

    root.append(sectionCard('Fonlar Arası Korelasyon',
      'Son 1 yıl · 1\'e yakın = birlikte hareket eder, 0\'a yakın = bağımsız',
      h('p', { class: 'dim', style: 'margin:0 0 12px;font-size:.85rem' },
        'Yeşil hücreler birlikte hareket eden fonları gösterir. Portföyün büyük kısmı '
        + 'yüksek korelasyonluysa çeşitlendirme beklediğin kadar koruma sağlamıyor olabilir.'),
      correlationTable(codes, matrix)));
  }

  /* ------------------------------------------------------------- fon bazlı risk */

  const rows = open
    .map((holding) => DB.byCode.get(holding.code))
    .filter(Boolean)
    .map((fund) => h('tr', {},
      h('td', {}, h('span', { class: 'code-chip' }, fund.code)),
      h('td', { class: 'name', style: 'text-align:left' }, fund.name),
      h('td', {}, isNum(fund.vol) ? pct(fund.vol, 1) : '—'),
      h('td', { class: 'down' }, isNum(fund.mdd) ? pct(fund.mdd, 1) : '—'),
      h('td', { class: cls(fund.ret?.['1y']) }, pctSigned(fund.ret?.['1y'], 1))));

  if (rows.length) {
    root.append(sectionCard('Fon Bazlı Risk', 'Son 1 yıllık veriye göre',
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, 'Fon'), h('th', { style: 'text-align:left' }, 'Ünvan'),
          h('th', {}, 'Oynaklık'), h('th', {}, 'Maks. Düşüş'), h('th', {}, '1 Yıl Getiri'))),
        h('tbody', {}, rows)))));
  }

  return root;
}
