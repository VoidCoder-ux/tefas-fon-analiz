/* Ayarlar: profiller, tema, yedekleme ve veri durumu. */

import {
  h, toast, confirmDialog, downloadText, fmtDate, isNum, openModal,
} from '../util.js';
import { DB } from '../data.js';
import {
  profiles, activeProfileId, addProfile, renameProfile, removeProfile,
  settings, setSetting, exportJSON, importJSON, resetAll, addTransaction,
  allTransactions, daysSinceBackup,
} from '../store.js';
import { sectionCard } from './common.js';

/**
 * Sayıyı hem Türkçe hem İngilizce yazımdan okur.
 * Virgül varsa Türkçe kabul edilir ("1.234,56"); yoksa nokta ondalık ayracıdır
 * ("1234.56"), böylece "1,234567" gibi fiyatlar da doğru okunur.
 */
function parseNumber(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return NaN;
  return Number(text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text);
}

/**
 * CSV satırlarının ayracını belirler.
 *
 * Virgül ayraç olarak KULLANILAMAZ diye varsayılamaz: Türkçe sayılarda virgül
 * ondalık ayracıdır ("1.250,5"). Bu yüzden önce noktalı virgül ve sekme aranır
 * (Excel'in Türkçe yereldeki varsayılanı noktalı virgüldür); yalnızca hiçbiri
 * yoksa virgüle düşülür.
 */
function ayracBelirle(metin) {
  if (metin.includes(';')) return ';';
  if (metin.includes('\t')) return '\t';
  return ',';
}

/** "YYYY-AA-GG" gerçekten var olan bir tarih mi? (31.02 gibi girdileri eler) */
function gecerliTarih(iso) {
  const [y, a, g] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(y, a - 1, g));
  return d.getUTCFullYear() === y && d.getUTCMonth() === a - 1 && d.getUTCDate() === g;
}

/** "kod;tarih;tür;adet;fiyat;masraf" satırlarını işleme alır. */
function parseCSV(text) {
  const rows = [];
  const errors = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const ayrac = ayracBelirle(text);
  const bugun = new Date().toISOString().slice(0, 10);

  lines.forEach((line, i) => {
    // Başlık satırını atla.
    if (i === 0 && /kod|fon/i.test(line) && /tarih/i.test(line)) return;
    const parts = line.split(ayrac).map((s) => s.trim());
    if (parts.length < 5) { errors.push(`${i + 1}. satır: en az 5 sütun olmalı`); return; }

    const [rawCode, rawDate, rawType, rawUnits, rawPrice, rawFee] = parts;
    const code = rawCode.toLocaleUpperCase('tr');
    if (!DB.byCode.get(code)) { errors.push(`${i + 1}. satır: ${code} bulunamadı`); return; }

    let date = rawDate;
    const dotted = rawDate.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
    if (dotted) {
      date = `${dotted[3]}-${dotted[2].padStart(2, '0')}-${dotted[1].padStart(2, '0')}`;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !gecerliTarih(date)) {
      errors.push(`${i + 1}. satır: geçersiz tarih (${rawDate})`); return;
    }
    if (date > bugun) {
      errors.push(`${i + 1}. satır: tarih gelecekte (${rawDate})`); return;
    }

    const type = /^s/i.test(rawType) ? 'SAT' : 'AL';
    const units = parseNumber(rawUnits);
    const price = parseNumber(rawPrice);
    const fee = parseNumber(rawFee || '0') || 0;
    if (!(units > 0)) { errors.push(`${i + 1}. satır: adet geçersiz (${rawUnits})`); return; }
    if (!(price > 0)) { errors.push(`${i + 1}. satır: fiyat geçersiz (${rawPrice})`); return; }
    if (!(fee >= 0)) { errors.push(`${i + 1}. satır: masraf geçersiz (${rawFee})`); return; }

    rows.push({ code, date, type, units, price, fee });
  });

  return { rows, errors };
}

/**
 * Toplu işlem içe aktarma penceresi.
 *
 * İçe aktarma sonrası pencere KAPANMAZ: aksi hâlde atlanan satırların raporu
 * anında yok oluyor ve kullanıcı hangi satırların girilmediğini göremiyordu.
 */
