/* Yatırımcıya karar verdiren analizler.

   Buradaki her fonksiyon veriden hesaplanan bir OLGU üretir: tahmin, puanlama
   veya öneri yoktur. Hepsi elle doğrulanabilir aritmetiktir.

   portfolio.js pozisyon ve getiri çekirdeğini tutar; bu modül onun üzerine
   kurulan ikincil analizleri barındırır. */

import { DB, cachedHistory, priceAtIndex, exactPriceAtIndex, indexForDate, lastIndex }
  from './data.js';
import { isNum } from './util.js';
import { correlation, dailyReturns } from './portfolio.js';

const EPS = 1e-9;

/* ------------------------------------------------------------ takvim getirileri */

/**
 * TWR serisini aylara böler.
 * Bir ayın getirisi: ayın son değeri / önceki ayın son değeri - 1.
 * @returns {{year:number, month:number, ret:number}[]}
 */
export function monthlyReturns(dates, twr) {
  if (!dates?.length) return [];
  const sonDeger = new Map();                 // "YYYY-MM" -> ayın son TWR değeri
  const sira = [];
  for (let i = 0; i < dates.length; i++) {
    if (!isNum(twr[i])) continue;
    const ay = dates[i].slice(0, 7);
    if (!sonDeger.has(ay)) sira.push(ay);
    sonDeger.set(ay, twr[i]);
  }
  const out = [];
  let taban = twr.find(isNum);                // serinin başlangıç değeri (100)
  for (const ay of sira) {
    const deger = sonDeger.get(ay);
    if (isNum(taban) && taban > EPS) {
      const [y, m] = ay.split('-').map(Number);
      out.push({ year: y, month: m, ret: (deger / taban - 1) * 100 });
    }
    taban = deger;
  }
  return out;
}

/** Yıl bazında bileşik getiri (aylık getirilerden). */
export function yearlyFromMonthly(aylik) {
  const yillar = new Map();
  for (const a of aylik) {
    const carpan = 1 + a.ret / 100;
    yillar.set(a.year, (yillar.get(a.year) ?? 1) * carpan);
  }
  return [...yillar.entries()].map(([year, c]) => ({ year, ret: (c - 1) * 100 }));
}

/* ------------------------------------------------------------------ düşüşler */

/**
 * Zirveden düşüş dönemlerini çıkarır.
 *
 * Bir dönem, seri son zirvesinin altına indiğinde başlar ve o zirveyi geri
 * aldığında biter. Toparlanmamış dönem için `recovered:false` döner.
 * @returns en derinden başlayarak sıralı dönemler
 */
export function drawdownEpisodes(dates, values, limit = 5) {
  const donemler = [];
  let zirve = null, zirveIdx = 0, aktif = null;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!isNum(v) || v <= 0) continue;
    if (zirve === null || v >= zirve) {
      if (aktif) {
        aktif.recovered = true;
        aktif.recoveryDate = dates[i];
        aktif.recoveryDays = gunFarki(aktif.troughDate, dates[i]);
        donemler.push(aktif);
        aktif = null;
      }
      zirve = v; zirveIdx = i;
      continue;
    }
    const dusus = (v / zirve - 1) * 100;
    if (!aktif) {
      aktif = {
        peakDate: dates[zirveIdx], peakValue: zirve,
        troughDate: dates[i], troughValue: v, depth: dusus,
        recovered: false, recoveryDate: null, recoveryDays: null,
      };
    } else if (dusus < aktif.depth) {
      aktif.depth = dusus;
      aktif.troughDate = dates[i];
      aktif.troughValue = v;
    }
  }
  if (aktif) {
    aktif.recoveryDays = gunFarki(aktif.troughDate, dates[dates.length - 1]);
    donemler.push(aktif);
  }
  return donemler
    .sort((a, b) => a.depth - b.depth)
    .slice(0, limit)
    .map((d) => ({ ...d, durationDays: gunFarki(d.peakDate, d.recoveryDate || d.troughDate) }));
}

const gunFarki = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

/* --------------------------------------------------------------- katkı analizi */

/**
 * Toplam getirinin kaç puanının hangi fondan geldiği.
 * Katkı = fonun toplam kâr/zararı / net yatırılan anapara.
 * Katkıların toplamı, panelde gösterilen toplam yüzdeye eşittir.
 */
