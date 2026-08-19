/* Portföy hesaplamaları.

   Maliyet yöntemi: ağırlıklı ortalama maliyet. Türkiye'de banka ve TEFAS
   ekstreleri pozisyonu bu şekilde gösterdiği için varsayılan budur.

   Getiri iki ayrı şekilde raporlanır:
     * TWR (zaman ağırlıklı) - para giriş/çıkışlarının etkisini arındırır,
       BIST 100 gibi endekslerle adil kıyas için kullanılır.
     * XIRR (para ağırlıklı) - senin gerçek yıllık getirin; ne zaman ne kadar
       para koyduğunu dikkate alır.
*/

import { DB, loadHistories, cachedHistory, priceAtIndex, indexForDate, lastIndex } from './data.js';
import { isNum } from './util.js';

const EPS = 1e-9;

/** İşlemlerden pozisyonları çıkarır (ağırlıklı ortalama maliyet). */
export function buildPositions(txs) {
  const pos = new Map();
  const get = (code) => {
    if (!pos.has(code)) {
      pos.set(code, {
        code, units: 0, cost: 0, realized: 0, fees: 0,
        bought: 0, sold: 0, firstDate: null, lastDate: null, oversold: false,
      });
    }
    return pos.get(code);
  };

  for (const t of txs) {
    if (!t.code || !isNum(t.units) || !isNum(t.price) || t.units <= 0) continue;
    const p = get(t.code);
    const fee = Number(t.fee) || 0;
    p.firstDate = p.firstDate || t.date;
    p.lastDate = t.date;
    p.fees += fee;

    if (t.type === 'SAT') {
      // Elde olandan fazla satış girilmişse eldekiyle sınırla ve işaretle.
      const qty = Math.min(t.units, p.units);
      if (t.units > p.units + EPS) p.oversold = true;
      const avg = p.units > EPS ? p.cost / p.units : 0;
      p.realized += qty * t.price - fee - qty * avg;
      p.cost = Math.max(0, p.cost - qty * avg);
      p.units = Math.max(0, p.units - qty);
      p.sold += qty * t.price - fee;
    } else {
      p.cost += t.units * t.price + fee;
      p.units += t.units;
      p.bought += t.units * t.price + fee;
    }
  }
  return pos;
}

/** İşlemleri tarih indeksine göre gruplar. */
function groupByIndex(txs) {
  const byIdx = new Map();
  for (const t of txs) {
    const idx = indexForDate(t.date);
    if (idx < 0) continue;                       // veri takviminden önce
    if (!byIdx.has(idx)) byIdx.set(idx, []);
    byIdx.get(idx).push(t);
  }
  return byIdx;
}

/**
 * Portföyün tam analizi. Gerekli fon geçmişlerini yükler.
 * @returns {Promise<object>} pozisyonlar, toplamlar, zaman serileri
 */
