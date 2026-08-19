/* Uygulama çatısı: veri yükleme, sekme yönlendirme, profil ve tema yönetimi. */

import { $, h, fmtDate, toast } from './util.js';
import { loadCore, DB } from './data.js';
import { analyze } from './portfolio.js';
import {
  transactions, profiles, activeProfileId, setActiveProfile, activeProfileName,
  settings, setSetting, subscribe,
} from './store.js';
import { renderPanel } from './views/panel.js';
import { renderDagilim } from './views/dagilim.js';
import { renderKiyaslama } from './views/kiyaslama.js';
import { renderRisk } from './views/risk.js';
import { renderIslemler } from './views/islemler.js';
import { renderFonlar, showFundDetail } from './views/fonlar.js';
import { renderAyarlar } from './views/ayarlar.js';

const VIEWS = {
  panel: { render: renderPanel, needsAnalysis: true },
  dagilim: { render: renderDagilim, needsAnalysis: true },
  kiyaslama: { render: renderKiyaslama, needsAnalysis: true },
  risk: { render: renderRisk, needsAnalysis: true },
  islemler: { render: renderIslemler, needsAnalysis: false },
  fonlar: { render: renderFonlar, needsAnalysis: true },
  ayarlar: { render: renderAyarlar, needsAnalysis: false },
};

const app = $('#app');
let currentView = 'panel';
let prefillCode = null;
let rendering = false;

/* --------------------------------------------------------------------- tema */

function applyTheme() {
  const mode = settings().theme || 'auto';
  const root = document.documentElement;
  if (mode === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
}

function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  const next = order[(order.indexOf(settings().theme || 'auto') + 1) % order.length];
  setSetting('theme', next);
  applyTheme();
  toast({ auto: 'Tema: sistem ayarı', light: 'Tema: açık', dark: 'Tema: koyu' }[next]);
}

/* ------------------------------------------------------------------ profiller */

function renderProfileSelect() {
  const select = $('#profileSelect');
  const options = profiles().map((p) => h('option', {
    value: p.id, selected: p.id === activeProfileId(),
  }, p.name));
  if (profiles().length > 1) {
    options.push(h('option', {
      value: 'ALL', selected: activeProfileId() === 'ALL',
    }, '★ Tüm profiller'));
  }
  select.replaceChildren(...options);
}

/* ------------------------------------------------------------------ yönlendirme */

function setActiveTab(view) {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.view === view));
  }
}

function navigate(view, opts = {}) {
  if (!VIEWS[view]) view = 'panel';
  currentView = view;
  prefillCode = opts.code || null;
  if (location.hash.slice(1) !== view) {
    history.replaceState(null, '', `#${view}`);
  }
  setActiveTab(view);
  render();
}

/* -------------------------------------------------------------------- çizim */

async function render() {
  if (rendering) return;
  rendering = true;
  const view = VIEWS[currentView] || VIEWS.panel;

  try {
    const ctx = {
      navigate,
      refresh: () => { render(); },
      applyTheme,
      showFund: (code) => showFundDetail(code, ctx),
      prefill: prefillCode,
      profileName: activeProfileName(),
    };

    if (view.needsAnalysis) {
      const txs = transactions();
      if (txs.length) {
        app.replaceChildren(h('div', { class: 'loading' },
          h('div', { class: 'spinner' }), h('p', {}, 'Hesaplanıyor…')));
      }
      ctx.analysis = await analyze(txs);
    }

    const node = view.render(ctx);
    app.replaceChildren(node);
    prefillCode = null;
    window.scrollTo({ top: 0, behavior: 'auto' });
  } catch (err) {
    console.error(err);
    app.replaceChildren(h('div', { class: 'card empty' },
      h('h3', {}, 'Bir hata oluştu'),
      h('p', {}, String(err?.message || err)),
      h('button', { class: 'btn', type: 'button', onclick: () => render() }, 'Tekrar dene')));
  } finally {
    rendering = false;
  }
}

/* --------------------------------------------------------------------- açılış */

async function boot() {
  applyTheme();

  $('#themeBtn').addEventListener('click', cycleTheme);
  $('#profileSelect').addEventListener('change', (e) => {
    setActiveProfile(e.target.value);
    render();
  });
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => navigate(tab.dataset.view));
  }
  window.addEventListener('hashchange', () => {
    const view = location.hash.slice(1);
    if (VIEWS[view] && view !== currentView) navigate(view);
  });

  try {
    await loadCore();
  } catch (err) {
    app.replaceChildren(h('div', { class: 'card empty' },
      h('h3', {}, 'Veriler yüklenemedi'),
      h('p', {}, 'TEFAS verileri henüz üretilmemiş olabilir. GitHub Actions üzerindeki '
        + '"Veri güncelle" iş akışını çalıştırdıktan sonra tekrar dene.'),
      h('p', { class: 'dim' }, String(err?.message || err))));
    return;
  }

  const status = $('#dataStatus');
  status.textContent = `Veri: TEFAS · son fiyat günü ${fmtDate(DB.meta.lastDataDate)} · `
    + `${DB.meta.fundCount ?? DB.funds.length} fon kapsanıyor`;

  renderProfileSelect();
  subscribe(() => renderProfileSelect());

  const initial = location.hash.slice(1);
  navigate(VIEWS[initial] ? initial : 'panel');
}

boot();