export function attribution(holdings, netInvested) {
  if (!(netInvested > EPS)) return [];
  return holdings
    .filter((h) => isNum(h.totalPL) && Math.abs(h.totalPL) > 0.005)
    .map((h) => ({
      code: h.code, name: h.name, amount: h.totalPL,
      points: (h.totalPL / netInvested) * 100,
    }))
    .sort((a, b) => b.points - a.points);
}

/* ------------------------------------------------------------ zamanlama kalitesi */

/**
 * Alım fiyatlarını, elde tutulan dönemin ortalama piyasa fiyatıyla karşılaştırır.
 *
 * Negatif fark = ortalamanın altında alım (iyi zamanlama), pozitif = üstünde.
 * Yalnızca alışlar dikkate alınır; dönem, ilk alımdan bugüne kadardır.
 */
export function timingQuality(txs) {
  const fonlar = new Map();
  for (const t of txs) {
    if (t.type === 'SAT' || !isNum(t.units) || !isNum(t.price)) continue;
    const f = fonlar.get(t.code) || { adet: 0, tutar: 0, ilkIdx: Infinity };
    f.adet += t.units;
    f.tutar += t.units * t.price;
    f.ilkIdx = Math.min(f.ilkIdx, Math.max(0, indexForDate(t.date)));
    fonlar.set(t.code, f);
  }

  const son = lastIndex();
  const out = [];
  for (const [code, f] of fonlar) {
    if (!(f.adet > EPS) || !Number.isFinite(f.ilkIdx)) continue;
    const hist = cachedHistory(code);
    if (!hist) continue;
    let toplam = 0, sayi = 0;
    for (let i = f.ilkIdx; i <= son; i++) {
      const p = priceAtIndex(hist, i);
      if (isNum(p) && p > 0) { toplam += p; sayi += 1; }
    }
    if (sayi < 5) continue;
    const ortalamaPiyasa = toplam / sayi;
    const ortalamaMaliyet = f.tutar / f.adet;
    out.push({
      code,
      avgCost: ortalamaMaliyet,
      avgMarket: ortalamaPiyasa,
      diffPct: (ortalamaMaliyet / ortalamaPiyasa - 1) * 100,
      invested: f.tutar,
      days: son - f.ilkIdx,
    });
  }
  return out.sort((a, b) => a.diffPct - b.diffPct);
}

/* --------------------------------------------------------------- nakit akışı */

/** Ay bazında net yatırılan tutar ve yıl bazında gerçekleşen kâr/zarar. */
export function cashflowCalendar(txs) {
  const aylik = new Map();
  const gerceklesenYil = new Map();
  const pozisyon = new Map();                 // ortalama maliyet takibi

  for (const t of [...txs].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    if (!isNum(t.units) || !isNum(t.price)) continue;
    const ay = t.date.slice(0, 7);
    const yil = Number(t.date.slice(0, 4));
    const masraf = Number(t.fee) || 0;
    const p = pozisyon.get(t.code) || { adet: 0, maliyet: 0 };

    if (t.type === 'SAT') {
      const miktar = Math.min(t.units, p.adet);
      const ortalama = p.adet > EPS ? p.maliyet / p.adet : 0;
      const kar = miktar * t.price - masraf - miktar * ortalama;
      gerceklesenYil.set(yil, (gerceklesenYil.get(yil) || 0) + kar);
      p.maliyet = Math.max(0, p.maliyet - miktar * ortalama);
      p.adet = Math.max(0, p.adet - miktar);
      aylik.set(ay, (aylik.get(ay) || 0) - (miktar * t.price - masraf));
    } else {
      p.maliyet += t.units * t.price + masraf;
      p.adet += t.units;
      aylik.set(ay, (aylik.get(ay) || 0) + t.units * t.price + masraf);
    }
    pozisyon.set(t.code, p);
  }

  return {
    monthly: [...aylik.entries()].sort().map(([month, amount]) => ({ month, amount })),
    realizedByYear: [...gerceklesenYil.entries()].sort().map(([year, amount]) => ({ year, amount })),
  };
}

/* ------------------------------------------------------------ ağırlık kayması */

/**
 * Zaman içinde fon ağırlıkları. Grafiğin okunabilir kalması için en büyük
 * `topN` fon ayrı ayrı, kalanlar "Diğer" altında toplanır.
 */