export async function analyze(txs) {
  const codes = [...new Set(txs.map((t) => t.code).filter(Boolean))];
  await loadHistories(codes);

  const positions = buildPositions(txs);
  const last = lastIndex();
  const prev = Math.max(0, last - 1);

  /* ---------------------------------------------------- güncel pozisyon tablosu */

  const holdings = [];
  let value = 0, cost = 0, dayPL = 0, prevValue = 0, realizedTotal = 0;
  // prevValue, dünkü kapanışta gerçekten elde olan adetlerden hesaplanır;
  // bugün alınan paylar paydayı şişirmesin diye aşağıdaki döngüde toplanır.

  for (const p of positions.values()) {
    realizedTotal += p.realized;
    const meta = DB.byCode.get(p.code);
    const hist = cachedHistory(p.code);
    const price = priceAtIndex(hist, last);
    const pricePrev = priceAtIndex(hist, prev);

    if (p.units <= EPS) {
      // Kapanmış pozisyon: sadece gerçekleşmiş kâr/zarara katkı verir.
      holdings.push({
        ...p, closed: true, name: meta?.name || p.code, cat: meta?.cat || '—',
        price, value: 0, avgCost: 0, unrealized: 0, unrealizedPct: null,
        dayPL: 0, dayPct: null, totalPL: p.realized, weight: 0,
      });
      continue;
    }

    const hasPrice = isNum(price);
    const holdingValue = hasPrice ? p.units * price : 0;
    const avgCost = p.cost / p.units;
    const unrealized = hasPrice ? holdingValue - p.cost : 0;

    value += holdingValue;
    cost += p.cost;

    holdings.push({
      ...p,
      closed: false,
      name: meta?.name || p.code,
      cat: meta?.cat || '—',
      alloc: meta?.alloc || {},
      price,
      pricePrev,
      missingPrice: !hasPrice,
      value: holdingValue,
      avgCost,
      unrealized,
      unrealizedPct: p.cost > EPS ? (unrealized / p.cost) * 100 : null,
      dayPL: 0,          // aşağıda dolduruluyor
      dayPct: isNum(price) && isNum(pricePrev) && pricePrev > 0
        ? (price / pricePrev - 1) * 100 : null,
      totalPL: unrealized + p.realized,
      weight: 0,
    });
  }

  /* ------------------------------------------------------------- günlük kâr/zarar */

  // Günlük kazanç, dünkü kapanışta elde olan adetler üzerinden hesaplanır;
  // bugün alınan paylar bugünün kazancına dahil edilmez (o fiyattan alındılar).
  const unitsAtPrev = unitsAsOf(txs, prev);
  for (const holding of holdings) {
    if (holding.closed) continue;
    const units = unitsAtPrev.get(holding.code) || 0;
    if (units > EPS && isNum(holding.price) && isNum(holding.pricePrev)) {
      holding.dayPL = units * (holding.price - holding.pricePrev);
      dayPL += holding.dayPL;
      prevValue += units * holding.pricePrev;
    }
  }

  for (const holding of holdings) {
    holding.weight = value > EPS ? (holding.value / value) * 100 : 0;
  }
  holdings.sort((a, b) => b.value - a.value || b.totalPL - a.totalPL);

  /* ------------------------------------------------------------------ seriler */

  const series = buildSeries(txs);
  const netInvested = series.invested.length ? series.invested[series.invested.length - 1] : 0;
  const unrealizedTotal = value - cost;
  const totalPL = unrealizedTotal + realizedTotal;

  return {
    holdings,
    open: holdings.filter((h) => !h.closed),
    closed: holdings.filter((h) => h.closed),
    totals: {
      value,
      cost,
      dayPL,
      dayPct: prevValue > EPS ? (dayPL / prevValue) * 100 : null,
      unrealized: unrealizedTotal,
      unrealizedPct: cost > EPS ? (unrealizedTotal / cost) * 100 : null,
      realized: realizedTotal,
      totalPL,
      netInvested,
      totalPct: netInvested > EPS ? (totalPL / netInvested) * 100 : null,
      lastDate: DB.calendar[last],
      prevDate: DB.calendar[prev],
      fundCount: holdings.filter((h) => !h.closed).length,
    },
    series,
    xirr: xirrFromTx(txs, value, DB.calendar[last]),
  };
}

/** Verilen takvim indeksi itibarıyla fon başına adet. */
function unitsAsOf(txs, idx) {
  const units = new Map();
  for (const t of txs) {
    const at = indexForDate(t.date);
    if (at < 0 || at > idx) continue;
    const cur = units.get(t.code) || 0;
    units.set(t.code, t.type === 'SAT' ? Math.max(0, cur - t.units) : cur + t.units);
  }
  return units;
}

/**
 * Günlük portföy değeri, yatırılan anapara ve TWR endeksi serileri.
 * Seri ilk işlemin gününden son veri gününe kadar uzanır.
 */
export function buildSeries(txs) {
  const empty = { start: 0, dates: [], value: [], invested: [], twr: [], dailyPL: [] };
  if (!txs.length || !DB.calendar.length) return empty;

  const byIdx = groupByIndex(txs);
  const indices = [...byIdx.keys()];
  if (!indices.length) return empty;

  const start = Math.min(...indices);
  const end = lastIndex();
  const units = new Map();
  const dates = [], value = [], invested = [], twr = [], dailyPL = [];

  let cumInvested = 0;
  let twrIndex = 100;
  let prevValue = 0;

  for (let idx = start; idx <= end; idx++) {
    let cashFlow = 0;
    for (const t of byIdx.get(idx) || []) {
      const cur = units.get(t.code) || 0;
      if (t.type === 'SAT') {
        const qty = Math.min(t.units, cur);
        units.set(t.code, cur - qty);
        cashFlow -= qty * t.price - (Number(t.fee) || 0);
      } else {
        units.set(t.code, cur + t.units);
        cashFlow += t.units * t.price + (Number(t.fee) || 0);
      }
    }
    cumInvested += cashFlow;

    let total = 0;
    for (const [code, qty] of units) {
      if (qty <= EPS) continue;
      const price = priceAtIndex(cachedHistory(code), idx);
      if (isNum(price)) total += qty * price;
    }

    // Zaman ağırlıklı getiri: nakit akışının etkisini arındır.
    const base = prevValue + cashFlow;
    if (idx > start && base > EPS) twrIndex *= total / base;

    dates.push(DB.calendar[idx]);
    value.push(total);
    invested.push(cumInvested);
    twr.push(twrIndex);
    dailyPL.push(idx > start ? total - base : 0);
    prevValue = total;
  }

  return { start, dates, value, invested, twr, dailyPL };
}

/* ------------------------------------------------------------------- XIRR */

