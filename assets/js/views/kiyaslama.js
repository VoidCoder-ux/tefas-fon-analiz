/* Kıyaslama: portföyün getirisini BIST 100, gram altın, dolar ve enflasyonla karşılaştırır. */

import { h, tl, tlSigned, pctSigned, num, cls, isNum, colorAt } from '../util.js';
import { counterfactual } from '../insights.js';
import { transactions } from '../store.js';
import { DB } from '../data.js';
import { lineChart } from '../charts.js';
import { sliceLastDays } from '../portfolio.js';
import { sectionCard, emptyState, rangeSelector, RANGES } from './common.js';

const BENCH_COLORS = {
  BIST100: 'var(--c3)',
  GRAMALTIN: 'var(--c9)',
  USDTRY: 'var(--c2)',
  TUFE: 'var(--c5)',
  PARAPIYASASI: 'var(--c6)',
};

/** Seriyi ilk geçerli değerine göre 100'e normalize eder. */
function normalize(values) {
  const base = values.find((v) => isNum(v) && v > 0);
  if (!isNum(base)) return values.map(() => null);
  return values.map((v) => (isNum(v) && v > 0 ? (v / base) * 100 : null));
}

function totalReturn(values) {
  const clean = values.filter((v) => isNum(v) && v > 0);
  if (clean.length < 2) return null;
  return (clean[clean.length - 1] / clean[0] - 1) * 100;
}