export function weightHistory(txs, seriesStart, dates, topN = 6) {
  if (!dates?.length) return { codes: [], rows: [] };

  const byIdx = new Map();
  for (const t of txs) {
    const idx = Math.max(0, indexForDate(t.date));
    if (!byIdx.has(idx)) byIdx.set(idx, []);
    byIdx.get(idx).push(t);
  }

  const adetler = new Map();
  const satirlar = [];
  for (let k = 0; k < dates.length; k++) {
    const idx = seriesStart + k;
    for (const t of byIdx.get(idx) || []) {
      const mevcut = adetler.get(t.code) || 0;
      adetler.set(t.code, t.type === 'SAT'
        ? Math.max(0, mevcut - t.units) : mevcut + t.units);
    }
    const degerler = new Map();
    let toplam = 0;
    for (const [code, adet] of adetler) {
      if (adet <= EPS) continue;
      const p = priceAtIndex(cachedHistory(code), idx);
      if (!isNum(p)) continue;
      const d = adet * p;
      degerler.set(code, d);
      toplam += d;
    }
    satirlar.push({ date: dates[k], total: toplam, values: degerler });
  }

  // En büyük ağırlığa göre ilk topN fonu seç (son gündeki değere göre).
  const sonuncu = satirlar[satirlar.length - 1]?.values || new Map();
  const secilen = [...sonuncu.entries()].sort((a, b) => b[1] - a[1])
    .slice(0, topN).map(([c]) => c);

  const rows = satirlar.map((s) => {
    const pay = {};
    let digerToplam = 0;
    for (const [code, d] of s.values) {
      if (secilen.includes(code)) pay[code] = s.total > EPS ? (d / s.total) * 100 : 0;
      else digerToplam += d;
    }
    if (digerToplam > 0) pay['Diğer'] = s.total > EPS ? (digerToplam / s.total) * 100 : 0;
    return { date: s.date, shares: pay };
  });

  const codes = [...secilen];
  if (rows.some((r) => r.shares['Diğer'] > 0)) codes.push('Diğer');
  return { codes, rows };
}

/* ------------------------------------------------------- çeşitlendirme ölçüsü */

/**
 * Portföyün kaç bağımsız bahse denk geldiği.
 *
 * `hhi`   : ağırlık yoğunlaşmasından, korelasyonu yok sayar (1/Σw²).
 * `effN`  : korelasyonla düzeltilmiş (1/(w'Cw)); birlikte hareket eden fonlar
 *           tek bahis gibi sayılır. Gerçek çeşitlendirmeyi bu gösterir.
 */
export function diversification(holdings, pencere = 260) {
  const acik = holdings.filter((h) => h.value > EPS);
  if (acik.length === 0) return null;
  const toplam = acik.reduce((s, h) => s + h.value, 0);
  const w = acik.map((h) => h.value / toplam);
  const hhi = 1 / w.reduce((s, x) => s + x * x, 0);
  if (acik.length === 1) return { hhi, effN: 1, codes: acik.map((h) => h.code) };

  const son = lastIndex();
  const bas = Math.max(0, son - pencere);
  const getiriler = acik.map((h) => {
    const hist = cachedHistory(h.code);
    const fiyatlar = [];
    for (let i = bas; i <= son; i++) fiyatlar.push(priceAtIndex(hist, i));
    return dailyReturns(fiyatlar);
  });

  let wCw = 0;
  for (let i = 0; i < w.length; i++) {
    for (let j = 0; j < w.length; j++) {
      const c = i === j ? 1 : (correlation(getiriler[i], getiriler[j]) ?? 0);
      wCw += w[i] * w[j] * c;
    }
  }
  return {
    hhi,
    effN: wCw > EPS ? 1 / wCw : null,
    codes: acik.map((h) => h.code),
  };
}

/* ------------------------------------------------------- yuvarlanan getiriler */

/**
 * Serideki tüm `windowDays` günlük pencerelerin getirisi.
 * Tek bir dönemin şansını, tutarlı performanstan ayırmak için kullanılır.
 */
export function rollingReturns(dates, values, windowDays = 365) {
  if (!dates?.length) return null;
  const sonuc = [];
  let j = 0;
  for (let i = 0; i < dates.length; i++) {
    if (!isNum(values[i]) || values[i] <= 0) continue;
    const hedef = new Date(dates[i]);
    hedef.setDate(hedef.getDate() - windowDays);
    const hedefISO = hedef.toISOString().slice(0, 10);
    while (j < i && dates[j] < hedefISO) j += 1;
    if (dates[j] > hedefISO || j >= i) continue;
    const taban = values[j];
    if (isNum(taban) && taban > 0) sonuc.push((values[i] / taban - 1) * 100);
  }
  if (sonuc.length < 5) return null;
  const sirali = [...sonuc].sort((a, b) => a - b);
  const ortanca = sirali.length % 2
    ? sirali[(sirali.length - 1) / 2]
    : (sirali[sirali.length / 2 - 1] + sirali[sirali.length / 2]) / 2;
  return {
    count: sonuc.length,
    best: sirali[sirali.length - 1],
    worst: sirali[0],
    median: ortanca,
    positiveShare: (sonuc.filter((r) => r > 0).length / sonuc.length) * 100,
  };
}