function csvImportDialog({ onImported, onClose }) {
  const area = h('textarea', {
    rows: '10', placeholder: 'AAL;15.03.2026;AL;1250,5;3,123456;0',
    style: 'width:100%;font-family:var(--mono);font-size:.82rem;padding:10px;'
      + 'border:1px solid var(--border);border-radius:9px;background:var(--surface);',
  });
  const result = h('div', { class: 'stack' });

  const iceAktar = () => {
    const { rows, errors } = parseCSV(area.value);
    result.replaceChildren();

    if (rows.length) {
      rows.forEach(addTransaction);
      result.append(h('div', { class: 'notice' },
        h('b', {}, `${rows.length} işlem eklendi.`),
        h('div', { style: 'margin-top:4px;font-size:.82rem' },
          rows.slice(0, 6).map((r) => `${r.code} ${r.date} ${r.type === 'SAT' ? 'satış' : 'alış'}`)
            .join(' · ') + (rows.length > 6 ? ` · +${rows.length - 6} tane daha` : ''))));
      toast(`${rows.length} işlem eklendi`);
      onImported?.();
      area.value = '';                       // aynı satırlar iki kez eklenmesin
    }

    if (errors.length) {
      result.append(h('div', { class: 'notice warn' },
        h('b', {}, `${errors.length} satır atlandı:`),
        h('div', { style: 'margin-top:4px;font-size:.8rem' }, errors.slice(0, 10).join(' · ')),
        errors.length > 10
          ? h('div', { style: 'margin-top:4px;font-size:.8rem' }, `…ve ${errors.length - 10} tane daha`)
          : null));
    }

    if (!rows.length && !errors.length) {
      result.append(h('div', { class: 'notice warn' }, 'İçe aktarılacak satır bulunamadı.'));
    }
  };

  return h('div', { class: 'stack' },
    h('p', { class: 'dim', style: 'margin:0' },
      'Her satır bir işlem: fon kodu; tarih; tür (AL/SAT); adet; birim fiyat; masraf. '
      + 'Ayraç olarak noktalı virgül veya sekme kullan - virgül Türkçe sayılarda '
      + 'ondalık ayracı olduğu için ayraç olarak güvenli değildir. '
      + "Excel'den kopyalayıp doğrudan yapıştırabilirsin."),
    area,
    result,
    h('div', { class: 'btn-row', style: 'justify-content:flex-end' },
      h('button', { class: 'btn', type: 'button', onclick: () => onClose?.() }, 'Kapat'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: iceAktar }, 'İçe Aktar')));
}

