/* Kalıcı durum: profiller, işlemler, ayarlar.

   Veri yalnızca bu tarayıcının localStorage'ında tutulur; hiçbir sunucuya
   gönderilmez. Yedekleme "Ayarlar" sekmesindeki dışa/içe aktarma ile yapılır. */

const KEY = 'tefas-portfoy-v1';
const listeners = new Set();

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function defaultState() {
  return {
    version: 1,
    activeProfile: 'ana',
    profiles: [{ id: 'ana', name: 'Portföyüm' }],
    tx: [],
    settings: { theme: 'auto', riskFree: 40, costMethod: 'ortalama' },
  };
}

function migrate(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;
  const state = {
    ...base,
    ...raw,
    settings: { ...base.settings, ...(raw.settings || {}) },
  };
  if (!Array.isArray(state.profiles) || !state.profiles.length) state.profiles = base.profiles;
  if (!Array.isArray(state.tx)) state.tx = [];
  // Silinmiş profile bağlı işlemleri ilk profile taşı.
  const ids = new Set(state.profiles.map((p) => p.id));
  for (const t of state.tx) if (!ids.has(t.profile)) t.profile = state.profiles[0].id;
  if (!ids.has(state.activeProfile) && state.activeProfile !== 'ALL') {
    state.activeProfile = state.profiles[0].id;
  }
  return state;
}

let state = load();

function load() {
  try {
    return migrate(JSON.parse(localStorage.getItem(KEY)));
  } catch {
    return defaultState();
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.error('Kaydedilemedi', err);
  }
  listeners.forEach((fn) => fn(state));
}

export const getState = () => state;
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/* ------------------------------------------------------------------ profiller */

export const profiles = () => state.profiles;
export const activeProfileId = () => state.activeProfile;

export function activeProfileName() {
  if (state.activeProfile === 'ALL') return 'Tüm profiller';
  return state.profiles.find((p) => p.id === state.activeProfile)?.name || 'Portföy';
}

export function setActiveProfile(id) {
  state.activeProfile = id;
  persist();
}

export function addProfile(name) {
  const profile = { id: uid(), name: String(name || '').trim() || 'Yeni profil' };
  state.profiles.push(profile);
  state.activeProfile = profile.id;
  persist();
  return profile;
}

export function renameProfile(id, name) {
  const p = state.profiles.find((x) => x.id === id);
  if (p) { p.name = String(name || '').trim() || p.name; persist(); }
}

export function removeProfile(id) {
  if (state.profiles.length <= 1) return false;
  state.profiles = state.profiles.filter((p) => p.id !== id);
  state.tx = state.tx.filter((t) => t.profile !== id);
  if (state.activeProfile === id) state.activeProfile = state.profiles[0].id;
  persist();
  return true;
}

/* -------------------------------------------------------------------- işlemler */

/** Aktif profilin (veya 'ALL' ise tümünün) işlemleri, tarihe göre sıralı. */
export function transactions(profileId = state.activeProfile) {
  const list = profileId === 'ALL'
    ? state.tx.slice()
    : state.tx.filter((t) => t.profile === profileId);
  return list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function addTransaction(tx) {
  const record = {
    id: uid(),
    profile: state.activeProfile === 'ALL' ? state.profiles[0].id : state.activeProfile,
    ...tx,
    code: String(tx.code || '').trim().toLocaleUpperCase('tr'),
    units: Number(tx.units),
    price: Number(tx.price),
    fee: Number(tx.fee || 0),
  };
  state.tx.push(record);
  persist();
  return record;
}

export function updateTransaction(id, patch) {
  const t = state.tx.find((x) => x.id === id);
  if (!t) return false;
  Object.assign(t, patch);
  t.units = Number(t.units);
  t.price = Number(t.price);
  t.fee = Number(t.fee || 0);
  persist();
  return true;
}

export function removeTransaction(id) {
  const before = state.tx.length;
  state.tx = state.tx.filter((t) => t.id !== id);
  if (state.tx.length !== before) persist();
}

export const allTransactions = () => state.tx;

/* --------------------------------------------------------------------- ayarlar */

export const settings = () => state.settings;

export function setSetting(key, value) {
  state.settings[key] = value;
  persist();
}

/* ------------------------------------------------------------- yedekle / geri yükle */

export function exportJSON() {
  return JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
}

/** Yedeği içe aktarır. mode: 'replace' | 'merge' */
export function importJSON(text, mode = 'replace') {
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.tx)) throw new Error('Dosya bir portföy yedeği değil.');

  if (mode === 'merge') {
    const existing = new Set(state.tx.map((t) => t.id));
    const nameToId = new Map(state.profiles.map((p) => [p.name, p.id]));
    for (const p of parsed.profiles || []) {
      if (!nameToId.has(p.name)) {
        const created = { id: uid(), name: p.name };
        state.profiles.push(created);
        nameToId.set(p.name, created.id);
      }
    }
    const oldIdToName = new Map((parsed.profiles || []).map((p) => [p.id, p.name]));
    let added = 0;
    for (const t of parsed.tx) {
      if (existing.has(t.id)) continue;
      const name = oldIdToName.get(t.profile);
      state.tx.push({ ...t, id: uid(), profile: nameToId.get(name) || state.profiles[0].id });
      added += 1;
    }
    persist();
    return added;
  }

  state = migrate(parsed);
  persist();
  return state.tx.length;
}

export function resetAll() {
  state = defaultState();
  persist();
}
