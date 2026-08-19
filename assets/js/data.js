/* Veri katmanı: yayımlanmış JSON dosyalarını yükler ve sorgular.
   Fon geçmişleri büyük olduğu için yalnızca ihtiyaç duyulan fonlar için
   istek atılır ve bellekte tutulur. */

import { isNum } from './util.js';

const DATA_URL = new URL('../../data/', import.meta.url).href;

export const DB = {
  funds: [],            // funds.json içeriği
  byCode: new Map(),    // kod -> fon kaydı
  calendar: [],         // ["YYYY-MM-DD", ...] tüm veri günleri
  indexOf: new Map(),   // tarih -> takvim indeksi
  benchmarks: {},       // { BIST100: {label, unit, values:[...]}, ... }
  meta: {},
};

const historyCache = new Map();     // kod -> { i, p, filled }
const pending = new Map();          // kod -> Promise

async function getJSON(path) {
  const res = await fetch(DATA_URL + path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path} yüklenemedi (HTTP ${res.status})`);
  return res.json();
}

/** Uygulama açılışında gereken küçük dosyaları yükler. */
export async function loadCore() {
  const [funds, calendar, benchmarks, meta] = await Promise.all([
    getJSON('funds.json'),
    getJSON('calendar.json'),
    getJSON('benchmarks.json').catch(() => ({})),
    getJSON('meta.json').catch(() => ({})),
  ]);
  DB.funds = funds;
  DB.calendar = calendar;
  DB.benchmarks = benchmarks || {};
  DB.meta = meta || {};
  DB.byCode = new Map(funds.map((f) => [f.code, f]));
  DB.indexOf = new Map(calendar.map((d, i) => [d, i]));
  return DB;
}

/** Bir fonun fiyat geçmişini yükler (önbelleklenir). */
export async function loadHistory(code) {
  if (historyCache.has(code)) return historyCache.get(code);
  if (pending.has(code)) return pending.get(code);

  const task = getJSON(`history/${encodeURIComponent(code)}.json`)
    .then((raw) => {
      const entry = { i: raw.i | 0, p: raw.p || [], filled: forwardFill(raw.p || []) };
      historyCache.set(code, entry);
      pending.delete(code);
      return entry;
    })
    .catch((err) => {
      pending.delete(code);
      // Fon TEFAS'tan kalkmış olabilir; boş geçmiş dön ki arayüz çökmesin.
      console.warn(`Geçmiş yüklenemedi: ${code}`, err);
      const entry = { i: 0, p: [], filled: [], missing: true };
      historyCache.set(code, entry);
      return entry;
    });

  pending.set(code, task);
  return task;
}

export function loadHistories(codes) {
  return Promise.all([...new Set(codes)].map(loadHistory));
}

export const cachedHistory = (code) => historyCache.get(code) || null;

/**
 * Boşlukları bir önceki geçerli fiyatla doldurur (tatil/eksik gün).
 * Sıfır ve negatif değerler geçersiz sayılır - TEFAS ara sıra fiyat
 * açıklanmayan günler için 0 yayımlıyor.
 */
function forwardFill(arr) {
  const out = new Array(arr.length);
  let last = null;
  for (let i = 0; i < arr.length; i++) {
    if (isNum(arr[i]) && arr[i] > 0) last = arr[i];
    out[i] = last;
  }
  return out;
}

/**
 * Takvim indeksindeki fiyat. Fonun verisi o gün yoksa en son bilinen fiyat
 * kullanılır; fon henüz kurulmamışsa null döner.
 */
export function priceAtIndex(hist, idx) {
  if (!hist || !hist.filled.length) return null;
  const k = idx - hist.i;
  if (k < 0) return null;
  if (k >= hist.filled.length) return hist.filled[hist.filled.length - 1];
  return hist.filled[k];
}

/** O günkü gerçek (ileri doldurulmamış) fiyat; yoksa null. */
export function exactPriceAtIndex(hist, idx) {
  if (!hist) return null;
  const k = idx - hist.i;
  const value = k >= 0 && k < hist.p.length ? hist.p[k] : null;
  return isNum(value) && value > 0 ? value : null;
}

/** ISO tarihi takvim indeksine çevirir; tam eşleşme yoksa önceki iş günü. */
export function indexForDate(iso) {
  if (DB.indexOf.has(iso)) return DB.indexOf.get(iso);
  const cal = DB.calendar;
  let lo = 0, hi = cal.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cal[mid] <= iso) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return best;
}

/** Belirli bir tarihteki fon fiyatı (işlem formunda otomatik doldurma için). */
export async function priceOnDate(code, iso) {
  const idx = indexForDate(iso);
  if (idx < 0) return null;
  const hist = await loadHistory(code);
  return exactPriceAtIndex(hist, idx) ?? priceAtIndex(hist, idx);
}

export const lastIndex = () => DB.calendar.length - 1;
export const lastDate = () => DB.calendar[DB.calendar.length - 1];

/** Fon kodu/ünvanına göre arama (otomatik tamamlama). */
export function searchFunds(query, limit = 12) {
  const q = (query || '').trim().toLocaleUpperCase('tr');
  if (!q) return [];
  const starts = [], contains = [];
  for (const f of DB.funds) {
    if (f.code === q) { starts.unshift(f); continue; }
    if (f.code.startsWith(q)) starts.push(f);
    else if (f.code.includes(q) || f.name.toLocaleUpperCase('tr').includes(q)) contains.push(f);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}