/** Nakit akışlarından yıllık iç verim oranı (%). */
export function xirr(flows) {
  const valid = flows.filter((f) => isNum(f.amount) && f.amount !== 0);
  if (valid.length < 2) return null;
  if (!valid.some((f) => f.amount > 0) || !valid.some((f) => f.amount < 0)) return null;

  const t0 = new Date(valid[0].date + 'T00:00:00').getTime();
  const years = valid.map((f) => (new Date(f.date + 'T00:00:00').getTime() - t0) / 31557600000);
  const npv = (rate) => valid.reduce((sum, f, i) => sum + f.amount / (1 + rate) ** years[i], 0);

  // Önce işaret değiştiren bir aralık bul, sonra ikiye bölerek daralt.
  let lo = -0.9999, hi = 10;
  let fLo = npv(lo), fHi = npv(hi);
  if (fLo * fHi > 0) {
    hi = 100; fHi = npv(hi);
    if (fLo * fHi > 0) return null;
  }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-7) return mid * 100;
    if (fLo * fMid < 0) { hi = mid; fHi = fMid; } else { lo = mid; fLo = fMid; }
  }
  return ((lo + hi) / 2) * 100;
}

function xirrFromTx(txs, currentValue, valuationDate) {
  const flows = txs
    .filter((t) => isNum(t.units) && isNum(t.price))
    .map((t) => ({
      date: t.date,
      // Alış = para çıkışı (negatif), satış = para girişi (pozitif).
      amount: t.type === 'SAT'
        ? t.units * t.price - (Number(t.fee) || 0)
        : -(t.units * t.price + (Number(t.fee) || 0)),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (currentValue > EPS) flows.push({ date: valuationDate, amount: currentValue });
  return xirr(flows);
}

/* ------------------------------------------------------------ risk metrikleri */

export function dailyReturns(values) {
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const a = values[i - 1], b = values[i];
    if (isNum(a) && isNum(b) && a > EPS) out.push(b / a - 1);
  }
  return out;
}

export function stdev(xs) {
  if (xs.length < 2) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

export function maxDrawdown(values) {
  const clean = values.filter((v) => isNum(v) && v > 0);
  if (clean.length < 2) return null;
  let peak = clean[0], worst = 0;
  for (const v of clean) {
    peak = Math.max(peak, v);
    worst = Math.min(worst, v / peak - 1);
  }
  return worst * 100;
}

/** Bir seriden yıllıklandırılmış getiri (%). */
export function annualizedReturn(values, days) {
  const clean = values.filter((v) => isNum(v) && v > 0);
  if (clean.length < 2 || days <= 0) return null;
  const total = clean[clean.length - 1] / clean[0];
  if (total <= 0) return null;
  const years = days / 365.25;
  if (years < 0.16) return null;                 // ~2 aydan kısa: yıllıklandırma yanıltıcı
  return (total ** (1 / years) - 1) * 100;
}

/** TWR serisinden risk özeti. riskFree yıllık % olarak verilir. */
export function riskSummary(twrSeries, dates, riskFree = 0) {
  const rets = dailyReturns(twrSeries);
  const sd = stdev(rets);
  const vol = isNum(sd) ? sd * Math.sqrt(252) * 100 : null;
  const days = dates.length > 1
    ? (new Date(dates[dates.length - 1]) - new Date(dates[0])) / 86400000 : 0;
  const annual = annualizedReturn(twrSeries, days);
  const sharpe = isNum(annual) && isNum(vol) && vol > 0.01 ? (annual - riskFree) / vol : null;
  return {
    vol, sharpe, annual,
    maxDD: maxDrawdown(twrSeries),
    days,
    best: rets.length ? Math.max(...rets) * 100 : null,
    worst: rets.length ? Math.min(...rets) * 100 : null,
    positiveDays: rets.length ? (rets.filter((r) => r > 0).length / rets.length) * 100 : null,
  };
}

/** İki getiri dizisi arasındaki Pearson korelasyonu. */
export function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 20) return null;
  const x = a.slice(a.length - n), y = b.slice(b.length - n);
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a1 = x[i] - mx, b1 = y[i] - my;
    num += a1 * b1; dx += a1 * a1; dy += b1 * b1;
  }
  const den = Math.sqrt(dx * dy);
  return den > EPS ? num / den : null;
}

/** Serinin son `days` günlük dilimini alır. */
export function sliceLastDays(dates, values, days) {
  if (!dates.length) return { dates, values };
  if (!days) return { dates, values };
  const cutoff = new Date(dates[dates.length - 1]);
  cutoff.setDate(cutoff.getDate() - days);
  const iso = cutoff.toISOString().slice(0, 10);
  let from = dates.findIndex((d) => d >= iso);
  if (from < 0) from = 0;
  return { dates: dates.slice(from), values: values.slice(from) };
}
