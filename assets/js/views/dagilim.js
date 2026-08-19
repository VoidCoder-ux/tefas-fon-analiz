/* Dağılım: portföyün fon, kategori ve gerçek varlık sınıfı kırılımları. */

import { h, tl, tlSigned, pct, pctSigned, colorAt, isNum, num } from '../util.js';
import { donutWithLegend, barChart, stackedAreaChart } from '../charts.js';
import { weightHistory, attribution } from '../insights.js';
import { transactions } from '../store.js';
import { sectionCard, emptyState } from './common.js';

const cls2 = (v) => (!isNum(v) || v === 0 ? '' : v > 0 ? 'up' : 'down');

export function renderDagilim(ctx) {
  const { analysis, navigate } = ctx;
  const { open, totals } = analysis;

  if (!open.length) {
    return emptyState('Dağılım için açık pozisyon gerekiyor',
      'En az bir fonda pozisyonun olduğunda dağılım grafikleri burada görünür.',
      'İşlem ekle', () => navigate('islemler'));
  }

  const root = h('div', { class: 'stack' });

  /* ------------------------------------------------------- fon ve kategori dağılımı */

  const byFund = open
    .filter((x) => x.value > 0)
    .map((x, i) => ({ label: x.code, value: x.value, color: colorAt(i) }));

  const catMap = new Map();
  for (const x of open) {
    if (x.value <= 0) continue;
    catMap.set(x.cat, (catMap.get(x.cat) || 0) + x.value);
  }
  const byCat = [...catMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], i) => ({ label, value, color: colorAt(i) }));

  root.append(h('div', { class: 'grid grid-2' },
    sectionCard('Fon Dağılımı', `${open.length} fon`,
      donutWithLegend(byFund, {
        centerTop: tl(totals.value, { compact: true }),
        centerBottom: 'toplam',
      })),
    sectionCard('Kategori Dağılımı', 'Fon ünvanından çıkarılan tür',
      donutWithLegend(byCat, {
        centerTop: String(byCat.length),
        centerBottom: byCat.length === 1 ? 'kategori' : 'kategori',
      }))));

  /* ------------------------------------------------ gerçek varlık sınıfı dağılımı */

  const assetMap = new Map();
  let covered = 0;
  for (const holding of open) {
    const alloc = holding.alloc || {};
    const keys = Object.keys(alloc);
    if (!keys.length || holding.value <= 0) continue;
    covered += holding.value;
    for (const [bucket, share] of Object.entries(alloc)) {
      assetMap.set(bucket, (assetMap.get(bucket) || 0) + holding.value * (share / 100));
    }
  }
  const byAsset = [...assetMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], i) => ({ label, value, color: colorAt(i) }));

  if (byAsset.length) {
    const coverage = totals.value > 0 ? (covered / totals.value) * 100 : 0;
    root.append(sectionCard(
      'Gerçek Varlık Dağılımı',
      `Fonların içindeki varlıklara göre · portföyün %${coverage.toFixed(0)}'ı kapsanıyor`,
      h('p', { class: 'dim', style: 'margin:0 0 12px;font-size:.85rem' },
        'Fonlarını tek tek değil, içlerindeki varlıkları toplayarak gösterir: paranın '
        + 'gerçekte ne kadarı hisse senedinde, ne kadarı mevduatta veya altında.'),
      donutWithLegend(byAsset, {
        centerTop: tl(covered, { compact: true }),
        centerBottom: 'kapsanan',
        format: (v) => tl(v, { compact: true }),
      })));
  }

  /* -------------------------------------------------------------- kâr/zarar katkısı */

  const katkilar = attribution(analysis.holdings, totals.netInvested);
  if (katkilar.length) {
    const box = h('div');
    const toplamPuan = katkilar.reduce((s2, k) => s2 + k.points, 0);
    root.append(sectionCard('Kâr/Zarar Katkısı',
      `Toplam getirinin ${pctSigned(toplamPuan, 1)} puanı bu dağılımdan geliyor`,
      h('p', { class: 'dim', style: 'margin:0 0 12px;font-size:.85rem' },
        'Her fonun toplam getirine kaç puan kattığını gösterir: fonun kâr/zararı, '
        + "yatırdığın net anaparaya bölünür. Puanların toplamı, Panel'deki toplam "
        + 'getiri yüzdesine eşittir.'),
      box,
      h('div', { class: 'table-wrap', style: 'margin-top:12px' }, h('table', {},
        h('thead', {}, h('tr', {},
          h('th', { style: 'text-align:left' }, 'Fon'),
          h('th', {}, 'Kâr/Zarar'), h('th', {}, 'Getiriye katkısı'))),
        h('tbody', {}, katkilar.map((k) => h('tr', {},
          h('td', {}, h('span', { class: 'code-chip' }, k.code)),
          h('td', { class: cls2(k.amount) }, tlSigned(k.amount)),
          h('td', { class: cls2(k.points) }, `${pctSigned(k.points, 2)} puan`))))))));
    barChart(box, {
      items: katkilar.map((k) => ({ label: k.code, value: k.points })),
      format: (v) => `${pctSigned(v, 2)} puan`,
    });
  }

  const daily = open
    .filter((x) => isNum(x.dayPL) && Math.abs(x.dayPL) > 0.005)
    .sort((a, b) => b.dayPL - a.dayPL)
    .map((x) => ({ label: x.code, value: x.dayPL }));

  if (daily.length) {
    const box = h('div');
    root.append(sectionCard('Bugünkü Katkı', `Toplam ${tlSigned(totals.dayPL)}`, box));
    barChart(box, { items: daily, format: (v) => tlSigned(v) });
  }

  /* ------------------------------------------------------------ ağırlık kayması */

  const seri = analysis.series;
  if (seri.dates.length > 20) {
    const agirlik = weightHistory(transactions(), seri.start, seri.dates);
    if (agirlik.codes.length > 1) {
      const kutu = h('div');
      root.append(sectionCard('Ağırlık Kayması',
        'Portföyünün bileşimi zaman içinde nasıl değişti',
        h('p', { class: 'dim', style: 'margin:0 0 12px;font-size:.85rem' },
          'Alım yapmasan bile kazandıran fon portföyde büyür. Bu grafik, hangi fonun '
          + 'payının farkında olmadan arttığını gösterir.'),
        kutu));
      stackedAreaChart(kutu, { rows: agirlik.rows, codes: agirlik.codes });
    }
  }

  /* ------------------------------------------------------------- yoğunlaşma uyarısı */

  const top = open[0];
  if (top && top.weight > 40) {
    root.append(h('div', { class: 'notice warn' },
      `Portföyünün ${pct(top.weight, 0)}'ı tek bir fonda (${top.code}). `
      + 'Tek fona yoğunlaşma riski artırır.'));
  }

  return root;
}