/* ------------------------------------------------------- karşı-olgusal senaryo */

/**
 * "Aynı parayı, aynı tarihlerde X'e koysaydım ne olurdu?"
 *
 * Senin gerçek nakit akışların (alışlar para girişi, satışlar çıkış) kıyas
 * varlığına uygulanır. Portföyünle aynı para akışını kullandığı için sonuç
 * doğrudan karşılaştırılabilir.
 */
export function counterfactual(txs, benchValues) {
  let birim = 0;
  let yatirilan = 0;
  let gecerli = false;

  for (const t of [...txs].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    if (!isNum(t.units) || !isNum(t.price)) continue;
    const idx = Math.max(0, indexForDate(t.date));
    const fiyat = benchValues[idx];
    if (!isNum(fiyat) || fiyat <= 0) continue;
    gecerli = true;
    const masraf = Number(t.fee) || 0;
    if (t.type === 'SAT') {
      const tutar = t.units * t.price - masraf;
      birim = Math.max(0, birim - tutar / fiyat);
      yatirilan -= tutar;
    } else {
      const tutar = t.units * t.price + masraf;
      birim += tutar / fiyat;
      yatirilan += tutar;
    }
  }
  if (!gecerli) return null;

  const sonFiyat = [...benchValues].reverse().find((v) => isNum(v) && v > 0);
  if (!isNum(sonFiyat)) return null;
  const deger = birim * sonFiyat;
  return {
    value: deger,
    invested: yatirilan,
    gain: deger - yatirilan,
    gainPct: yatirilan > EPS ? ((deger - yatirilan) / yatirilan) * 100 : null,
  };
}

/* --------------------------------------------------------- tutarlılık denetimi */

/** Girilen fiyatın TEFAS fiyatından bu orandan fazla sapması şüpheli sayılır. */
const FIYAT_SAPMA_ESIGI = 0.05;

/**
 * İşlem kayıtlarındaki olası hataları bulur: yazım yanlışı, mükerrer kayıt,
 * fon kurulmadan önceki tarih. Hiçbiri veriyi değiştirmez, yalnızca uyarır.
 */
export function consistencyChecks(txs) {
  const uyarilar = [];
  const gorulen = new Map();

  for (const t of txs) {
    if (!t.code || !isNum(t.units) || !isNum(t.price)) continue;

    // 1) Mükerrer kayıt: aynı fon, tarih, adet ve fiyat
    const anahtar = `${t.code}|${t.date}|${t.units}|${t.price}`;
    if (gorulen.has(anahtar)) {
      uyarilar.push({ type: 'mukerrer', code: t.code, date: t.date,
        message: `${t.code} · ${t.date}: birebir aynı işlem iki kez girilmiş olabilir.` });
    }
    gorulen.set(anahtar, true);

    const idx = indexForDate(t.date);
    const hist = cachedHistory(t.code);
    if (!hist) continue;

    // 2) Fonun verisi başlamadan önceki tarih
    if (idx >= 0 && idx < hist.i) {
      uyarilar.push({ type: 'erken', code: t.code, date: t.date,
        message: `${t.code} · ${t.date}: bu tarihte fonun TEFAS'ta fiyatı yok.` });
      continue;
    }

    // 3) Girilen fiyat, o günün gerçek fiyatından belirgin sapıyor
    const gercek = idx >= 0 ? exactPriceAtIndex(hist, idx) : null;
    if (isNum(gercek) && gercek > 0) {
      const sapma = Math.abs(t.price / gercek - 1);
      if (sapma > FIYAT_SAPMA_ESIGI) {
        uyarilar.push({ type: 'fiyat', code: t.code, date: t.date, entered: t.price,
          actual: gercek, deviation: sapma * 100,
          message: `${t.code} · ${t.date}: girdiğin fiyat ${t.price}, TEFAS fiyatı `
            + `${gercek}. Yazım hatası olabilir.` });
      }
    }
  }
  return uyarilar;
}
