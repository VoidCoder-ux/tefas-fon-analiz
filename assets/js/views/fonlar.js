/* Fonlar: arama, risk-getiri haritası, karşılaştırma ve fon detayı. */

import {
  h, bigTL, pct, pctSigned, money, num, cls, isNum, colorAt, debounce, openModal,
  fmtDate, addDays, toast,
} from '../util.js';
import {
  DB, loadHistory, loadHistories, cachedHistory, priceAtIndex, lastIndex, indexForDate,
} from '../data.js';
import { lineChart, donutWithLegend, scatterChart, correlationTable } from '../charts.js';
import { dailyReturns, correlation } from '../portfolio.js';
import { rollingReturns } from '../insights.js';
import { sectionCard, sortableTable, RANGES } from './common.js';

const PAGE_SIZE = 60;
const MAX_KARSILASTIRMA = 5;

/** Fonun kendi kategorisi içindeki yerini anlatan kısa cümle. */
function yuzdelikMetni(fund) {
  const p = fund.pct?.['1y'];
  if (!isNum(p) || !fund.catRanked) return null;
  return `${fund.cat} kategorisindeki ${fund.catRanked} fon içinde 1 yıllık getiride `
    + `${fund.catRank}. sırada (yüzde ${p.toFixed(0)}'lik dilim).`;
}

/* ------------------------------------------------------------ fon detay penceresi */

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

  const yuzdelik = yuzdelikMetni(fund);
  if (yuzdelik) {
    body.append(h('div', { class: 'notice' },
      h('b', {}, 'Kategorisindeki yeri: '), yuzdelik,
      isNum(fund.pct?.vol)
        ? ` Oynaklıkta yüzde ${fund.pct.vol.toFixed(0)}'lik dilimde (yüksek dilim = daha dalgalı).`
        : ''));
  }

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

  /* Yuvarlanan getiri: tek bir dönemin şansını tutarlılıktan ayırır. */
  const tarihler = [], fiyatlar = [];
  for (let i = hist.i; i <= end; i++) {
    tarihler.push(DB.calendar[i]);
    fiyatlar.push(priceAtIndex(hist, i));
  }
  const yuvarlanan = rollingReturns(tarihler, fiyatlar, 365);
  if (yuvarlanan) {
    body.append(sectionCard('Yuvarlanan 1 Yıllık Getiri',
      `${yuvarlanan.count} farklı 1 yıllık dönem üzerinden`,
      h('p', { class: 'dim', style: 'margin:0 0 12px;font-size:.85rem' },
        'Tek bir "1 yıllık getiri" rakamı, hangi güne baktığına göre çok değişir. '
        + 'Bu tablo geçmişteki tüm 1 yıllık dönemleri gösterir: en iyi ile en kötü '
        + 'arasındaki fark ne kadar büyükse, fonun sonucu o kadar zamanlamaya bağlı.'),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {},
          h('th', { style: 'text-align:center' }, 'En kötü'),
          h('th', { style: 'text-align:center' }, 'Ortanca'),
          h('th', { style: 'text-align:center' }, 'En iyi'),
          h('th', { style: 'text-align:center' }, 'Kazançlı dönem oranı'))),
        h('tbody', {}, h('tr', {},
          h('td', { class: cls(yuvarlanan.worst), style: 'text-align:center' },
            pctSigned(yuvarlanan.worst, 1)),
          h('td', { class: cls(yuvarlanan.median), style: 'text-align:center' },
            pctSigned(yuvarlanan.median, 1)),
          h('td', { class: cls(yuvarlanan.best), style: 'text-align:center' },
            pctSigned(yuvarlanan.best, 1)),
          h('td', { style: 'text-align:center' }, pct(yuvarlanan.positiveShare, 0))))))));
  }

  const allocItems = Object.entries(fund.alloc || {})
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], i) => ({ label, value, color: colorAt(i) }));

  body.append(h('div', { class: 'grid grid-2' },
    allocItems.length
      ? sectionCard('Varlık Dağılımı', 'Fonun portföyü', donutWithLegend(allocItems, {
        centerTop: `${allocItems.length}`, centerBottom: 'varlık sınıfı',
        format: (v) => `%${v.toFixed(1)}`,
      }))
      : null,
    sectionCard('Fon Bilgileri', null,
      h('div', { class: 'table-wrap' }, h('table', {}, h('tbody', {},
        h('tr', {}, h('td', {}, 'Kategori'), h('td', {},
          fund.cat,
          h('span', { class: 'pill', style: 'margin-left:6px' },
            fund.catSrc === 'tefas' ? 'TEFAS resmi' : 'ünvandan'))),
        h('tr', {}, h('td', {}, 'Tip'), h('td', {},
          { YAT: 'Yatırım Fonu', EMK: 'Emeklilik Fonu', BYF: 'Borsa Yatırım Fonu' }[fund.kind]
          || fund.kind)),
        h('tr', {}, h('td', {}, 'Portföy Büyüklüğü'), h('td', {}, bigTL(fund.size))),
        h('tr', {}, h('td', {}, 'Yatırımcı Sayısı'), h('td', {},
          isNum(fund.inv) ? new Intl.NumberFormat('tr-TR').format(fund.inv) : '—')),
        h('tr', {}, h('td', {}, 'TEFAS Sayfası'), h('td', {},
          h('a', {
            href: `https://www.tefas.gov.tr/FonAnaliz.aspx?FonKod=${encodeURIComponent(fund.code)}`,
            target: '_blank', rel: 'noopener noreferrer', style: 'color:var(--accent)',
          }, 'aç ↗')))))))));

  body.append(h('div', { class: 'btn-row', style: 'justify-content:flex-end' },
    h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Kapat'),
    h('button', {
      class: 'btn btn-primary', type: 'button',
      onclick: () => { close(); ctx.navigate('islemler', { code }); },
    }, 'Bu fona işlem ekle')));
}