export function renderAyarlar(ctx) {
  const root = h('div', { class: 'stack' });
  const cfg = settings();

  /* ------------------------------------------------------------------ profiller */

  const profileRows = profiles().map((p) => {
    const nameInput = h('input', { type: 'text', value: p.name, style: 'flex:1 1 160px' });
    nameInput.addEventListener('change', () => {
      renameProfile(p.id, nameInput.value);
      toast('Profil adı güncellendi');
      ctx.refresh();
    });
    const txCount = allTransactions().filter((t) => t.profile === p.id).length;
    return h('div', {
      style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 0;'
        + 'border-bottom:1px solid var(--border)',
    },
    nameInput,
    h('span', { class: 'dim', style: 'font-size:.8rem' }, `${txCount} işlem`),
    p.id === activeProfileId() ? h('span', { class: 'pill' }, 'aktif') : null,
    h('button', {
      class: 'btn btn-sm btn-danger', type: 'button',
      disabled: profiles().length <= 1,
      onclick: async () => {
        const ok = await confirmDialog('Profili sil',
          `"${p.name}" profili ve içindeki ${txCount} işlem kalıcı olarak silinecek.`,
          { danger: true, okLabel: 'Sil' });
        if (ok) { removeProfile(p.id); toast('Profil silindi'); ctx.refresh(); }
      },
    }, 'Sil'));
  });

  const newName = h('input', { type: 'text', placeholder: 'Örn. Annem', style: 'flex:1 1 160px' });
  const addBtn = h('button', {
    class: 'btn btn-primary', type: 'button',
    onclick: () => {
      if (!newName.value.trim()) { toast('Bir isim yaz'); return; }
      addProfile(newName.value);
      toast('Profil eklendi');
      ctx.refresh();
    },
  }, 'Profil Ekle');

  root.append(sectionCard('Profiller',
    'Her aile bireyi için ayrı portföy tut; üstteki menüden geçiş yap',
    h('div', {}, profileRows),
    h('div', { style: 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap' }, newName, addBtn)));

  /* ---------------------------------------------------------------------- görünüm */

  const themeSel = h('select', {},
    h('option', { value: 'auto', selected: cfg.theme === 'auto' }, 'Sistem ayarı'),
    h('option', { value: 'light', selected: cfg.theme === 'light' }, 'Açık'),
    h('option', { value: 'dark', selected: cfg.theme === 'dark' }, 'Koyu'));
  themeSel.addEventListener('change', () => {
    setSetting('theme', themeSel.value);
    ctx.applyTheme();
  });

  root.append(sectionCard('Görünüm', null,
    h('div', { class: 'form-grid' },
      h('div', { class: 'field' }, h('label', {}, 'Tema'), themeSel))));

  /* -------------------------------------------------------------------- yedekleme */

  const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const text = await file.text();
    const mode = await confirmDialog('Yedeği içe aktar',
      'Mevcut verinin üzerine yazılsın mı? "Onayla" üzerine yazar, "Vazgeç" mevcut verinin '
      + 'üstüne ekler (birleştirir).',
      { okLabel: 'Üzerine yaz' });
    try {
      const count = importJSON(text, mode ? 'replace' : 'merge');
      toast(`${count} işlem içe aktarıldı`);
      ctx.refresh();
    } catch (err) {
      toast(`İçe aktarılamadı: ${err.message}`);
    }
    fileInput.value = '';
  });

  const gecenGun = daysSinceBackup();
  const islemSayisi = allTransactions().length;
  const yedekUyarisi = islemSayisi > 0 && (gecenGun === null || gecenGun > 30)
    ? h('div', { class: 'notice warn', style: 'margin-bottom:12px' },
      gecenGun === null
        ? `${islemSayisi} işlem girdin ama henüz hiç yedek almadın. Tarayıcı verilerini `
          + 'temizlersen hepsi kaybolur.'
        : `Son yedeğin ${gecenGun} gün önce alınmış. O tarihten sonra girdiğin işlemler `
          + 'yedekte yok.')
    : (gecenGun !== null
      ? h('p', { class: 'dim', style: 'margin:0 0 10px;font-size:.84rem' },
        gecenGun === 0 ? 'Son yedek: bugün.' : `Son yedek: ${gecenGun} gün önce.`)
      : null);

  root.append(sectionCard('Yedekleme',
    'Veriler yalnızca bu tarayıcıda tutulur - düzenli yedek al',
    yedekUyarisi,
    h('p', { class: 'dim', style: 'margin:0 0 12px;font-size:.86rem' },
      'Yedek dosyasını başka bir cihazda içe aktararak portföyünü taşıyabilirsin. '
      + 'Aile bireyleri kendi cihazlarında kendi verilerini tutar; istersen yedeği paylaşarak '
      + 'aynı portföyü herkesin görmesini sağlayabilirsin.'),
    h('div', { class: 'btn-row' },
      h('button', {
        class: 'btn btn-primary', type: 'button',
        onclick: () => {
          downloadText(`tefas-portfoy-${new Date().toISOString().slice(0, 10)}.json`, exportJSON());
          toast('Yedek indirildi');
        },
      }, '↓ Yedeği İndir'),
      h('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() },
        '↑ Yedekten Yükle'),
      h('button', {
        class: 'btn', type: 'button',
        onclick: () => {
          let close;
          close = openModal('Toplu İşlem İçe Aktar', csvImportDialog({
            onImported: () => ctx.refresh(),
            onClose: () => close?.(),
          }));
        },
      }, 'Excel/CSV\'den Ekle'),
      fileInput)));

  /* ----------------------------------------------------------------- veri durumu */

  const meta = DB.meta || {};
  root.append(sectionCard('Veri Durumu', null,
    h('div', { class: 'table-wrap' }, h('table', {}, h('tbody', {},
      h('tr', {}, h('td', {}, 'Son fiyat günü'), h('td', {}, fmtDate(meta.lastDataDate))),
      h('tr', {}, h('td', {}, 'Veri başlangıcı'), h('td', {}, fmtDate(meta.firstDataDate))),
      h('tr', {}, h('td', {}, 'Kapsanan fon sayısı'), h('td', {},
        isNum(meta.fundCount) ? String(meta.fundCount) : String(DB.funds.length))),
      h('tr', {}, h('td', {}, 'İşlem günü sayısı'), h('td', {}, String(meta.days ?? '—'))),
      h('tr', {}, h('td', {}, 'Kıyaslama serileri'), h('td', {},
        (meta.benchmarks || []).join(', ') || '—')),
      h('tr', {}, h('td', {}, 'Veri üretim zamanı'), h('td', {},
        meta.built ? new Date(meta.built).toLocaleString('tr-TR') : '—')))))));

  /* -------------------------------------------------------------------- sıfırlama */

  root.append(sectionCard('Tehlikeli Bölge', null,
    h('div', { class: 'btn-row' },
      h('button', {
        class: 'btn btn-danger', type: 'button',
        onclick: async () => {
          const ok = await confirmDialog('Her şeyi sil',
            'Tüm profiller ve işlemler kalıcı olarak silinecek. Önce yedek almanı öneririm.',
            { danger: true, okLabel: 'Hepsini sil' });
          if (ok) { resetAll(); toast('Tüm veriler silindi'); ctx.refresh(); }
        },
      }, 'Tüm Verileri Sil'))));

  return root;
}