export function renderKiyaslama(ctx) {
  const { analysis, navigate } = ctx;
  const { series } = analysis;

  if (!series.dates.length) {
    return emptyState('Kıyaslama için işlem geçmişi gerekiyor',
      'En az bir alım işlemi girdiğinde portföyünün getirisi endekslerle karşılaştırılır.',
      'İşlem ekle', () => navigate('islemler'));
  }

  const root = h('div', { class: 'stack' });
  const available = Object.keys(DB.benchmarks || {});
  const selected = new Set(available);

  /* --------------------------------------------------------- grafik ve kontroller */

  let rangeKey = '1y';
  const chartBox = h('div', { class: 'chart' });

  /** Kıyas serisini portföyün tarih penceresine hizalar. */
  const benchSlice = (key) => {
    const values = DB.benchmarks[key]?.values || [];
    return values.slice(series.start, series.start + series.dates.length);
  };

  const draw = () => {
    const days = RANGES.find((r) => r.key === rangeKey)?.days ?? 0;
    const port = sliceLastDays(series.dates, series.twr, days);
    const lines = [{
      name: 'Portföyüm',
      values: normalize(port.values),
      color: 'var(--accent)',
      width: 2.4,
    }];
    for (const key of available) {
      if (!selected.has(key)) continue;
      const sliced = sliceLastDays(series.dates, benchSlice(key), days);
      lines.push({
        name: DB.benchmarks[key].label,
        values: normalize(sliced.values),
        color: BENCH_COLORS[key] || colorAt(lines.length),
        width: 1.6,
      });
    }
    lineChart(chartBox, {
      dates: port.dates,
      series: lines,
      height: 300,
      baseline: 100,
      yFormat: (v) => num(v, 0),
      valueFormat: (v) => `${num(v, 1)} (${pctSigned(v - 100, 1)})`,
    });
  };

  const toggles = h('div', { class: 'btn-row' },
    available.map((key) => h('button', {
      class: 'btn btn-sm', type: 'button', 'aria-pressed': 'true',
      style: `border-color:${BENCH_COLORS[key] || 'var(--border)'}`,
      onclick: (e) => {
        const on = selected.has(key);
        if (on) selected.delete(key); else selected.add(key);
        e.currentTarget.setAttribute('aria-pressed', String(!on));
        e.currentTarget.style.opacity = on ? '.45' : '1';
        draw();
      },
    },
    h('span', {
      class: 'swatch',
      style: `width:9px;height:9px;border-radius:3px;background:${BENCH_COLORS[key] || 'var(--text-dim)'};display:inline-block`,
    }),
    DB.benchmarks[key].label)));

  const head = h('div', { class: 'card-head' },
    h('div', {},
      h('h2', {}, 'Getiri Kıyaslaması'),
      h('span', { class: 'sub' }, 'Hepsi dönem başında 100 kabul edilerek karşılaştırılır')),
    rangeSelector(rangeKey, (r) => {
      rangeKey = r.key;
      head.querySelectorAll('.seg button').forEach((b) => {
        b.setAttribute('aria-pressed', b.textContent === r.label ? 'true' : 'false');
      });
      draw();
    }));

  root.append(h('section', { class: 'card' }, head, toggles, chartBox));
  draw();

  /* ------------------------------------------------------------------- tablo */

  const rows = [];
  const addRow = (label, values, color) => {
    const cells = RANGES.map((r) => totalReturn(sliceLastDays(series.dates, values, r.days).values));
    rows.push({ label, cells, color });
  };
  addRow('Portföyüm', series.twr, 'var(--accent)');
  for (const key of available) addRow(DB.benchmarks[key].label, benchSlice(key), BENCH_COLORS[key]);

  const table = h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {},
      h('th', { style: 'text-align:left' }, ''),
      RANGES.map((r) => h('th', {}, r.label === 'Tümü' ? 'Tümü' : r.label)))),
    h('tbody', {}, rows.map((row) => h('tr', {},
      h('td', {},
        h('span', {
          class: 'swatch',
          style: `width:9px;height:9px;border-radius:3px;background:${row.color};display:inline-block;margin-right:7px`,
        }),
        row.label),
      row.cells.map((v) => h('td', { class: cls(v) }, pctSigned(v, 1))))))));

  root.append(sectionCard('Dönemsel Getiriler',
    'Portföy satırı zaman ağırlıklıdır (para giriş/çıkışından arındırılmış)', table));

  /* --------------------------------------------------- karşı-olgusal senaryo */

  const txs = transactions();
  const senaryolar = [];
  for (const key of available) {
    const seri = DB.benchmarks[key]?.values || [];
    const sonuc = counterfactual(txs, seri);
    if (sonuc) senaryolar.push({ key, label: DB.benchmarks[key].label, ...sonuc });
  }

  if (senaryolar.length && analysis.totals.value > 0) {
    const gercek = {
      label: 'Portföyüm (gerçek)',
      value: analysis.totals.value,
      invested: analysis.totals.netInvested,
      gain: analysis.totals.totalPL,
      gainPct: analysis.totals.totalPct,
    };
    const satirlar = [gercek, ...senaryolar.sort((a, b) => b.value - a.value)];
    const enIyi = Math.max(...satirlar.map((x) => x.value));

    root.append(sectionCard('Aynı Parayı Başka Yere Koysaydım',
      'Senin gerçek yatırım tarihlerin ve tutarlarınla',
      h('p', { class: 'dim', style: 'margin:0 0 12px;font-size:.85rem' },
        'Her satır, tam olarak senin yaptığın tarihlerde ve tutarlarda o varlığı '
        + 'almış olsaydın bugün elinde ne olacağını gösterir. Nakit akışları aynı '
        + 'olduğu için doğrudan karşılaştırılabilir.'),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {},
          h('th', { style: 'text-align:left' }, 'Senaryo'),
          h('th', {}, 'Bugünkü değer'), h('th', {}, 'Kazanç'), h('th', {}, 'Getiri'),
          h('th', {}, 'Fark'))),
        h('tbody', {}, satirlar.map((x, i) => h('tr', {
          style: i === 0 ? 'font-weight:650;background:var(--accent-soft)' : null,
        },
        h('td', {},
          h('span', {
            class: 'swatch',
            style: 'width:9px;height:9px;border-radius:3px;display:inline-block;margin-right:7px;'
              + `background:${i === 0 ? 'var(--accent)' : (BENCH_COLORS[x.key] || 'var(--text-dim)')}`,
          }),
          x.label),
        h('td', {}, tl(x.value)),
        h('td', { class: cls(x.gain) }, tlSigned(x.gain)),
        h('td', { class: cls(x.gainPct) }, pctSigned(x.gainPct, 1)),
        h('td', { class: cls(x.value - enIyi) },
          x.value === enIyi ? '—' : tlSigned(x.value - enIyi)))))))));
  }

  /* ----------------------------------------------------------------- açıklama */

  root.append(h('div', { class: 'notice' },
    h('div', {}, h('b', {}, 'Neden iki farklı getiri var?')),
    h('div', { style: 'margin-top:5px' },
      'Buradaki portföy getirisi ', h('b', {}, 'zaman ağırlıklıdır'),
      ': ne zaman para eklediğinden bağımsız olarak fon seçimlerinin performansını ölçer, '
      + 'bu yüzden endekslerle adil kıyaslanır. Panel sekmesindeki ',
      h('b', {}, 'XIRR'),
      ' ise para ağırlıklıdır: paranın ne zaman girdiğini de hesaba katar, yani cebindeki '
      + 'gerçek yıllık getiriyi verir.'),
    !available.includes('TUFE')
      ? h('div', { style: 'margin-top:8px' },
        'Enflasyon (TÜFE) kıyası şu an kapalı. Açmak için depo ayarlarına ücretsiz bir '
        + 'EVDS API anahtarı eklemen yeterli - README\'de anlatılıyor.')
      : null));

  return root;
}