/* ---------------------------------------------------------- karşılaştırma ekranı */

async function showComparison(codes, ctx) {
  const fonlar = codes.map((c) => DB.byCode.get(c)).filter(Boolean);
  if (fonlar.length < 2) return;

  const body = h('div', { class: 'stack' });
  openModal(`${fonlar.length} Fon Karşılaştırması`, body, { wide: true });
  const chartBox = h('div', { class: 'chart' });

  let rangeKey = '1y';
  const head = h('div', { class: 'card-head' },
    h('div', {}, h('h3', {}, 'Getiri Karşılaştırması'),
      h('span', { class: 'sub' }, 'Dönem başı 100 kabul edilerek')),
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

  await loadHistories(codes);
  const end = lastIndex();

  function draw() {
    const days = RANGES.find((r) => r.key === rangeKey)?.days ?? 0;
    const from = days
      ? Math.max(0, indexForDate(addDays(DB.calendar[end], -days)))
      : Math.min(...fonlar.map((f) => f.i0 ?? 0));
    const dates = [];
    for (let i = from; i <= end; i++) dates.push(DB.calendar[i]);

    const seriler = fonlar.map((f, k) => {
      const hist = cachedHistory(f.code);
      const ham = [];
      for (let i = from; i <= end; i++) ham.push(priceAtIndex(hist, i));
      const taban = ham.find((v) => isNum(v) && v > 0);
      return {
        name: f.code,
        color: colorAt(k),
        values: ham.map((v) => (isNum(v) && isNum(taban) && taban > 0 ? (v / taban) * 100 : null)),
      };
    });
    lineChart(chartBox, {
      dates, series: seriler, height: 300, baseline: 100,
      yFormat: (v) => num(v, 0),
      valueFormat: (v) => `${num(v, 1)} (${pctSigned(v - 100, 1)})`,
    });
  }
  draw();

  body.append(sectionCard('Metrikler', null,
    h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {},
        h('th', { style: 'text-align:left' }, 'Fon'),
        h('th', { style: 'text-align:left' }, 'Kategori'),
        h('th', {}, '1 Ay'), h('th', {}, '1 Yıl'), h('th', {}, '3 Yıl'),
        h('th', {}, 'Oynaklık'), h('th', {}, 'Maks. Düşüş'), h('th', {}, 'Büyüklük'))),
      h('tbody', {}, fonlar.map((f, k) => h('tr', {},
        h('td', {},
          h('span', {
            class: 'swatch',
            style: 'width:9px;height:9px;border-radius:3px;display:inline-block;'
              + `margin-right:7px;background:${colorAt(k)}`,
          }),
          h('span', { class: 'code-chip' }, f.code)),
        h('td', { style: 'text-align:left' }, f.cat),
        h('td', { class: cls(f.ret?.['1a']) }, pctSigned(f.ret?.['1a'], 1)),
        h('td', { class: cls(f.ret?.['1y']) }, pctSigned(f.ret?.['1y'], 1)),
        h('td', { class: cls(f.ret?.['3y']) }, pctSigned(f.ret?.['3y'], 1)),
        h('td', {}, isNum(f.vol) ? pct(f.vol, 1) : '—'),
        h('td', { class: 'down' }, isNum(f.mdd) ? pct(f.mdd, 1) : '—'),
        h('td', {}, bigTL(f.size)))))))));

  // Birlikte hareket eden fonlar çeşitlendirme sağlamaz; korelasyonu göster.
  const bas = Math.max(0, end - 260);
  const getiriler = fonlar.map((f) => {
    const hist = cachedHistory(f.code);
    const fiyatlar = [];
    for (let i = bas; i <= end; i++) fiyatlar.push(priceAtIndex(hist, i));
    return dailyReturns(fiyatlar);
  });
  const matris = fonlar.map((_, i) => fonlar.map((__, j) => (
    i === j ? 1 : correlation(getiriler[i], getiriler[j])
  )));
  body.append(sectionCard('Aralarındaki Korelasyon',
    "Son 1 yıl · 1'e yakın = aynı yöne hareket eder",
    correlationTable(fonlar.map((f) => f.code), matris)));
}

/* ------------------------------------------------------------------ fon listesi */

export function renderFonlar(ctx) {
  const root = h('div', { class: 'stack' });
  const categories = [...new Set(DB.funds.map((f) => f.cat))]
    .sort((a, b) => a.localeCompare(b, 'tr'));
  const kinds = [...new Set(DB.funds.map((f) => f.kind))];

  const state = { query: '', cat: '', kind: '', limit: PAGE_SIZE, onlyMine: false };
  const mine = new Set((ctx.analysis?.open || []).map((x) => x.code));
  const secili = new Set();

  const search = h('input', {
    type: 'search', placeholder: 'Fon kodu veya ünvan ara…',
    style: 'min-width:200px;flex:1 1 220px',
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
  const compareBar = h('div', { style: 'display:none' });

  /* --------------------------------------------------------- risk-getiri haritası */

  const scatterBox = h('div', { class: 'chart' });
  const scatterBilgi = h('span', { class: 'sub' });

  const cizHarita = () => {
    const noktalar = DB.funds
      .filter((f) => isNum(f.vol) && isNum(f.ret?.['1y']))
      .filter((f) => (!state.cat || f.cat === state.cat))
      .filter((f) => (!state.kind || f.kind === state.kind))
      .map((f) => ({
        x: f.vol, y: f.ret['1y'], label: f.code,
        highlight: mine.has(f.code), code: f.code,
      }));
    scatterBilgi.textContent = `${noktalar.length} fon`
      + (mine.size ? ' · vurgulu noktalar senin fonların' : '');
    scatterChart(scatterBox, {
      points: noktalar,
      xLabel: 'Yıllık oynaklık',
      yLabel: '1 yıllık getiri',
      onPick: (p) => showFundDetail(p.code, ctx),
    });
  };

  root.append(h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', {}, 'Risk-Getiri Haritası'), scatterBilgi)),
    h('p', { class: 'dim', style: 'margin:0 0 10px;font-size:.85rem' },
      'Sağa gidildikçe risk (oynaklık), yukarı çıkıldıkça getiri artar. Sol üst bölge '
      + 'aynı riskle daha çok kazandıran fonları gösterir. Aşağıdaki kategori ve tip '
      + 'filtreleri bu haritayı da daraltır; bir noktaya tıklayınca fon detayı açılır.'),
    scatterBox));

  /* ------------------------------------------------------------------- tablo */

  function cizCompareBar() {
    if (!secili.size) { compareBar.style.display = 'none'; return; }
    compareBar.style.display = '';
    compareBar.replaceChildren(h('div', {
      class: 'notice',
      style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap',
    },
    h('span', {}, `${secili.size} fon seçildi: `, h('b', {}, [...secili].join(', '))),
    h('button', {
      class: 'btn btn-sm btn-primary', type: 'button',
      disabled: secili.size < 2,
      onclick: () => showComparison([...secili], ctx),
    }, 'Karşılaştır'),
    h('button', {
      class: 'btn btn-sm', type: 'button',
      onclick: () => { secili.clear(); cizCompareBar(); apply(); },
    }, 'Temizle')));
  }

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
          key: 'sec', label: '', sortable: false,
          render: (f) => {
            const kutu = h('input', {
              type: 'checkbox',
              style: 'width:16px;height:16px;min-height:0;cursor:pointer',
            });
            kutu.checked = secili.has(f.code);
            kutu.addEventListener('click', (e) => e.stopPropagation());
            kutu.addEventListener('change', () => {
              if (kutu.checked) {
                if (secili.size >= MAX_KARSILASTIRMA) {
                  kutu.checked = false;
                  toast(`En fazla ${MAX_KARSILASTIRMA} fon karşılaştırılabilir`);
                  return;
                }
                secili.add(f.code);
              } else secili.delete(f.code);
              cizCompareBar();
            });
            return kutu;
          },
        },
        {
          key: 'code', label: 'Kod', defaultDir: 'asc',
          render: (f) => h('span', {},
            h('span', { class: 'code-chip' }, f.code),
            mine.has(f.code)
              ? h('span', { class: 'pill up', style: 'margin-left:6px' }, 'portföyümde') : null,
            f.date !== DB.meta.lastDataDate
              ? h('span', {
                class: 'pill', style: 'margin-left:6px', title: `Son fiyat ${f.date}`,
              }, 'kapanmış')
              : null),
        },
        {
          key: 'name', label: 'Ünvan', defaultDir: 'asc', align: 'left',
          render: (f) => h('span', { title: f.name }, f.name),
          cellClass: () => 'name',
        },
        { key: 'cat', label: 'Kategori', defaultDir: 'asc', align: 'left' },
        { key: 'price', label: 'Fiyat', render: (f) => money(f.price, 4) },
        {
          key: 'chg', label: 'Günlük',
          render: (f) => h('span', { class: cls(f.chg) }, pctSigned(f.chg)),
        },
        {
          key: 'r1a', label: '1 Ay', sortValue: (f) => f.ret?.['1a'],
          render: (f) => h('span', { class: cls(f.ret?.['1a']) }, pctSigned(f.ret?.['1a'], 1)),
        },
        {
          key: 'r1y', label: '1 Yıl', sortValue: (f) => f.ret?.['1y'],
          render: (f) => h('span', { class: cls(f.ret?.['1y']) }, pctSigned(f.ret?.['1y'], 1)),
        },
        {
          key: 'pct1y', label: 'Kategori sırası', sortValue: (f) => f.pct?.['1y'],
          title: 'Kendi kategorisi içindeki 1 yıllık getiri sırası',
          render: (f) => (isNum(f.pct?.['1y']) && f.catRanked
            ? h('span', { title: yuzdelikMetni(f) || '' },
              `${f.catRank}/${f.catRanked}`,
              h('span', { class: 'dim', style: 'font-size:.76rem;margin-left:5px' },
                `%${f.pct['1y'].toFixed(0)}`))
            : '—'),
        },
        {
          key: 'r3y', label: '3 Yıl', sortValue: (f) => f.ret?.['3y'],
          render: (f) => h('span', { class: cls(f.ret?.['3y']) }, pctSigned(f.ret?.['3y'], 1)),
        },
        { key: 'vol', label: 'Oynaklık', render: (f) => (isNum(f.vol) ? pct(f.vol, 1) : '—') },
        {
          key: 'mdd', label: 'Maks. Düşüş',
          render: (f) => h('span', { class: isNum(f.mdd) ? 'down' : '' },
            isNum(f.mdd) ? pct(f.mdd, 1) : '—'),
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
  catSel.addEventListener('change', () => {
    state.cat = catSel.value; state.limit = PAGE_SIZE; apply(); cizHarita();
  });
  kindSel.addEventListener('change', () => {
    state.kind = kindSel.value; state.limit = PAGE_SIZE; apply(); cizHarita();
  });
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
    h('p', { class: 'dim', style: 'margin:0 0 10px;font-size:.83rem' },
      `Karşılaştırmak için soldaki kutuları işaretle (en fazla ${MAX_KARSILASTIRMA} fon). `
      + '"Kategori sırası" sütunu, fonun kendi kategorisindeki yerini gösterir.'),
    compareBar,
    tableBox));

  apply();
  cizHarita();
  return root;
}
